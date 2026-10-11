const net = require('net');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * TransferService
 * Handles all file sending and receiving over raw TCP.
 *
 * Protocol (binary framing):
 *   [4 bytes: header length (uint32 BE)]
 *   [N bytes: JSON header]
 *   [remaining bytes: file data]
 *
 * Header fields:
 *   type        → 'transfer-request' | 'transfer-accept' | 'transfer-decline' | 'file-chunk' | 'transfer-complete'
 *   transferId  → uuid
 *   senderId    → sender device id
 *   senderName  → sender display name
 *   filename    → original filename
 *   fileSize    → total bytes
 *
 * Emits (receiver side):
 *   'incoming-request'   → { transferId, senderName, filename, fileSize, requiresPin }
 *   'transfer-progress'  → { transferId, filename, received, total, percent }
 *   'transfer-complete'  → { transferId, filename, savePath, sent: bool }
 *   'transfer-error'     → { transferId, error }
 *
 * Emits (sender side):
 *   'pin-required'       → { transferId }
 *   'transfer-error'     → { transferId, error: 'wrong-pin' | 'declined' | ... }
 *
 * PIN flow (receiver has PIN enabled):
 *   1. Sender connects and sends transfer-request header as normal.
 *   2. Receiver sees pinEnabled=true → immediately writes { type: 'pin-required' } back to sender.
 *   3. Sender receives 'pin-required', emits 'pin-required' event so UI shows PIN dialog.
 *   4. UI calls submitPin(transferId, pin) → socket writes { type: 'pin-response', pin }.
 *   5. Receiver validates:
 *        Wrong → writes { type: 'pin-wrong' }, destroys socket, emits transfer-error.
 *        Correct → proceeds to emit 'incoming-request', normal accept/decline flow.
 *   6. If no pin-response arrives within 30 s, receiver destroys socket.
 */
class TransferService extends EventEmitter {
  constructor(deviceId, deviceName, port) {
    super();
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.port = port;
    this.server = null;

    // PIN state — updated by main.js via setPin()
    this.pinEnabled = false;
    this.currentPin = null;

    // Active incoming transfers waiting for user response
    // transferId → { resolve, reject, socket, header, initialData }
    this.pendingIncoming = new Map();

    // Transfers currently waiting for the sender to supply the PIN
    // transferId → { socket, header, initialData, timer }
    this.pendingPinCheck = new Map();

    // Active incoming transfers being received
    // transferId → { socket, header, savePath, writeStream, received }
    this.activeReceiving = new Map();

    // Active outgoing transfers
    // transferId → { socket, filePath, resolve, reject }
    this.activeSending = new Map();
  }

  // ─── PIN Management ────────────────────────────────────────────────────────

  /**
   * Called by main.js whenever the user enables/disables PIN protection or
   * changes their PIN in settings.
   *
   * @param {string|null} pin     - The 6-digit PIN string, or null to clear.
   * @param {boolean}     enabled - Whether PIN protection is active.
   */
  setPin(pin, enabled) {
    this.pinEnabled = !!enabled;
    this.currentPin = enabled ? pin : null;
    console.log(`[Transfer] PIN protection ${this.pinEnabled ? 'enabled' : 'disabled'}`);
  }

  // ─── Sending ───────────────────────────────────────────────────────────────

  async sendFile(filePath, peerHost, peerPort, peerId, peerName, callerTransferId) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(filePath)) {
        return reject(new Error('File not found: ' + filePath));
      }

      const stat = fs.statSync(filePath);
      const filename = path.basename(filePath);
      // Use the caller-supplied ID so the renderer's UI entry matches progress/complete events
      const transferId = callerTransferId || uuidv4();

      const socket = net.createConnection({ host: peerHost, port: peerPort }, () => {
        console.log(`[Transfer] Connected to ${peerName} @ ${peerHost}:${peerPort}`);

        const header = {
          type: 'transfer-request',
          transferId,
          senderId: this.deviceId,
          senderName: this.deviceName,
          filename,
          fileSize: stat.size,
        };

        this._sendHeader(socket, header);
        this.activeSending.set(transferId, { socket, filePath, resolve, reject });
      });

      socket.on('data', (data) => {
        this._handleSenderData(transferId, data);
      });

      socket.on('error', (err) => {
        console.error(`[Transfer] Send error (${transferId}):`, err.message);
        this.activeSending.delete(transferId);
        reject(err);
      });

      socket.on('close', () => {
        this.activeSending.delete(transferId);
      });

      // 30-second timeout waiting for accept/decline (or pin-required acknowledgement)
      socket.setTimeout(30000, () => {
        if (this.activeSending.has(transferId)) {
          socket.destroy();
          this.activeSending.delete(transferId);
          reject(new Error('Transfer timed out waiting for response'));
        }
      });
    });
  }

  /**
   * Called by the sender UI when the user hits Decline/Cancel during the PIN
   * prompt (or at any point before the transfer completes).  Destroys the
   * outgoing socket and emits transfer-error so the UI cleans up.
   *
   * @param {string} transferId
   */
  cancelTransfer(transferId) {
    const entry = this.activeSending.get(transferId);
    if (!entry) return;
    entry.socket.destroy();
    this.activeSending.delete(transferId);
    entry.reject(new Error('cancelled'));
    this.emit('transfer-error', { transferId, error: 'cancelled' });
    console.log(`[Transfer] Transfer ${transferId} cancelled by sender`);
  }

  /**
   * Called by the receiver UI when they choose to share their PIN.
   * The receiver already knows the PIN is correct (it's their own PIN), so
   * we skip the wire protocol entirely: remove the onPinData listener, clear
   * the pending check, and proceed directly to the normal incoming-request flow.
   *
   * @param {string} transferId
   */
  revealPinToReceiver(transferId) {
    const entry = this.pendingPinCheck.get(transferId);
    if (!entry) return;

    // Remove the temporary pin-data listener so it doesn't interfere with
    // subsequent socket data (transfer-accept, file bytes, etc.)
    if (entry.onPinData) entry.socket.removeListener('data', entry.onPinData);

    clearTimeout(entry.timer);
    this.pendingPinCheck.delete(transferId);

    console.log(`[Transfer] PIN accepted by receiver for transfer ${transferId}; proceeding`);
    this._onTransferRequest(entry.socket, entry.header, entry.initialData);
  }

  /**
   * Called by the receiver UI when they choose to DECLINE the incoming transfer
   * during the PIN-share prompt (before they have shared their PIN).
   * Destroys the pending socket so the sender gets a connection close.
   *
   * @param {string} transferId
   */
  declinePinRequest(transferId) {
    const entry = this.pendingPinCheck.get(transferId);
    if (!entry) return;
    if (entry.onPinData) entry.socket.removeListener('data', entry.onPinData);
    clearTimeout(entry.timer);
    this.pendingPinCheck.delete(transferId);
    // Write a decline response so the sender gets a clean error, not a timeout
    try { entry.socket.write(JSON.stringify({ type: 'transfer-decline', transferId })); } catch (_) {}
    entry.socket.destroy();
    console.log(`[Transfer] Receiver declined PIN request for ${transferId}`);
  }

  /**
   * Called by the sender UI when they want to submit a PIN.
   * Locates the active sending socket and writes a pin-response message.
   *
   * @param {string} transferId
   * @param {string} pin  - The 6-digit PIN the user entered.
   */
  submitPin(transferId, pin) {
    const entry = this.activeSending.get(transferId);
    if (!entry) {
      console.warn('[Transfer] submitPin: no active sending entry for', transferId);
      return;
    }

    const msg = JSON.stringify({ type: 'pin-response', pin });
    entry.socket.write(msg);
    console.log(`[Transfer] PIN response submitted for transfer ${transferId}`);
  }

  _handleSenderData(transferId, data) {
    try {
      const response = JSON.parse(data.toString('utf8'));
      const entry = this.activeSending.get(transferId);
      if (!entry) return;

      if (response.type === 'pin-required') {
        // Receiver requires a PIN before showing accept/decline.
        // Disable the connection timeout while we wait for the user to type their PIN —
        // the UI will call submitPin() which writes pin-response back.
        console.log(`[Transfer] Receiver requires PIN for transfer ${transferId}`);
        entry.socket.setTimeout(0);
        this.emit('pin-required', { transferId });

      } else if (response.type === 'pin-wrong') {
        // The PIN we submitted was rejected.
        console.warn(`[Transfer] Wrong PIN for transfer ${transferId}`);
        entry.socket.destroy();
        this.activeSending.delete(transferId);
        entry.reject(new Error('wrong-pin'));
        this.emit('transfer-error', { transferId, error: 'wrong-pin' });

      } else if (response.type === 'transfer-accept') {
        console.log(`[Transfer] Peer accepted transfer ${transferId}`);
        // Clear any remaining timeout
        entry.socket.setTimeout(0);
        this._streamFile(transferId, entry);

      } else if (response.type === 'transfer-decline') {
        console.log(`[Transfer] Peer declined transfer ${transferId}`);
        entry.socket.destroy();
        this.activeSending.delete(transferId);
        entry.reject(new Error('Transfer was declined by receiver'));
        this.emit('transfer-error', { transferId, error: 'declined' });
      }
    } catch (err) {
      console.error('[Transfer] Error parsing sender response:', err.message);
    }
  }

  _streamFile(transferId, entry) {
    const { socket, filePath, resolve } = entry;
    const stat = fs.statSync(filePath);
    const filename = path.basename(filePath);
    let sent = 0;

    const readStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });

    readStream.on('data', (chunk) => {
      socket.write(chunk);
      sent += chunk.length;

      this.emit('transfer-progress', {
        transferId,
        filename,
        sent,
        total: stat.size,
        percent: Math.round((sent / stat.size) * 100),
        direction: 'sending',
      });
    });

    readStream.on('end', () => {
      console.log(`[Transfer] File sent: ${filename} (${stat.size} bytes)`);
      socket.end();
      this.activeSending.delete(transferId);
      resolve();
      this.emit('transfer-complete', {
        transferId,
        filename,
        direction: 'sending',
      });
    });

    readStream.on('error', (err) => {
      console.error('[Transfer] Read stream error:', err.message);
      socket.destroy();
      this.activeSending.delete(transferId);
      entry.reject(err);
      this.emit('transfer-error', { transferId, error: err.message });
    });
  }

  // ─── Receiving ─────────────────────────────────────────────────────────────

  _handleIncomingConnection(socket) {
    let headerLength = 0;
    let headerParsed = false;
    let transferId = null;
    let rawBuf = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      rawBuf = Buffer.concat([rawBuf, chunk]);

      if (!headerParsed) {
        // Need at least 4 bytes for the header length prefix
        if (rawBuf.length < 4) return;

        headerLength = rawBuf.readUInt32BE(0);

        if (rawBuf.length < 4 + headerLength) return;

        const headerBytes = rawBuf.slice(4, 4 + headerLength);
        rawBuf = rawBuf.slice(4 + headerLength);
        headerParsed = true;

        try {
          const header = JSON.parse(headerBytes.toString('utf8'));
          transferId = header.transferId;

          if (header.type === 'transfer-request') {
            const initialData = rawBuf;
            rawBuf = Buffer.alloc(0); // reset; further data handled by active receiver
            this._handlePinChallenge(socket, header, initialData);
          }
        } catch (err) {
          console.error('[Transfer] Failed to parse incoming header:', err.message);
          socket.destroy();
        }
      } else if (transferId && this.activeReceiving.has(transferId)) {
        // Stream remaining data to the write stream
        this._writeChunk(transferId, rawBuf);
        rawBuf = Buffer.alloc(0);
      } else if (transferId && this.pendingPinCheck.has(transferId)) {
        // Data arrived while we are waiting for the pin-response message.
        // Accumulate it — it will be the pin-response JSON.
        // (handled inline in _handlePinChallenge via the socket 'data' listener added there)
      }
    });

    socket.on('error', (err) => {
      console.error('[Transfer] Incoming socket error:', err.message);

      if (transferId) {
        // Clean up PIN check state if present
        if (this.pendingPinCheck.has(transferId)) {
          const pinEntry = this.pendingPinCheck.get(transferId);
          if (pinEntry.onPinData) socket.removeListener('data', pinEntry.onPinData);
          clearTimeout(pinEntry.timer);
          this.pendingPinCheck.delete(transferId);
        }

        // Clean up if still waiting for user accept/decline
        if (this.pendingIncoming.has(transferId)) {
          this.pendingIncoming.delete(transferId);
          this.emit('transfer-error', { transferId, error: 'cancelled' });
        }

        if (this.activeReceiving.has(transferId)) {
          const entry = this.activeReceiving.get(transferId);
          entry.writeStream && entry.writeStream.destroy();
          this.activeReceiving.delete(transferId);
          this.emit('transfer-error', { transferId, error: err.message });
        }
      }
    });

    socket.on('close', () => {
      if (transferId) {
        // Clean up a pending PIN check if the sender disconnected early
        if (this.pendingPinCheck.has(transferId)) {
          const pinEntry = this.pendingPinCheck.get(transferId);
          if (pinEntry.onPinData) socket.removeListener('data', pinEntry.onPinData);
          clearTimeout(pinEntry.timer);
          this.pendingPinCheck.delete(transferId);
        }

        // Clean up if still waiting for user accept/decline (sender cancelled mid-prompt)
        if (this.pendingIncoming.has(transferId)) {
          this.pendingIncoming.delete(transferId);
          this.emit('transfer-error', { transferId, error: 'cancelled' });
        }

        if (this.activeReceiving.has(transferId)) {
          const entry = this.activeReceiving.get(transferId);
          if (entry.received >= entry.header.fileSize) {
            // Already completed
            return;
          }
          entry.writeStream && entry.writeStream.destroy();
          this.activeReceiving.delete(transferId);
          this.emit('transfer-error', {
            transferId,
            error: 'Connection closed before transfer completed',
          });
        }
      }
    });
  }

  /**
   * Called as soon as the transfer-request header has been parsed.
   *
   * If PIN protection is disabled, delegates immediately to _onTransferRequest.
   * If PIN protection is enabled:
   *   - Sends { type: 'pin-required' } back to the sender.
   *   - Waits up to 30 s for a { type: 'pin-response', pin } message on the socket.
   *   - Validates the PIN:
   *       Correct  → proceeds to _onTransferRequest (normal accept/decline flow).
   *       Wrong    → sends { type: 'pin-wrong' }, destroys the socket.
   *   - If the timeout fires before a response arrives, destroys the socket.
   *
   * @param {net.Socket} socket
   * @param {object}     header      - Parsed transfer-request header.
   * @param {Buffer}     initialData - Any bytes that arrived alongside the header.
   */
  _handlePinChallenge(socket, header, initialData) {
    if (!this.pinEnabled) {
      // No PIN required — proceed directly to the normal flow.
      this._onTransferRequest(socket, header, initialData);
      return;
    }

    const { transferId, senderName } = header;
    console.log(
      `[Transfer] PIN required for transfer ${transferId} from ${senderName}`
    );

    // Tell the sender they must supply a PIN.
    socket.write(JSON.stringify({ type: 'pin-required' }));

    // Notify the receiver's UI so they can choose to share their PIN or decline.
    this.emit('pin-share-request', { transferId, senderName });

    // Accumulate data arriving on this socket for the pin-response message.
    let pinResponseBuf = Buffer.alloc(0);

    // 30-second timeout — if no valid pin-response arrives, close the connection.
    const timer = setTimeout(() => {
      if (this.pendingPinCheck.has(transferId)) {
        console.warn(
          `[Transfer] PIN challenge timed out for transfer ${transferId}`
        );
        this.pendingPinCheck.delete(transferId);
        socket.destroy();
        this.emit('transfer-error', { transferId, error: 'pin-timeout' });
      }
    }, 30000);

    this.pendingPinCheck.set(transferId, { socket, header, initialData, timer });

    // Listen for the pin-response on this socket.
    // We attach a one-shot 'data' listener here so we can capture the response
    // without interfering with the outer connection handler's rawBuf accumulation.
    const onPinData = (chunk) => {
      pinResponseBuf = Buffer.concat([pinResponseBuf, chunk]);

      let parsed;
      try {
        parsed = JSON.parse(pinResponseBuf.toString('utf8'));
      } catch (_) {
        // Incomplete JSON — wait for more data.
        return;
      }

      // We have a complete JSON message; remove this listener regardless of outcome.
      socket.removeListener('data', onPinData);

      const pinEntry = this.pendingPinCheck.get(transferId);
      if (!pinEntry) return; // already cleaned up (e.g. timeout fired or receiver approved)

      if (parsed.type !== 'pin-response') {
        // Unexpected message type — treat as wrong PIN.
        console.warn(
          `[Transfer] Expected pin-response but got '${parsed.type}' for ${transferId}`
        );
        clearTimeout(pinEntry.timer);
        this.pendingPinCheck.delete(transferId);
        socket.write(JSON.stringify({ type: 'pin-wrong' }));
        socket.destroy();
        this.emit('transfer-error', { transferId, error: 'wrong-pin' });
        return;
      }

      const submittedPin = parsed.pin;

      if (submittedPin !== this.currentPin) {
        console.warn(
          `[Transfer] Wrong PIN submitted for transfer ${transferId}`
        );
        clearTimeout(pinEntry.timer);
        this.pendingPinCheck.delete(transferId);
        socket.write(JSON.stringify({ type: 'pin-wrong' }));
        socket.destroy();
        this.emit('transfer-error', { transferId, error: 'wrong-pin' });
        return;
      }

      // Correct PIN — proceed to the normal request flow.
      console.log(`[Transfer] Correct PIN for transfer ${transferId}; proceeding`);
      clearTimeout(pinEntry.timer);
      this.pendingPinCheck.delete(transferId);
      this._onTransferRequest(socket, header, initialData);
    };

    // Store the listener reference so revealPinToReceiver / declinePinRequest
    // can remove it before calling _onTransferRequest.
    this.pendingPinCheck.get(transferId).onPinData = onPinData;
    socket.on('data', onPinData);
  }

  /**
   * Called once a transfer-request has passed any PIN check (or no PIN is required).
   * Stores the pending transfer and notifies the UI to show accept/decline.
   *
   * @param {net.Socket} socket
   * @param {object}     header
   * @param {Buffer}     initialData
   */
  _onTransferRequest(socket, header, initialData) {
    const { transferId, senderName, filename, fileSize } = header;
    console.log(
      `[Transfer] Incoming request from ${senderName}: ${filename} (${fileSize} bytes)`
    );

    // Store the pending socket so we can respond later
    this.pendingIncoming.set(transferId, { socket, header, initialData });

    // Notify the UI — include requiresPin so the UI knows PIN was already verified
    this.emit('incoming-request', {
      transferId,
      senderName,
      filename,
      fileSize,
      requiresPin: this.pinEnabled,
    });
  }

  respondToTransfer(transferId, accepted, savePath) {
    const pending = this.pendingIncoming.get(transferId);
    if (!pending) {
      console.warn('[Transfer] No pending transfer found for id:', transferId);
      return;
    }

    const { socket, header, initialData } = pending;
    this.pendingIncoming.delete(transferId);

    if (!accepted) {
      const response = JSON.stringify({ type: 'transfer-decline', transferId });
      socket.write(response);
      socket.end();
      console.log(`[Transfer] Declined transfer ${transferId}`);
      return;
    }

    // Accept
    const response = JSON.stringify({ type: 'transfer-accept', transferId });
    socket.write(response);
    console.log(`[Transfer] Accepted transfer ${transferId}, saving to: ${savePath}`);

    const writeStream = fs.createWriteStream(savePath);

    const entry = {
      socket,
      header,
      savePath,
      writeStream,
      received: 0,
    };

    this.activeReceiving.set(transferId, entry);

    writeStream.on('error', (err) => {
      console.error('[Transfer] Write stream error:', err.message);
      socket.destroy();
      this.activeReceiving.delete(transferId);
      this.emit('transfer-error', { transferId, error: err.message });
    });

    // Write any data that arrived before we could set up the stream
    if (initialData && initialData.length > 0) {
      this._writeChunk(transferId, initialData);
    }
  }

  _writeChunk(transferId, chunk) {
    const entry = this.activeReceiving.get(transferId);
    if (!entry) return;

    entry.writeStream.write(chunk);
    entry.received += chunk.length;

    this.emit('transfer-progress', {
      transferId,
      filename: entry.header.filename,
      received: entry.received,
      total: entry.header.fileSize,
      percent: Math.round((entry.received / entry.header.fileSize) * 100),
      direction: 'receiving',
    });

    if (entry.received >= entry.header.fileSize) {
      entry.writeStream.end();
      this.activeReceiving.delete(transferId);
      console.log(
        `[Transfer] Received complete: ${entry.header.filename} → ${entry.savePath}`
      );
      this.emit('transfer-complete', {
        transferId,
        filename: entry.header.filename,
        savePath: entry.savePath,
        direction: 'receiving',
      });
    }
  }

  _sendHeader(socket, headerObj) {
    const headerBytes = Buffer.from(JSON.stringify(headerObj), 'utf8');
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(headerBytes.length, 0);
    socket.write(Buffer.concat([lengthBuf, headerBytes]));
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this._handleIncomingConnection(socket));

      this.server.on('error', (err) => {
        console.error('[Transfer] Server error:', err);
        reject(err);
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        console.log(`[Transfer] Listening on port ${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Clear any pending PIN checks
    for (const [, entry] of this.pendingPinCheck) {
      clearTimeout(entry.timer);
      entry.socket && entry.socket.destroy();
    }
    this.pendingPinCheck.clear();

    // Close any active connections
    for (const [, entry] of this.activeSending) {
      entry.socket && entry.socket.destroy();
    }
    for (const [, entry] of this.activeReceiving) {
      entry.socket && entry.socket.destroy();
      entry.writeStream && entry.writeStream.destroy();
    }
    this.activeSending.clear();
    this.activeReceiving.clear();
    this.pendingIncoming.clear();
  }
}

module.exports = TransferService;
