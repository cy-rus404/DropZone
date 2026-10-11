const { app, BrowserWindow, ipcMain, screen, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { execFile } = require('child_process');

const isDev = process.env.NODE_ENV !== 'production';
const TRANSFER_PORT = 54321;
const BROADCAST_PORT = 54320;

let mainWindow = null;
let tray = null;
let discoveryService = null;
let transferService = null;

// Unique device ID persisted across sessions
const configPath = path.join(app.getPath('userData'), 'device.json');
let deviceId = null;
let deviceName = null;

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
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      deviceId = data.id;
      deviceName = data.name;
    }
  } catch (e) {}

  if (!deviceId) {
    deviceId = uuidv4();
    // No name yet — leave deviceName null so the renderer shows the setup screen
    deviceName = null;
    fs.writeFileSync(configPath, JSON.stringify({ id: deviceId, name: null }));
  }
}

function createMainWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 400,
    height: 380,
    x: Math.floor(screenWidth / 2) - 200,
    y: 0,
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
    : `file://${path.join(__dirname, 'build/index.html')}`;

  mainWindow.loadURL(startUrl);
  mainWindow.setIgnoreMouseEvents(false);

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
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
  return { id: deviceId, name: deviceName, needsNameSetup: !deviceName };
});

// Renderer saves the user's chosen display name
ipcMain.handle('save-device-name', (event, { name }) => {
  deviceName = name;
  fs.writeFileSync(configPath, JSON.stringify({ id: deviceId, name: deviceName }));
  // Update the running services with the new name
  if (discoveryService) {
    discoveryService.deviceName = name;
    // Re-advertise with the new name
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

// Resize the window (notch expand/collapse)
ipcMain.on('resize-window', (event, { width, height }) => {
  if (mainWindow) {
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    mainWindow.setSize(width, height, true);
    mainWindow.setPosition(Math.floor(screenWidth / 2) - Math.floor(width / 2), 0, true);
  }
});

// Send a ping to a peer
ipcMain.handle('send-ping', async (event, { peerId }) => {
  if (discoveryService) discoveryService.sendPing(peerId);
});

// Play the ping sound on the receiver side for ~3 seconds
ipcMain.on('play-ping-sound', () => {
  if (process.platform === 'darwin') {
    // afplay each sound and chain them to fill ~3 seconds
    const { exec } = require('child_process');
    const sound = '/System/Library/Sounds/Ping.aiff';
    // Run afplay 3 times sequentially (~1s each)
    exec(`afplay "${sound}" && afplay "${sound}" && afplay "${sound}"`);
  } else if (process.platform === 'win32') {
    // PowerShell: beep 3 times at 880Hz, 300ms each with 100ms gaps = ~1.2s
    // Repeat the sequence twice for ~3s total
    const { exec } = require('child_process');
    exec(
      'powershell -c "' +
      '[console]::beep(880,300); Start-Sleep -Milliseconds 100;' +
      '[console]::beep(880,300); Start-Sleep -Milliseconds 100;' +
      '[console]::beep(880,300); Start-Sleep -Milliseconds 100;' +
      '[console]::beep(1046,300); Start-Sleep -Milliseconds 100;' +
      '[console]::beep(1046,300); Start-Sleep -Milliseconds 100;' +
      '[console]::beep(1046,500)"'
    );
  }
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  loadOrCreateDeviceId();
  ensureWindowsFirewallRules();
  createMainWindow();
  createTray();

  // Lazy-load services after window is ready
  const DiscoveryService = require('./src/services/discoveryService');
  const TransferService = require('./src/services/transferService');

  discoveryService = new DiscoveryService(deviceId, deviceName, TRANSFER_PORT);
  transferService = new TransferService(deviceId, deviceName, TRANSFER_PORT);

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
