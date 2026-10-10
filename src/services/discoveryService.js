const { EventEmitter } = require('events');
const { Bonjour } = require('bonjour-service');
const os = require('os');

const SERVICE_TYPE = 'dropzone';
const SERVICE_PROTOCOL = 'tcp';

/**
 * DiscoveryService
 * Advertises this device on the local network and discovers other DropZone instances.
 * Emits:
 *   'peers-updated' → array of peer objects whenever the peer list changes
 */
class DiscoveryService extends EventEmitter {
  constructor(deviceId, deviceName, port) {
    super();
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.port = port;
    this.bonjour = null;
    this.publishedService = null;
    this.browser = null;
    this.peers = new Map(); // peerId → peer info
  }

  /**
   * Returns the primary non-internal IPv4 address for this machine.
   */
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

  async start() {
    this.bonjour = new Bonjour();

    // Advertise this device
    this.publishedService = this.bonjour.publish({
      name: `${this.deviceName}__${this.deviceId}`,
      type: SERVICE_TYPE,
      protocol: SERVICE_PROTOCOL,
      port: this.port,
      txt: {
        id: this.deviceId,
        name: this.deviceName,
        platform: process.platform,
        version: '1.0.0',
      },
    });

    console.log(`[Discovery] Advertising as "${this.deviceName}" on port ${this.port}`);

    // Browse for other DropZone instances
    this.browser = this.bonjour.find({
      type: SERVICE_TYPE,
      protocol: SERVICE_PROTOCOL,
    });

    this.browser.on('up', (service) => {
      this._onServiceUp(service);
    });

    this.browser.on('down', (service) => {
      this._onServiceDown(service);
    });

    this.browser.start();
    console.log('[Discovery] Browsing for peers...');
  }

  _onServiceUp(service) {
    try {
      const txt = service.txt || {};
      const peerId = txt.id;

      // Ignore ourselves
      if (!peerId || peerId === this.deviceId) return;

      // Prefer IPv4 address
      const host =
        (service.addresses && service.addresses.find((a) => a.includes('.'))) ||
        service.host ||
        service.referer?.address;

      if (!host) {
        console.warn('[Discovery] Service up but no host address:', service.name);
        return;
      }

      const peer = {
        id: peerId,
        name: txt.name || service.name,
        host,
        port: service.port,
        platform: txt.platform || 'unknown',
        online: true,
        discoveredAt: Date.now(),
      };

      this.peers.set(peerId, peer);
      console.log(`[Discovery] Peer joined: ${peer.name} @ ${peer.host}:${peer.port}`);
      this.emit('peers-updated', this.getPeers());
    } catch (err) {
      console.error('[Discovery] Error handling service up:', err);
    }
  }

  _onServiceDown(service) {
    try {
      const txt = service.txt || {};
      const peerId = txt.id;

      if (!peerId || peerId === this.deviceId) return;

      if (this.peers.has(peerId)) {
        const peer = this.peers.get(peerId);
        console.log(`[Discovery] Peer left: ${peer.name}`);
        this.peers.delete(peerId);
        this.emit('peers-updated', this.getPeers());
      }
    } catch (err) {
      console.error('[Discovery] Error handling service down:', err);
    }
  }

  getPeers() {
    return Array.from(this.peers.values());
  }

  stop() {
    console.log('[Discovery] Shutting down...');
    try {
      if (this.browser) {
        this.browser.stop();
        this.browser = null;
      }
      if (this.publishedService) {
        this.publishedService.stop();
        this.publishedService = null;
      }
      if (this.bonjour) {
        this.bonjour.destroy();
        this.bonjour = null;
      }
    } catch (err) {
      console.error('[Discovery] Error during shutdown:', err);
    }
  }
}

module.exports = DiscoveryService;
