const { EventEmitter } = require('events');
const { Bonjour } = require('bonjour-service');
const os = require('os');
const dns = require('dns');
const dgram = require('dgram');

const SERVICE_TYPE = 'dropzone';
const SERVICE_PROTOCOL = 'tcp';

// UDP broadcast fallback settings
const BROADCAST_PORT = 54320;          // separate UDP port for discovery beacons
const BEACON_INTERVAL_MS = 5000;       // how often we broadcast our presence
const REBROWSE_INTERVAL_MS = 15000;    // how often we restart mDNS browse on Windows
const PEER_EXPIRY_MS = 16000;          // remove peer if no beacon for ~3 intervals

/**
 * DiscoveryService
 * Dual-mode peer discovery:
 *   1. mDNS via bonjour-service (works well on Mac/Linux)
 *   2. UDP broadcast beacons (fallback for Windows where mDNS multicast is often blocked)
 *
 * Both modes are always active. A peer discovered by either method is added to the
 * shared peers Map and emitted via 'peers-updated'.
 *
 * UDP Beacon format (JSON over UDP broadcast to 255.255.255.255:54320):
 *   { type: 'dropzone-beacon', id, name, port, platform }
 *
 * Emits:
 *   'peers-updated' → array of peer objects whenever the peer list changes
 */
class DiscoveryService extends EventEmitter {
  constructor(deviceId, deviceName, port, deviceAvatar) {
    super();
    this.deviceId     = deviceId;
    this.deviceName   = deviceName;
    this.deviceAvatar = deviceAvatar || null;
    this.port = port;

    // mDNS
    this.bonjour = null;
    this.publishedService = null;
    this.browser = null;
    this._rebrowseTimer = null;

    // UDP broadcast
    this.udpSocket = null;
    this._beaconTimer = null;
    this._expiryTimer = null;

    this.peers = new Map(); // peerId → peer info
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  async _resolveHost(host) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
    return new Promise((resolve) => {
      dns.lookup(host, 4, (err, address) => {
        resolve((!err && address) ? address : host);
      });
    });
  }

  // ─── Start / Stop ──────────────────────────────────────────────────────────

  async start() {
    this._startMDNS();
    this._startUDPBeacon();
  }

  stop() {
    console.log('[Discovery] Shutting down...');
    this._sendGoodbye();
    this._stopMDNS();
    this._stopUDPBeacon();
  }

  // ─── mDNS ──────────────────────────────────────────────────────────────────

  _startMDNS() {
    try {
      this.bonjour = new Bonjour();

      this.publishedService = this.bonjour.publish({
        name: `${this.deviceName}__${this.deviceId}`,
        type: SERVICE_TYPE,
        protocol: SERVICE_PROTOCOL,
        port: this.port,
        txt: {
          id:       this.deviceId,
          name:     this.deviceName,
          avatar:   this.deviceAvatar || '',
          platform: process.platform,
          version:  '1.0.0',
        },
      });

      console.log(`[Discovery] mDNS: advertising as "${this.deviceName}" on port ${this.port}`);
      this._startBrowsing();

      // On Windows, periodically restart the browser to re-query for missed peers
      if (process.platform === 'win32') {
        this._rebrowseTimer = setInterval(() => {
          console.log('[Discovery] Re-browsing for peers (Windows periodic refresh)...');
          this._stopBrowsing();
          this._startBrowsing();
        }, REBROWSE_INTERVAL_MS);
      }
    } catch (err) {
      console.error('[Discovery] mDNS start error:', err.message);
    }
  }

  _stopMDNS() {
    if (this._rebrowseTimer) {
      clearInterval(this._rebrowseTimer);
      this._rebrowseTimer = null;
    }
    try {
      this._stopBrowsing();
      if (this.publishedService) { this.publishedService.stop(); this.publishedService = null; }
      if (this.bonjour) { this.bonjour.destroy(); this.bonjour = null; }
    } catch (err) {
      console.error('[Discovery] mDNS stop error:', err.message);
    }
  }

  _startBrowsing() {
    if (!this.bonjour) return;
    this.browser = this.bonjour.find({ type: SERVICE_TYPE, protocol: SERVICE_PROTOCOL });
    this.browser.on('up', (s) => this._onServiceUp(s));
    this.browser.on('down', (s) => this._onServiceDown(s));
    this.browser.start();
    console.log('[Discovery] Browsing for peers...');
  }

  _stopBrowsing() {
    if (this.browser) {
      try { this.browser.stop(); } catch (_) {}
      this.browser = null;
    }
  }

  async _onServiceUp(service) {
    try {
      const txt = service.txt || {};
      const peerId = txt.id;
      if (!peerId || peerId === this.deviceId) return;

      let rawHost =
        (service.addresses && service.addresses.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a))) ||
        (service.addresses && service.addresses[0]) ||
        service.host ||
        service.referer?.address;

      if (!rawHost) {
        console.warn('[Discovery] mDNS service up but no address:', service.name);
        return;
      }

      const host = await this._resolveHost(rawHost);
      this._addPeer({
        id:       peerId,
        name:     txt.name || service.name,
        avatar:   txt.avatar || null,
        host,
        port:     service.port,
        platform: txt.platform || 'unknown',
        via:      'mdns',
      });
    } catch (err) {
      console.error('[Discovery] mDNS service up error:', err);
    }
  }

  _onServiceDown(service) {
    try {
      const txt = service.txt || {};
      const peerId = txt.id;
      if (!peerId || peerId === this.deviceId) return;
      if (this.peers.has(peerId)) {
        console.log(`[Discovery] Peer left (mDNS): ${this.peers.get(peerId).name}`);
        this.peers.delete(peerId);
        this.emit('peers-updated', this.getPeers());
      }
    } catch (err) {
      console.error('[Discovery] mDNS service down error:', err);
    }
  }

  // ─── UDP Broadcast Beacon ──────────────────────────────────────────────────

  _startUDPBeacon() {
    try {
      this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.udpSocket.on('error', (err) => {
        console.error('[Discovery] UDP socket error:', err.message);
      });

      this.udpSocket.on('message', (msg, rinfo) => {
        this._onUDPMessage(msg, rinfo);
      });

      this.udpSocket.bind(BROADCAST_PORT, () => {
        try {
          this.udpSocket.setBroadcast(true);
          console.log(`[Discovery] UDP beacon listening on port ${BROADCAST_PORT}`);
          // Send an immediate beacon so peers that are already running see us right away
          this._sendBeacon();
        } catch (err) {
          console.error('[Discovery] UDP bind setup error:', err.message);
        }
      });

      // Broadcast our presence periodically
      this._beaconTimer = setInterval(() => this._sendBeacon(), BEACON_INTERVAL_MS);

      // Expire peers that haven't sent a beacon recently (handles crashes/force-quits)
      this._expiryTimer = setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [id, peer] of this.peers) {
          if (peer.via === 'udp' && (now - peer.lastSeen) > PEER_EXPIRY_MS) {
            console.log(`[Discovery] Peer expired (no beacon): ${peer.name}`);
            this.peers.delete(id);
            changed = true;
          }
        }
        if (changed) this.emit('peers-updated', this.getPeers());
      }, BEACON_INTERVAL_MS);
    } catch (err) {
      console.error('[Discovery] UDP beacon start error:', err.message);
    }
  }

  _stopUDPBeacon() {
    if (this._beaconTimer) {
      clearInterval(this._beaconTimer);
      this._beaconTimer = null;
    }
    if (this._expiryTimer) {
      clearInterval(this._expiryTimer);
      this._expiryTimer = null;
    }
    if (this.udpSocket) {
      try { this.udpSocket.close(); } catch (_) {}
      this.udpSocket = null;
    }
  }

  _sendGoodbye() {
    if (!this.udpSocket) return;
    const packet = Buffer.from(JSON.stringify({
      type: 'dropzone-goodbye',
      id: this.deviceId,
    }));
    // Send synchronously-ish — best effort before socket closes
    try {
      this.udpSocket.send(packet, 0, packet.length, BROADCAST_PORT, '255.255.255.255', () => {});
    } catch (_) {}
  }

  _sendBeacon() {
    if (!this.udpSocket) return;
    const beacon = Buffer.from(JSON.stringify({
      type:     'dropzone-beacon',
      id:       this.deviceId,
      name:     this.deviceName || 'Unknown Device',
      avatar:   this.deviceAvatar || '',
      port:     this.port,
      platform: process.platform,
    }));

    this.udpSocket.send(beacon, 0, beacon.length, BROADCAST_PORT, '255.255.255.255', (err) => {
      if (err) console.error('[Discovery] UDP beacon send error:', err.message);
    });
  }

  _onUDPMessage(msg, rinfo) {
    try {
      const data = JSON.parse(msg.toString('utf8'));
      if (data.type === 'dropzone-beacon') {
        if (!data.id || data.id === this.deviceId) return;
        // Always update — name or host may have changed since first discovery
        this._addPeer({
          id:       data.id,
          name:     data.name || 'Unknown Device',
          avatar:   data.avatar || null,
          host:     rinfo.address,
          port:     data.port,
          platform: data.platform || 'unknown',
          via:      'udp',
        });
      } else if (data.type === 'dropzone-goodbye') {
        if (!data.id || data.id === this.deviceId) return;
        if (this.peers.has(data.id)) {
          console.log(`[Discovery] Peer said goodbye: ${this.peers.get(data.id).name}`);
          this.peers.delete(data.id);
          this.emit('peers-updated', this.getPeers());
        }
      } else if (data.type === 'dropzone-ping') {
        if (data.targetId !== this.deviceId) return;
        console.log(`[Discovery] Ping received from ${data.senderName}`);
        this.emit('ping-received', { senderId: data.senderId, senderName: data.senderName });
      }
    } catch (_) {
      // Ignore malformed packets
    }
  }

  /**
   * Send a ping UDP packet directly to a known peer.
   */
  sendPing(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || !this.udpSocket) return;

    const packet = Buffer.from(JSON.stringify({
      type: 'dropzone-ping',
      senderId: this.deviceId,
      senderName: this.deviceName,
      targetId: peerId,
    }));

    this.udpSocket.send(packet, 0, packet.length, BROADCAST_PORT, peer.host, (err) => {
      if (err) console.error('[Discovery] Ping send error:', err.message);
      else console.log(`[Discovery] Ping sent to ${peer.name} @ ${peer.host}`);
    });
  }

  // ─── Shared peer management ────────────────────────────────────────────────

  _addPeer(peer) {
    const existing = this.peers.get(peer.id);
    const entry = {
      ...peer,
      name: peer.name || 'Unknown Device',
      online: true,
      discoveredAt: existing ? existing.discoveredAt : Date.now(),
      lastSeen: Date.now(),
    };

    // Only emit an update if something meaningful changed
    const changed = !existing
      || existing.name   !== entry.name
      || existing.avatar !== entry.avatar
      || existing.host   !== entry.host
      || existing.port   !== entry.port;

    this.peers.set(peer.id, entry);

    if (changed) {
      console.log(`[Discovery] Peer ${existing ? 'updated' : 'found'} (${peer.via}): ${entry.name} @ ${entry.host}:${entry.port}`);
      this.emit('peers-updated', this.getPeers());
    }
  }

  getPeers() {
    return Array.from(this.peers.values());
  }
}

module.exports = DiscoveryService;
