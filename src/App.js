import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import DropNotch from './components/DropNotch';
import IncomingPrompt from './components/IncomingPrompt';
import NameSetup from './components/NameSetup';
import Settings from './components/Settings';
import './styles/global.css';

const api = window.dropzone;

export default function App() {
  const [deviceInfo, setDeviceInfo]           = useState(null);
  const [needsNameSetup, setNeedsNameSetup]   = useState(false);
  const [peers, setPeers]                     = useState([]);
  const [droppedFile, setDroppedFile]         = useState(null);
  const [showPicker, setShowPicker]           = useState(false);
  const [showSettings, setShowSettings]       = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [transfers, setTransfers]             = useState({});
  const [notifications, setNotifications]     = useState([]);
  const [pingAlert, setPingAlert]             = useState(null);

  // Settings state
  const [saveFolder, setSaveFolder]   = useState(null);
  const [pinEnabled, setPinEnabled]   = useState(false);
  const [currentPin, setCurrentPin]   = useState(null);

  // PIN entry dialog (sender side)
  const [pinChallenge, setPinChallenge] = useState(null); // { transferId }
  const [pinInput, setPinInput]         = useState('');
  const [pinError, setPinError]         = useState(false);

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const info = await api.getDeviceInfo();
      setDeviceInfo(info);
      if (info.needsNameSetup) {
        setNeedsNameSetup(true);
        api.resizeWindow(400, 480);
        return;
      }
      const initialPeers = await api.getPeers();
      setPeers(initialPeers);

      // Load settings
      const settings = await api.getSettings();
      setSaveFolder(settings.saveFolder || null);
      setPinEnabled(settings.pinEnabled || false);
      setCurrentPin(settings.pin || null);
    })();

    api.onPeersUpdated((updatedPeers) => setPeers(updatedPeers));

    api.onIncomingTransfer((info) => {
      setIncomingRequest(info);
      api.resizeWindow(400, 280);
    });

    api.onTransferProgress((progress) => {
      setTransfers((prev) => ({
        ...prev,
        [progress.transferId]: { ...prev[progress.transferId], ...progress, status: 'progress' },
      }));
    });

    api.onTransferComplete((info) => {
      setTransfers((prev) => ({
        ...prev,
        [info.transferId]: { ...prev[info.transferId], ...info, status: 'complete' },
      }));
      addNotification(
        info.direction === 'receiving'
          ? `✅ Received "${info.filename}"`
          : `✅ Sent "${info.filename}" successfully`
      );
      setTimeout(() => {
        setTransfers((prev) => { const n = { ...prev }; delete n[info.transferId]; return n; });
        api.resizeWindow(400, 36);
      }, 3000);
    });

    api.onTransferError((info) => {
      setTransfers((prev) => ({
        ...prev,
        [info.transferId]: { ...prev[info.transferId], ...info, status: 'error' },
      }));
      // Clear PIN challenge if the error is PIN-related
      if (info.error === 'wrong-pin' || info.error === 'pin-timeout') {
        setPinChallenge(null);
        setPinInput('');
        if (info.error === 'wrong-pin') setPinError(true);
      }
      addNotification(
        info.error === 'declined'   ? `❌ Transfer declined`
        : info.error === 'wrong-pin' ? `❌ Wrong PIN — transfer rejected`
        : `❌ Transfer failed: ${info.error}`
      );
      setTimeout(() => {
        setTransfers((prev) => { const n = { ...prev }; delete n[info.transferId]; return n; });
        api.resizeWindow(400, 36);
      }, 3000);
    });

    api.onPingReceived((info) => {
      setPingAlert(info.senderName);
      api.playPingSound();
      setTimeout(() => setPingAlert(null), 4000);
    });

    // Receiver requires a PIN — show PIN entry to the sender
    api.onPinRequired((info) => {
      setPinChallenge({ transferId: info.transferId });
      setPinInput('');
      setPinError(false);
      api.resizeWindow(400, 52 + 1 + 148 + 12);
    });

    return () => {
      ['peers-updated', 'incoming-transfer-request', 'transfer-progress',
       'transfer-complete', 'transfer-error', 'ping-received', 'pin-required']
        .forEach((ch) => api.removeAllListeners(ch));
    };
  }, []);

  // ── Window sizing ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (needsNameSetup) return;
    const activeTransfers = Object.values(transfers);
    const W   = 400;
    const PAD = 12;
    if (pinChallenge) {
      api.resizeWindow(W, 52 + 1 + 148 + PAD);
    } else if (showSettings) {
      api.resizeWindow(W, 52 + 1 + 268 + PAD);
    } else if (showPicker) {
      const peerH = peers.length === 0 ? 80 : Math.min(peers.length, 4) * 54 + 8;
      api.resizeWindow(W, 52 + 1 + peerH + 44 + PAD);
    } else if (activeTransfers.length > 0) {
      api.resizeWindow(W, 52 + 1 + activeTransfers.length * 54 + 12 + PAD);
    } else if (!incomingRequest) {
      api.resizeWindow(W, 36 + PAD);
    }
  }, [pinChallenge, showSettings, showPicker, transfers, peers.length, incomingRequest, needsNameSetup]);

  // ── Notifications ──────────────────────────────────────────────────────────
  const addNotification = useCallback((message) => {
    const id = Date.now();
    setNotifications((prev) => [...prev, { id, message }]);
    setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 3500);
  }, []);

  // ── Name + avatar setup save ───────────────────────────────────────────────
  const handleNameSave = useCallback(async (name, avatar) => {
    await api.saveDeviceName(name, avatar);
    setDeviceInfo((prev) => ({ ...prev, name, avatar }));
    setNeedsNameSetup(false);
    const initialPeers = await api.getPeers();
    setPeers(initialPeers);
    const settings = await api.getSettings();
    setSaveFolder(settings.saveFolder || null);
    setPinEnabled(settings.pinEnabled || false);
    setCurrentPin(settings.pin || null);
    api.resizeWindow(400, 36);
  }, []);

  // ── Settings handlers ──────────────────────────────────────────────────────
  const handleTogglePin = useCallback(async (enabled) => {
    const res = await api.saveSettings({ pinEnabled: enabled });
    setPinEnabled(enabled);
    if (res.pin) setCurrentPin(res.pin);
  }, []);

  const handleRefreshPin = useCallback(async () => {
    const res = await api.saveSettings({ refreshPin: true });
    if (res.pin) setCurrentPin(res.pin);
  }, []);

  const handlePickSaveFolder = useCallback(async () => {
    const result = await api.showFolderDialog();
    if (!result.canceled && result.filePaths?.[0]) {
      const folder = result.filePaths[0];
      await api.saveSettings({ saveFolder: folder });
      setSaveFolder(folder);
    }
  }, []);

  const handleClearSaveFolder = useCallback(async () => {
    await api.saveSettings({ saveFolder: null });
    setSaveFolder(null);
  }, []);

  // ── File drop ──────────────────────────────────────────────────────────────
  const handleFileDrop = useCallback((file) => {
    setDroppedFile(file);
    setShowPicker(true);
  }, []);

  const handleOpenPeers = useCallback(() => {
    setShowPicker(true);
  }, []);

  // ── Send to peer ───────────────────────────────────────────────────────────
  const handleSendTo = useCallback(async (peerId) => {
    if (!droppedFile) return;
    setShowPicker(false);
    const transferId = uuidv4();
    setTransfers((prev) => ({
      ...prev,
      [transferId]: {
        transferId,
        filename: droppedFile.name,
        status: 'sending',
        direction: 'sending',
        percent: 0,
      },
    }));
    const result = await api.sendFile(droppedFile.path, peerId, transferId);
    if (!result.success) {
      addNotification(`❌ ${result.error}`);
      setTransfers((prev) => { const n = { ...prev }; delete n[transferId]; return n; });
    }
    setDroppedFile(null);
  }, [droppedFile, addNotification]);

  const handlePickerClose = useCallback(() => {
    setShowPicker(false);
    setDroppedFile(null);
  }, []);

  // ── Ping ───────────────────────────────────────────────────────────────────
  const handlePing = useCallback((peerId) => {
    api.sendPing(peerId);
    addNotification('🔔 Ping sent!');
  }, [addNotification]);

  // ── Accept incoming ────────────────────────────────────────────────────────
  const handleAccept = useCallback(async () => {
    if (!incomingRequest) return;
    const { transferId, filename } = incomingRequest;

    let filePath;
    if (saveFolder) {
      // Use default folder — no dialog
      filePath = `${saveFolder}/${filename}`;
    } else {
      const result = await api.showSaveDialog(filename);
      if (result.canceled) {
        api.respondToTransfer(transferId, false, null);
        setIncomingRequest(null);
        return;
      }
      filePath = result.filePath;
    }

    api.respondToTransfer(transferId, true, filePath);
    setTransfers((prev) => ({
      ...prev,
      [transferId]: { transferId, filename, status: 'receiving', direction: 'receiving', percent: 0 },
    }));
    setIncomingRequest(null);
  }, [incomingRequest, saveFolder]);

  const handleDecline = useCallback(() => {
    if (!incomingRequest) return;
    api.respondToTransfer(incomingRequest.transferId, false, null);
    setIncomingRequest(null);
    addNotification('Transfer declined');
  }, [incomingRequest, addNotification]);

  // ── PIN submission (sender side) ───────────────────────────────────────────
  const handlePinSubmit = useCallback((e) => {
    e.preventDefault();
    if (pinInput.length !== 6) return;
    api.submitPin(pinChallenge.transferId, pinInput);
    setPinChallenge(null);
    setPinInput('');
    setPinError(false);
  }, [pinChallenge, pinInput]);

  const activeTransfers = Object.values(transfers);

  return (
    <div className="app-root">
      {/* First-launch name + avatar setup */}
      <AnimatePresence>
        {needsNameSetup && <NameSetup onSave={handleNameSave} />}
      </AnimatePresence>

      {!needsNameSetup && (
        <DropNotch
          deviceName={deviceInfo?.name}
          avatar={deviceInfo?.avatar}
          peers={peers}
          droppedFile={droppedFile}
          onFileDrop={handleFileDrop}
          onOpenPeers={handleOpenPeers}
          onSendTo={handleSendTo}
          onCancelPicker={handlePickerClose}
          onPing={handlePing}
          transfers={activeTransfers}
          showPicker={showPicker}
          showSettings={showSettings}
          settingsContent={
            <Settings
              deviceName={deviceInfo?.name}
              avatar={deviceInfo?.avatar}
              pinEnabled={pinEnabled}
              pin={currentPin}
              onTogglePin={handleTogglePin}
              onRefreshPin={handleRefreshPin}
              saveFolder={saveFolder}
              onPickSaveFolder={handlePickSaveFolder}
              onClearSaveFolder={handleClearSaveFolder}
              onClose={() => setShowSettings(false)}
            />
          }
          showPin={!!pinChallenge}
          pinContent={
            pinChallenge ? (
              <div className="pin-panel">
                <div className="pin-panel-header">
                  <span className="pin-panel-icon">🔐</span>
                  <div>
                    <div className="pin-panel-title">PIN Required</div>
                    <div className="pin-panel-subtitle">Ask the receiver for their PIN</div>
                  </div>
                </div>
                <form onSubmit={handlePinSubmit} className="pin-panel-form">
                  <input
                    className={`pin-panel-input ${pinError ? 'has-error' : ''}`}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="_ _ _ _ _ _"
                    value={pinInput}
                    onChange={(e) => {
                      setPinError(false);
                      setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                    }}
                    autoFocus
                  />
                  {pinError && <span className="pin-panel-error">Wrong PIN — try again</span>}
                  <div className="pin-panel-actions">
                    <button type="button" className="cancel-btn"
                      onClick={() => { setPinChallenge(null); setPinInput(''); setPinError(false); }}>
                      Cancel
                    </button>
                    <button type="submit" className="pin-panel-submit"
                      disabled={pinInput.length !== 6}>
                      Submit
                    </button>
                  </div>
                </form>
              </div>
            ) : null
          }
          onOpenSettings={() => { setShowSettings(true); setShowPicker(false); }}
        />
      )}

      {/* Incoming transfer prompt */}
      <AnimatePresence>
        {incomingRequest && (
          <IncomingPrompt
            request={incomingRequest}
            onAccept={handleAccept}
            onDecline={handleDecline}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pingAlert && <PingAlert name={pingAlert} />}
      </AnimatePresence>

      <div className="notifications">
        <AnimatePresence>
          {notifications.map((n) => (
            <Notification key={n.id} message={n.message} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Notification({ message }) {
  return (
    <motion.div className="toast"
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
      {message}
    </motion.div>
  );
}

function PingAlert({ name }) {
  return (
    <motion.div className="ping-alert"
      initial={{ opacity: 0, scale: 0.8, y: -10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: -10 }}
      transition={{ type: 'spring', stiffness: 500, damping: 32 }}>
      <motion.span
        animate={{ rotate: [0, -25, 25, -15, 15, -8, 8, 0] }}
        transition={{ duration: 0.7, repeat: 2 }}
        style={{ display: 'inline-block' }}>🔔</motion.span>
      <span><strong>{name}</strong> is pinging you!</span>
    </motion.div>
  );
}
