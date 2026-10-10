const { EventEmitter } = require('events');
const { Bonjour } = require('bonjour-service');
const os = require('os');
const dns = require('dns');

const SERVICE_TYPE = 'dropzone';
const SERVICE_PROTOCOL = 'tcp';
// Re-browse every 15 seconds to catch missed peers (especially on Windows)
const REBROWSE_INTERVAL_MS = 15000;

/**
 * DiscoveryService
 * Advertises this device on the local network and discovers other DropZone instances.
 * Emits:
 *   'peers-updated' → array of peer objects whenever the peer list changes
 *
 * Windows mDNS notes:
 *  - bonjour-service uses multicast-dns which can miss services on Windows due to
 *    network adapter/firewall issues. We mitigate this by stopping and restarting
 *    the browser on a periodic interval so fresh queries are sent.
 *  - Windows may return hostnames instead of IP addresses in service.addresses.
 *    We resolve hostnames to IPs via dns.lookup as a fallback.
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
    this._rebrowseTimer = null;
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

    this._startBrowsing();

    // On Windows, periodically re-browse to pick up peers that were missed
    // due to multicast packet loss or firewall interference.
    if (process.platform === 'win32') {
      this._rebrowseTimer = setInterval(() => {
        console.log('[Discovery] Re-browsing for peers (Windows periodic refresh)...');
        this._stopBrowsing();
        this._startBrowsing();
      }, REBROWSE_INTERVAL_MS);
    }
  }

  _startBrowsing() {
    if (!this.bonjour) return;

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

  _stopBrowsing() {
    if (this.browser) {
      try {
        this.browser.stop();
      } catch (_) {}
      this.browser = null;
    }
  }

  async _resolveHost(host) {
    // If it already looks like an IPv4 address, use it directly
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;

    // Otherwise try to resolve the hostname to an IP
    return new Promise((resolve) => {
      dns.lookup(host, 4, (err, address) => {
        if (err || !address) {
          console.warn(`[Discovery] Could not resolve hostname "${host}": ${err?.message}`);
          resolve(host); // fall back to original
        } else {
          resolve(address);
        }
      });
    });
  }

  async _onServiceUp(service) {
    try {
      const txt = service.txt || {};
      const peerId = txt.id;

      // Ignore ourselves
      if (!peerId || peerId === this.deviceId) return;

      // Skip if we already know this peer (avoid duplicate emits)
      if (this.peers.has(peerId)) return;

      // Prefer an explicit IPv4 address; fall back to hostname for DNS resolution
      let rawHost =
        (service.addresses && service.addresses.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a))) ||
        (service.addresses && service.addresses[0]) ||
        service.host ||
        service.referer?.address;

      if (!rawHost) {
        console.warn('[Discovery] Service up but no host address:', service.name);
        return;
      }

      // Resolve hostname → IP (important on Windows)
      const host = await this._resolveHost(rawHost);

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

    if (this._rebrowseTimer) {
      clearInterval(this._rebrowseTimer);
      this._rebrowseTimer = null;
    }

    try {
      this._stopBrowsing();
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
