const { contextBridge, ipcRenderer } = require('electron');

/**
 * Secure IPC bridge exposed to the renderer via window.dropzone
 * Only whitelisted channels are accessible — no raw ipcRenderer access.
 */
contextBridge.exposeInMainWorld('dropzone', {
  // ── Queries ──────────────────────────────────────────────────────────────
  getDeviceInfo:    () => ipcRenderer.invoke('get-device-info'),
  getPeers:         () => ipcRenderer.invoke('get-peers'),
  getPillPosition:  () => ipcRenderer.invoke('get-pill-position'),
  getSettings:      () => ipcRenderer.invoke('get-settings'),

  // ── Mutations ─────────────────────────────────────────────────────────────
  saveDeviceName:   (name, avatar) => ipcRenderer.invoke('save-device-name', { name, avatar }),
  savePillPosition: (x, y)         => ipcRenderer.invoke('save-pill-position', { x, y }),
  saveSettings:     (settings)     => ipcRenderer.invoke('save-settings', settings),

  // ── Transfer actions ──────────────────────────────────────────────────────
  sendFile: (filePath, peerId, transferId) =>
    ipcRenderer.invoke('send-file', { filePath, peerId, transferId }),
  respondToTransfer: (transferId, accepted, savePath) =>
    ipcRenderer.invoke('respond-to-transfer', { transferId, accepted, savePath }),
  showSaveDialog:  (filename)  => ipcRenderer.invoke('show-save-dialog', { filename }),
  showFolderDialog: ()         => ipcRenderer.invoke('show-folder-dialog'),
  submitPin: (transferId, pin) => ipcRenderer.invoke('submit-pin', { transferId, pin }),

  // ── Window ────────────────────────────────────────────────────────────────
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', { width, height }),

  // ── Discovery ─────────────────────────────────────────────────────────────
  sendPing:      (peerId) => ipcRenderer.invoke('send-ping', { peerId }),
  playPingSound: ()       => ipcRenderer.send('play-ping-sound'),

  // ── Event listeners ───────────────────────────────────────────────────────
  onPeersUpdated:      (cb) => ipcRenderer.on('peers-updated',             (_, d) => cb(d)),
  onIncomingTransfer:  (cb) => ipcRenderer.on('incoming-transfer-request', (_, d) => cb(d)),
  onTransferProgress:  (cb) => ipcRenderer.on('transfer-progress',         (_, d) => cb(d)),
  onTransferComplete:  (cb) => ipcRenderer.on('transfer-complete',         (_, d) => cb(d)),
  onTransferError:     (cb) => ipcRenderer.on('transfer-error',            (_, d) => cb(d)),
  onPingReceived:      (cb) => ipcRenderer.on('ping-received',             (_, d) => cb(d)),
  onPinRequired:       (cb) => ipcRenderer.on('pin-required',              (_, d) => cb(d)),

  // ── Cleanup ───────────────────────────────────────────────────────────────
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
