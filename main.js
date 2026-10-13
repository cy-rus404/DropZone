const { app, BrowserWindow, ipcMain, screen, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');

// Reliable production detection that works at module load time.
// app.isPackaged can be false at require-time on some Electron versions.
// __dirname inside a packaged asar always contains 'app.asar', so we use
// that as a secondary check alongside app.isPackaged.
function getIsDev() {
  if (app.isPackaged) return false;
  if (__dirname.includes('app.asar')) return false;
  return true;
}
const isDev = getIsDev();
const TRANSFER_PORT = 54321;
const BROADCAST_PORT = 54320;

let mainWindow = null;
let tray = null;
let discoveryService = null;
let transferService = null;

// Unique device ID persisted across sessions
const configPath = path.join(app.getPath('userData'), 'device.json');
let deviceId     = null;
let deviceName   = null;
let deviceAvatar = null;

// Saved pill position — loaded from device.json on startup
let pillX = null;
let pillY = null;

// Settings persisted in device.json
let saveFolder  = null;   // default save path or null
let pinEnabled  = false;
let currentPin  = null;   // 6-digit string

function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * On Windows, silently add firewall rules for the discovery broadcast port and
 * transfer port so Windows Defender doesn't block them. Runs once; failures are
 * non-fatal (user may not have admin rights, rules may already exist).
 */
function ensureWindowsFirewallRules() {
  if (process.platform !== 'win32') return;
  const rules = [
    ['DropZone-Discovery-In',  'Inbound',  'UDP', String(BROADCAST_PORT)],
    ['DropZone-Discovery-Out', 'Outbound', 'UDP', String(BROADCAST_PORT)],
    ['DropZone-Transfer-In',   'Inbound',  'TCP', String(TRANSFER_PORT)],
    ['DropZone-Transfer-Out',  'Outbound', 'TCP', String(TRANSFER_PORT)],
    ['DropZone-mDNS-In',       'Inbound',  'UDP', '5353'],
  ];
  for (const [name, dir, proto, port] of rules) {
    execFile('netsh', [
      'advfirewall', 'firewall', 'add', 'rule',
      `name=${name}`, `dir=${dir.toLowerCase()}`, 'action=allow',
      `protocol=${proto}`, `localport=${port}`,
    ], (err) => {
      if (err) console.warn(`[Firewall] Could not add rule "${name}": ${err.message}`);
      else console.log(`[Firewall] Rule ensured: ${name}`);
    });
  }
}

function loadOrCreateDeviceId() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      deviceId     = data.id;
      deviceName   = data.name;
      deviceAvatar = data.avatar || null;

      // Load saved pill position if present
      if (typeof data.pillX === 'number' && typeof data.pillY === 'number') {
        pillX = data.pillX;
        pillY = data.pillY;
      }

      // Load settings
      saveFolder = data.saveFolder || null;
      pinEnabled = !!data.pinEnabled;
      currentPin = data.currentPin || generatePin();
    }
  } catch (e) {}

  if (!deviceId) {
    deviceId = uuidv4();
    deviceName = null;
    currentPin = generatePin();
    fs.writeFileSync(configPath, JSON.stringify({ id: deviceId, name: null, currentPin }));
  }

  // Default pill position: center-top
  if (pillX === null || pillY === null) {
    pillX = Math.floor(screenWidth / 2) - 200;
    pillY = 0;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 380,
    x: pillX,
    y: pillY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: false,
    // No vibrancy — it fills the whole window rectangle with frosted glass
    // regardless of the pill shape, creating a visible card behind it.
    // The pill's own CSS backdrop-filter handles the blur effect.
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(app.getAppPath(), 'build/index.html')}`;

  mainWindow.loadURL(startUrl);
  mainWindow.setIgnoreMouseEvents(false);

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.setMenuBarVisibility(false);

  if (isDev && process.env.OPEN_DEVTOOLS !== '0') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createTray() {
  // Create a simple tray icon programmatically if no asset exists
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let trayIcon;

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    // 16x16 blank native image fallback
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('DropZone');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show DropZone',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

// Renderer asks for this device's info
ipcMain.handle('get-device-info', () => {
  return { id: deviceId, name: deviceName, avatar: deviceAvatar, needsNameSetup: !deviceName };
});

// Renderer saves the user's chosen display name and avatar
ipcMain.handle('save-device-name', (event, { name, avatar }) => {
  deviceName   = name;
  deviceAvatar = avatar || null;
  persistConfig();
  // Update the running services with the new name/avatar
  if (discoveryService) {
    discoveryService.deviceName   = name;
    discoveryService.deviceAvatar = avatar || null;
    discoveryService.stop();
    discoveryService.start();
  }
  if (transferService) transferService.deviceName = name;
  return { success: true };
});

// Renderer asks for peers list
ipcMain.handle('get-peers', () => {
  if (discoveryService) {
    return discoveryService.getPeers();
  }
  return [];
});

// Renderer sends a file to a peer
ipcMain.handle('send-file', async (event, { filePath, peerId, transferId }) => {
  if (!transferService) return { success: false, error: 'Transfer service not ready' };
  try {
    const peers = discoveryService.getPeers();
    const peer = peers.find((p) => p.id === peerId);
    if (!peer) return { success: false, error: 'Peer not found' };
    await transferService.sendFile(filePath, peer.host, peer.port, peer.id, peer.name, transferId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Receiver accepts or declines an incoming transfer
ipcMain.handle('respond-to-transfer', async (event, { transferId, accepted, savePath }) => {
  if (!transferService) return;
  transferService.respondToTransfer(transferId, accepted, savePath);
});

// Open save dialog so user picks where to save
ipcMain.handle('show-save-dialog', async (event, { filename }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save received file',
    defaultPath: path.join(app.getPath('downloads'), filename),
    buttonLabel: 'Save here',
  });
  return result;
});

// Resize the window (notch expand/collapse) — keep centered on the pill's current x center
ipcMain.on('resize-window', (event, { width, height }) => {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    const currentCenterX = bounds.x + Math.floor(bounds.width / 2);
    const newX = currentCenterX - Math.floor(width / 2);
    mainWindow.setSize(width, height, true);
    mainWindow.setPosition(newX, bounds.y, true);
  }
});

// Save pill position: update window position and persist to device.json
ipcMain.handle('save-pill-position', (event, { x, y }) => {
  if (mainWindow) mainWindow.setPosition(x, y, false);
  pillX = x;
  pillY = y;
  persistConfig();
  return { success: true };
});

// Get current pill position from the window bounds
ipcMain.handle('get-pill-position', () => {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    return { x: bounds.x, y: bounds.y };
  }
  return { x: pillX, y: pillY };
});

// ── Settings helpers ──────────────────────────────────────────────────────────

function persistConfig() {
  try {
    let data = {};
    if (fs.existsSync(configPath)) {
      data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    Object.assign(data, {
      id: deviceId, name: deviceName, avatar: deviceAvatar,
      pillX, pillY, saveFolder, pinEnabled, currentPin,
    });
    fs.writeFileSync(configPath, JSON.stringify(data));
  } catch (e) {
    console.warn('[persistConfig] Failed:', e.message);
  }
}

// Get current settings
ipcMain.handle('get-settings', () => ({
  saveFolder,
  pinEnabled,
  pin: currentPin,
}));

// Save settings (PIN toggle, PIN refresh, save folder)
ipcMain.handle('save-settings', (event, settings) => {
  if (typeof settings.pinEnabled === 'boolean') pinEnabled = settings.pinEnabled;
  if (settings.refreshPin) currentPin = generatePin();
  if ('saveFolder' in settings) saveFolder = settings.saveFolder;
  persistConfig();
  // Update transfer service with new PIN state
  if (transferService) transferService.setPin(currentPin, pinEnabled);
  return { success: true, pin: currentPin };
});

// Open a folder picker dialog
ipcMain.handle('show-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose default save folder',
    buttonLabel: 'Select Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result;
});

// Sender submits a PIN
ipcMain.handle('submit-pin', (event, { transferId, pin }) => {
  if (transferService) transferService.submitPin(transferId, pin);
});

// Sender cancels a pending/in-flight transfer
ipcMain.handle('cancel-transfer', (event, { transferId }) => {
  if (transferService) transferService.cancelTransfer(transferId);
});

// Receiver asks the service to show their PIN (so they can relay it to the sender)
ipcMain.handle('reveal-pin-to-receiver', (event, { transferId }) => {
  if (transferService) transferService.revealPinToReceiver(transferId);
});

// Receiver declines a PIN-protected incoming connection
ipcMain.handle('decline-pin-request', (event, { transferId }) => {
  if (transferService) transferService.declinePinRequest(transferId);
});

// Send a ping to a peer
ipcMain.handle('send-ping', async (event, { peerId }) => {
  if (discoveryService) discoveryService.sendPing(peerId);
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  loadOrCreateDeviceId();
  ensureWindowsFirewallRules();

  // Allow the renderer to fetch and play audio from the Pixabay CDN
  const { session } = require('electron');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "media-src 'self' https://cdn.pixabay.com; " +
          "connect-src 'self' https://cdn.pixabay.com; " +
          "img-src 'self' data: blob:;"
        ],
      },
    });
  });

  createMainWindow();
  createTray();

  // Lazy-load services after window is ready
  const DiscoveryService = require('./src/services/discoveryService');
  const TransferService = require('./src/services/transferService');

  discoveryService = new DiscoveryService(deviceId, deviceName, TRANSFER_PORT, deviceAvatar);
  transferService = new TransferService(deviceId, deviceName, TRANSFER_PORT);

  // Apply persisted PIN settings to the transfer service
  transferService.setPin(currentPin, pinEnabled);

  // Wire transfer service events → renderer
  transferService.on('incoming-request', (transferInfo) => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('incoming-transfer-request', transferInfo);
    }
  });

  transferService.on('transfer-progress', (progress) => {
    if (mainWindow) {
      mainWindow.webContents.send('transfer-progress', progress);
    }
  });

  transferService.on('transfer-complete', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('transfer-complete', info);
    }
  });

  transferService.on('transfer-error', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('transfer-error', info);
    }
  });

  transferService.on('pin-required', (info) => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('pin-required', info);
    }
  });

  // Receiver gets notified that a PIN-protected sender has connected
  transferService.on('pin-share-request', (info) => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('pin-share-request', info);
    }
  });

  discoveryService.on('peers-updated', (peers) => {
    if (mainWindow) mainWindow.webContents.send('peers-updated', peers);
  });

  discoveryService.on('ping-received', (info) => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('ping-received', info);
    }
  });

  await discoveryService.start();
  await transferService.start();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  if (discoveryService) discoveryService.stop();
  if (transferService) transferService.stop();
});
