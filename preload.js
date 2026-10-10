const { contextBridge, ipcRenderer } = require('electron');

/**
 * Secure IPC bridge exposed to the renderer via window.dropzone
 * Only whitelisted channels are accessible — no raw ipcRenderer access.
 */
contextBridge.exposeInMainWorld('dropzone', {
  // ── Queries ──────────────────────────────────────────────────────────────
  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),
  getPeers: () => ipcRenderer.invoke('get-peers'),

  // ── Actions ──────────────────────────────────────────────────────────────
  sendFile: (filePath, peerId, transferId) => ipcRenderer.invoke('send-file', { filePath, peerId, transferId }),
  respondToTransfer: (transferId, accepted, savePath) =>
    ipcRenderer.invoke('respond-to-transfer', { transferId, accepted, savePath }),
  showSaveDialog: (filename) => ipcRenderer.invoke('show-save-dialog', { filename }),
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', { width, height }),
  sendPing: (peerId) => ipcRenderer.invoke('send-ping', { peerId }),
  playPingSound: () => ipcRenderer.send('play-ping-sound'),

  // ── Event listeners ──────────────────────────────────────────────────────
  onPeersUpdated: (callback) => {
    ipcRenderer.on('peers-updated', (_, peers) => callback(peers));
  },
  onIncomingTransfer: (callback) => {
    ipcRenderer.on('incoming-transfer-request', (_, info) => callback(info));
  },
  onTransferProgress: (callback) => {
    ipcRenderer.on('transfer-progress', (_, progress) => callback(progress));
  },
  onTransferComplete: (callback) => {
    ipcRenderer.on('transfer-complete', (_, info) => callback(info));
  },
  onTransferError: (callback) => {
    ipcRenderer.on('transfer-error', (_, info) => callback(info));
  },
  onPingReceived: (callback) => {
    ipcRenderer.on('ping-received', (_, info) => callback(info));
  },

  // ── Cleanup ──────────────────────────────────────────────────────────────
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
