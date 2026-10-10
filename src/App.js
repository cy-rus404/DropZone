import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import DropNotch from './components/DropNotch';
import DevicePicker from './components/DevicePicker';
import IncomingPrompt from './components/IncomingPrompt';
import TransferStatus from './components/TransferStatus';
import './styles/global.css';

const api = window.dropzone;

export default function App() {
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [peers, setPeers] = useState([]);
  const [droppedFile, setDroppedFile] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [transfers, setTransfers] = useState({}); // transferId → status obj
  const [notifications, setNotifications] = useState([]); // toast-style

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const info = await api.getDeviceInfo();
      setDeviceInfo(info);

      const initialPeers = await api.getPeers();
      setPeers(initialPeers);
    })();

    // Live peer updates
    api.onPeersUpdated((updatedPeers) => {
      setPeers(updatedPeers);
    });

    // Incoming file request
    api.onIncomingTransfer((info) => {
      setIncomingRequest(info);
      // Expand window for the prompt
      api.resizeWindow(420, 280);
    });

    // Transfer progress
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

    // Transfer complete
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

      // Clean up transfer entry after a delay
      setTimeout(() => {
        setTransfers((prev) => {
          const next = { ...prev };
          delete next[info.transferId];
          return next;
        });
      }, 4000);

      // Collapse window back
      api.resizeWindow(420, 110);
    });

    // Transfer error
    api.onTransferError((info) => {
      setTransfers((prev) => ({
        ...prev,
        [info.transferId]: { ...prev[info.transferId], ...info, status: 'error' },
      }));

      const msg = info.error === 'declined'
        ? `❌ Transfer declined by receiver`
        : `❌ Transfer failed: ${info.error}`;
      addNotification(msg);

      setTimeout(() => {
        setTransfers((prev) => {
          const next = { ...prev };
          delete next[info.transferId];
          return next;
        });
        api.resizeWindow(420, 110);
      }, 4000);
    });

    return () => {
      ['peers-updated', 'incoming-transfer-request', 'transfer-progress',
       'transfer-complete', 'transfer-error'].forEach((ch) => api.removeAllListeners(ch));
    };
  }, []);

  // ── Window sizing based on app state ──────────────────────────────────────
  useEffect(() => {
    const hasActiveTransfer = Object.keys(transfers).length > 0;
    if (hasActiveTransfer) {
      api.resizeWindow(420, 180);
    }
  }, [transfers]);

  // ── Notifications helper ───────────────────────────────────────────────────
  const addNotification = useCallback((message) => {
    const id = Date.now();
    setNotifications((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 3500);
  }, []);

  // ── File dropped on notch ──────────────────────────────────────────────────
  const handleFileDrop = useCallback(
    (file) => {
      setDroppedFile(file);
      if (peers.length === 0) {
        addNotification('⚠️ No devices found on your network');
        return;
      }
      setShowPicker(true);
      api.resizeWindow(420, 360);
    },
    [peers, addNotification]
  );

  // ── User picked a device ───────────────────────────────────────────────────
  const handleSendTo = useCallback(
    async (peerId) => {
      if (!droppedFile) return;
      setShowPicker(false);
      api.resizeWindow(420, 180);

      // Generate the transferId here so the UI entry and IPC events share the same key
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
        setTransfers((prev) => {
          const next = { ...prev };
          delete next[transferId];
          return next;
        });
        api.resizeWindow(420, 110);
      }
      // On success the transfer-complete event will clean up the entry

      setDroppedFile(null);
    },
    [droppedFile, addNotification]
  );

  // ── User cancelled device picker ───────────────────────────────────────────
  const handlePickerClose = useCallback(() => {
    setShowPicker(false);
    setDroppedFile(null);
    api.resizeWindow(420, 110);
  }, []);

  // ── Incoming file: Accept ──────────────────────────────────────────────────
  const handleAccept = useCallback(async () => {
    if (!incomingRequest) return;
    const { transferId, filename } = incomingRequest;

    const result = await api.showSaveDialog(filename);
    if (result.canceled) {
      api.respondToTransfer(transferId, false, null);
      setIncomingRequest(null);
      api.resizeWindow(420, 110);
      return;
    }

    api.respondToTransfer(transferId, true, result.filePath);

    setTransfers((prev) => ({
      ...prev,
      [transferId]: {
        transferId,
        filename,
        status: 'receiving',
        direction: 'receiving',
        percent: 0,
      },
    }));

    setIncomingRequest(null);
  }, [incomingRequest]);

  // ── Incoming file: Decline ─────────────────────────────────────────────────
  const handleDecline = useCallback(() => {
    if (!incomingRequest) return;
    api.respondToTransfer(incomingRequest.transferId, false, null);
    setIncomingRequest(null);
    api.resizeWindow(420, 110);
    addNotification('Transfer declined');
  }, [incomingRequest, addNotification]);

  const activeTransfers = Object.values(transfers);

  return (
    <div className="app-root">
      {/* Main floating notch */}
      <DropNotch
        deviceName={deviceInfo?.name}
        peerCount={peers.length}
        onFileDrop={handleFileDrop}
        isExpanded={showPicker || activeTransfers.length > 0}
        droppedFile={droppedFile}
      />

      {/* Device picker overlay */}
      <AnimatePresence>
        {showPicker && (
          <DevicePicker
            peers={peers}
            droppedFile={droppedFile}
            onSend={handleSendTo}
            onClose={handlePickerClose}
          />
        )}
      </AnimatePresence>

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

      {/* Active transfer progress bars */}
      <AnimatePresence>
        {activeTransfers.length > 0 && (
          <TransferStatus transfers={activeTransfers} />
        )}
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

// ── Inline Notification component ────────────────────────────────────────────
import { motion } from 'framer-motion';

function Notification({ message }) {
  return (
    <motion.div
      className="toast"
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      {message}
    </motion.div>
  );
}
