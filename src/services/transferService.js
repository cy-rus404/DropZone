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
 * Emits:
 *   'incoming-request'   → { transferId, senderName, filename, fileSize }
 *   'transfer-progress'  → { transferId, filename, received, total, percent }
 *   'transfer-complete'  → { transferId, filename, savePath, sent: bool }
 *   'transfer-error'     → { transferId, error }
 */
class TransferService extends EventEmitter {
  constructor(deviceId, deviceName, port) {
    super();
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.port = port;
    this.server = null;

    // Active incoming transfers waiting for user response
    // transferId → { resolve, reject, socket, header }
    this.pendingIncoming = new Map();

    // Active incoming transfers being received
    // transferId → { socket, header, savePath, writeStream, received }
    this.activeReceiving = new Map();

    // Active outgoing transfers
    // transferId → { socket }
    this.activeSending = new Map();
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

      // 30-second timeout waiting for accept/decline
      socket.setTimeout(30000, () => {
        if (this.activeSending.has(transferId)) {
          socket.destroy();
          this.activeSending.delete(transferId);
          reject(new Error('Transfer timed out waiting for response'));
        }
      });
    });
  }

  _handleSenderData(transferId, data) {
    try {
      const response = JSON.parse(data.toString('utf8'));
      const entry = this.activeSending.get(transferId);
      if (!entry) return;

      if (response.type === 'transfer-accept') {
        console.log(`[Transfer] Peer accepted transfer ${transferId}`);
        // Clear the timeout by resetting it to 0
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
    let headerBuffer = null;
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
            this._onTransferRequest(socket, header, rawBuf);
            rawBuf = Buffer.alloc(0); // reset; further data handled by active receiver
          }
        } catch (err) {
          console.error('[Transfer] Failed to parse incoming header:', err.message);
          socket.destroy();
        }
      } else if (transferId && this.activeReceiving.has(transferId)) {
        // Stream remaining data to the write stream
        this._writeChunk(transferId, rawBuf);
        rawBuf = Buffer.alloc(0);
      }
    });

    socket.on('error', (err) => {
      console.error('[Transfer] Incoming socket error:', err.message);
      if (transferId && this.activeReceiving.has(transferId)) {
        const entry = this.activeReceiving.get(transferId);
        entry.writeStream && entry.writeStream.destroy();
        this.activeReceiving.delete(transferId);
        this.emit('transfer-error', { transferId, error: err.message });
      }
    });

    socket.on('close', () => {
      if (transferId && this.activeReceiving.has(transferId)) {
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
    });
  }

  _onTransferRequest(socket, header, initialData) {
    const { transferId, senderName, filename, fileSize } = header;
    console.log(
      `[Transfer] Incoming request from ${senderName}: ${filename} (${fileSize} bytes)`
    );

    // Store the pending socket so we can respond later
    this.pendingIncoming.set(transferId, { socket, header, initialData });

    // Notify the UI
    this.emit('incoming-request', { transferId, senderName, filename, fileSize });
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

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
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
