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
  const [pinChallenge, setPinChallenge] = useState(null); // { transferId, receiverName? }
  const [pinChallengeStep, setPinChallengeStep] = useState('prompt'); // 'prompt' | 'enter'
  const [pinInput, setPinInput]         = useState('');
  const [pinError, setPinError]         = useState(false);

  // PIN share prompt (receiver side — shown when a sender connects and needs the PIN)
  const [pinShareRequest, setPinShareRequest] = useState(null); // { transferId, senderName, revealedPin? }

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
      const isSilent = info.error === 'cancelled' || info.error === 'declined';

      if (!isSilent) {
        // Show the error state briefly before removing
        setTransfers((prev) => ({
          ...prev,
          [info.transferId]: { ...prev[info.transferId], ...info, status: 'error' },
        }));
      }

      // Clear PIN challenge for any error that terminates the transfer
      if (['wrong-pin', 'pin-timeout', 'declined', 'cancelled'].includes(info.error)) {
        setPinChallenge(null);
        setPinChallengeStep('prompt');
        setPinInput('');
        if (info.error === 'wrong-pin') setPinError(true);
      }

      addNotification(
        info.error === 'declined'   ? `❌ Transfer declined`
        : info.error === 'cancelled'  ? `❌ Transfer cancelled`
        : info.error === 'wrong-pin' ? `❌ Wrong PIN — transfer rejected`
        : `❌ Transfer failed: ${info.error}`
      );

      const delay = isSilent ? 0 : 3000;
      setTimeout(() => {
        setTransfers((prev) => { const n = { ...prev }; delete n[info.transferId]; return n; });
        api.resizeWindow(400, 36);
      }, delay);
    });

    api.onPingReceived((info) => {
      setPingAlert(info.senderName);
      api.playPingSound();
      setTimeout(() => setPingAlert(null), 4000);
    });

    // Receiver requires a PIN — show share/decline prompt to the sender first
    api.onPinRequired((info) => {
      setPinChallenge({ transferId: info.transferId });
      setPinChallengeStep('prompt');
      setPinInput('');
      setPinError(false);
      api.resizeWindow(400, 52 + 1 + 148 + 12);
    });

    // Receiver: a PIN-protected sender has connected — ask if they want to share their PIN
    api.onPinShareRequest((info) => {
      setPinShareRequest({ transferId: info.transferId, senderName: info.senderName });
      api.resizeWindow(400, 280);
    });

    // Receiver: service confirmed the PIN reveal — show it in the prompt
    api.onShowPinToReceiver((info) => {
      setPinShareRequest((prev) =>
        prev?.transferId === info.transferId ? { ...prev, revealedPin: info.pin } : prev
      );
    });

    return () => {
      ['peers-updated', 'incoming-transfer-request', 'transfer-progress',
       'transfer-complete', 'transfer-error', 'ping-received', 'pin-required',
       'pin-share-request', 'show-pin-to-receiver']
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
    const peer = peers.find((p) => p.id === peerId);
    setTransfers((prev) => ({
      ...prev,
      [transferId]: {
        transferId,
        filename: droppedFile.name,
        peerName: peer?.name || 'the receiver',
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
  }, [droppedFile, peers, addNotification]);

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
    setPinChallengeStep('prompt');
    setPinInput('');
    setPinError(false);
  }, [pinChallenge, pinInput]);

  const handlePinCancel = useCallback(() => {
    if (!pinChallenge) return;
    const { transferId } = pinChallenge;
    // Destroy the outgoing socket — this triggers transfer-error on the sender side
    // which will clean up the transfer entry via the onTransferError handler.
    api.cancelTransfer(transferId);
    setPinChallenge(null);
    setPinChallengeStep('prompt');
    setPinInput('');
    setPinError(false);
  }, [pinChallenge]);

  // ── Receiver PIN share prompt ───────────────────────────────────────────────
  const handleRevealPin = useCallback(() => {
    if (!pinShareRequest) return;
    api.revealPinToReceiver(pinShareRequest.transferId);
  }, [pinShareRequest]);

  const handleDeclinePinRequest = useCallback(() => {
    if (!pinShareRequest) return;
    api.declinePinRequest(pinShareRequest.transferId);
    setPinShareRequest(null);
    api.resizeWindow(400, 36);
  }, [pinShareRequest]);

  const handleDismissPinShareRequest = useCallback(() => {
    // Receiver shared the PIN and the sender is now working through the flow —
    // just dismiss the prompt without killing the connection.
    setPinShareRequest(null);
    api.resizeWindow(400, 36);
  }, []);

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
          pinStep={pinChallengeStep}
          pinContent={
            pinChallenge ? (() => {
              const receiverName =
                transfers[pinChallenge.transferId]?.peerName || 'the receiver';

              if (pinChallengeStep === 'prompt') {
                return (
                  <div className="pin-panel">
                    <div className="pin-panel-header">
                      <span className="pin-panel-icon">🔐</span>
                      <div>
                        <div className="pin-panel-title">PIN Protected</div>
                        <div className="pin-panel-subtitle">
                          {receiverName} requires a PIN to accept files
                        </div>
                      </div>
                    </div>
                    <p className="pin-share-hint">
                      Ask <strong>{receiverName}</strong> to share their PIN with you,
                      then enter it below.
                    </p>
                    <div className="pin-panel-actions pin-share-actions">
                      <button
                        type="button"
                        className="cancel-btn"
                        onClick={handlePinCancel}
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        className="pin-panel-submit"
                        onClick={() => setPinChallengeStep('enter')}
                      >
                        Enter PIN →
                      </button>
                    </div>
                  </div>
                );
              }

              // step === 'enter'
              return (
                <div className="pin-panel">
                  <div className="pin-panel-header">
                    <span className="pin-panel-icon">🔐</span>
                    <div>
                      <div className="pin-panel-title">Enter PIN</div>
                      <div className="pin-panel-subtitle">
                        Type the PIN shared by {receiverName}
                      </div>
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
                    {pinError && (
                      <span className="pin-panel-error">Wrong PIN — try again</span>
                    )}
                    <div className="pin-panel-actions">
                      <button
                        type="button"
                        className="cancel-btn"
                        onClick={() => setPinChallengeStep('prompt')}
                      >
                        ← Back
                      </button>
                      <button
                        type="submit"
                        className="pin-panel-submit"
                        disabled={pinInput.length !== 6}
                      >
                        Submit
                      </button>
                    </div>
                  </form>
                </div>
              );
            })() : null
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

      {/* Receiver PIN share prompt — shown when a sender connects and needs PIN */}
      <AnimatePresence>
        {pinShareRequest && (
          <PinSharePrompt
            request={pinShareRequest}
            onReveal={handleRevealPin}
            onDecline={handleDeclinePinRequest}
            onDismiss={handleDismissPinShareRequest}
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

/**
 * PinSharePrompt — shown on the RECEIVER's machine when a PIN-protected sender
 * connects.  Lets the receiver reveal their PIN (so they can relay it) or
 * decline the incoming connection entirely.
 *
 * Props:
 *   request   { transferId, senderName, revealedPin? }
 *   onReveal  () → ask the service to emit show-pin-to-receiver
 *   onDecline () → kill the connection
 *   onDismiss () → hide after pin was shared and sender is entering it
 */
function PinSharePrompt({ request, onReveal, onDecline, onDismiss }) {
  const { senderName, revealedPin } = request;

  return (
    <motion.div
      className="incoming-overlay"
      initial={{ opacity: 0, scale: 0.85, y: -12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: -12 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
    >
      <motion.div
        className="pulse-ring"
        animate={{ scale: [1, 1.6, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="incoming-header">
        <motion.div
          className="incoming-icon"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          🔐
        </motion.div>
        <div className="incoming-title">PIN Request</div>
      </div>

      <div className="incoming-body">
        <div className="sender-label">
          <span className="sender-name">{senderName}</span>
          <span className="wants-to-send"> wants to send you a file</span>
        </div>

        {!revealedPin ? (
          <p className="pin-share-body-hint">
            Share your PIN with them so they can connect.
          </p>
        ) : (
          <div className="pin-reveal-block">
            <div className="pin-reveal-label">Your PIN</div>
            <div className="pin-reveal-digits">
              {String(revealedPin).split('').join(' ')}
            </div>
            <p className="pin-reveal-hint">Tell this to {senderName}</p>
          </div>
        )}
      </div>

      <div className="incoming-actions">
        <motion.button
          className="action-btn decline-btn"
          onClick={onDecline}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
        >
          Decline
        </motion.button>

        {!revealedPin ? (
          <motion.button
            className="action-btn accept-btn"
            onClick={onReveal}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
          >
            Share PIN
          </motion.button>
        ) : (
          <motion.button
            className="action-btn accept-btn"
            onClick={onDismiss}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
          >
            Done
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}
