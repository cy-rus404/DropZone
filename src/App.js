import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import { motion } from 'framer-motion';
import DropNotch from './components/DropNotch';
import IncomingPrompt from './components/IncomingPrompt';
import './styles/global.css';

const api = window.dropzone;

export default function App() {
  const [deviceInfo, setDeviceInfo]     = useState(null);
  const [peers, setPeers]               = useState([]);
  const [droppedFile, setDroppedFile]   = useState(null);
  const [showPicker, setShowPicker]     = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [transfers, setTransfers]       = useState({}); // transferId → status obj
  const [notifications, setNotifications] = useState([]);
  const [pingAlert, setPingAlert]       = useState(null); // incoming ping sender name

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const info = await api.getDeviceInfo();
      setDeviceInfo(info);
      const initialPeers = await api.getPeers();
      setPeers(initialPeers);
    })();

    api.onPeersUpdated((updatedPeers) => setPeers(updatedPeers));

    api.onIncomingTransfer((info) => {
      setIncomingRequest(info);
      api.resizeWindow(420, 280);
    });

    api.onTransferProgress((progress) => {
      setTransfers((prev) => ({
        ...prev,
        [progress.transferId]: {
          ...prev[progress.transferId],
          ...progress,
          status: 'progress',
        },
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
        api.resizeWindow(420, 110);
      }, 3000);
    });

    api.onTransferError((info) => {
      setTransfers((prev) => ({
        ...prev,
        [info.transferId]: { ...prev[info.transferId], ...info, status: 'error' },
      }));
      const msg = info.error === 'declined'
        ? `❌ Transfer declined`
        : `❌ Transfer failed: ${info.error}`;
      addNotification(msg);
      setTimeout(() => {
        setTransfers((prev) => { const n = { ...prev }; delete n[info.transferId]; return n; });
        api.resizeWindow(420, 110);
      }, 3000);
    });

    // Incoming ping
    api.onPingReceived((info) => {
      setPingAlert(info.senderName);
      api.playPingSound();
      setTimeout(() => setPingAlert(null), 3500);
    });

    return () => {
      ['peers-updated', 'incoming-transfer-request', 'transfer-progress',
       'transfer-complete', 'transfer-error', 'ping-received']
        .forEach((ch) => api.removeAllListeners(ch));
    };
  }, []);

  // ── Window sizing ──────────────────────────────────────────────────────────
  useEffect(() => {
    const activeTransfers = Object.values(transfers);
    const hasActive = activeTransfers.length > 0;

    if (showPicker) {
      const h = 64 + 16 + Math.min(peers.length, 4) * 56 + 52 + (peers.length === 0 ? 80 : 0);
      api.resizeWindow(420, Math.max(h, 180));
    } else if (hasActive) {
      api.resizeWindow(420, 64 + activeTransfers.length * 62 + 16);
    } else if (!incomingRequest) {
      api.resizeWindow(420, 110);
    }
  }, [showPicker, transfers, peers.length, incomingRequest]);

  // ── Notifications ──────────────────────────────────────────────────────────
  const addNotification = useCallback((message) => {
    const id = Date.now();
    setNotifications((prev) => [...prev, { id, message }]);
    setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 3500);
  }, []);

  // ── File drop ──────────────────────────────────────────────────────────────
  const handleFileDrop = useCallback((file) => {
    setDroppedFile(file);
    if (peers.length === 0) {
      addNotification('⚠️ No devices found on your network');
      return;
    }
    setShowPicker(true);
  }, [peers, addNotification]);

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

  // ── Cancel picker ──────────────────────────────────────────────────────────
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
    const result = await api.showSaveDialog(filename);
    if (result.canceled) {
      api.respondToTransfer(transferId, false, null);
      setIncomingRequest(null);
      return;
    }
    api.respondToTransfer(transferId, true, result.filePath);
    setTransfers((prev) => ({
      ...prev,
      [transferId]: { transferId, filename, status: 'receiving', direction: 'receiving', percent: 0 },
    }));
    setIncomingRequest(null);
  }, [incomingRequest]);

  // ── Decline incoming ───────────────────────────────────────────────────────
  const handleDecline = useCallback(() => {
    if (!incomingRequest) return;
    api.respondToTransfer(incomingRequest.transferId, false, null);
    setIncomingRequest(null);
    addNotification('Transfer declined');
  }, [incomingRequest, addNotification]);

  const activeTransfers = Object.values(transfers);

  return (
    <div className="app-root">
      <DropNotch
        deviceName={deviceInfo?.name}
        peers={peers}
        droppedFile={droppedFile}
        onFileDrop={handleFileDrop}
        onSendTo={handleSendTo}
        onCancelPicker={handlePickerClose}
        onPing={handlePing}
        transfers={activeTransfers}
        showPicker={showPicker}
      />

      {/* Incoming transfer prompt — separate card, appears below notch */}
      <AnimatePresence>
        {incomingRequest && (
          <IncomingPrompt
            request={incomingRequest}
            onAccept={handleAccept}
            onDecline={handleDecline}
          />
        )}
      </AnimatePresence>

      {/* Ping alert */}
      <AnimatePresence>
        {pingAlert && <PingAlert name={pingAlert} />}
      </AnimatePresence>

      {/* Toast notifications */}
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
        style={{ display: 'inline-block' }}
      >🔔</motion.span>
      <span><strong>{name}</strong> is pinging you!</span>
    </motion.div>
  );
}
