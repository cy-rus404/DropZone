import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import '../styles/DropNotch.css';

const PLATFORM_ICONS = { win32: '🪟', darwin: '🍎', linux: '🐧', unknown: '💻' };

const FILE_ICONS = {
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
  mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬',
  mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵',
  pdf: '📕', doc: '📝', docx: '📝', txt: '📄', md: '📄',
  zip: '📦', rar: '📦', tar: '📦', gz: '📦',
  js: '⚙️', ts: '⚙️', py: '🐍', json: '📋',
  exe: '💻', dmg: '💻', app: '💻',
};

function fileIcon(name) {
  if (!name) return '📄';
  return FILE_ICONS[name.split('.').pop().toLowerCase()] || '📄';
}

function formatBytes(b) {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * DropNotch
 *
 * Idle:    Small rounded pill (like a camera cutout) — just a dot at the top
 * Hover:   Expands to show device name, peer count, drop hint
 * Active:  Fully expanded to show device picker or transfer progress
 */
export default function DropNotch({
  deviceName,
  peers,
  droppedFile,
  onFileDrop,
  onOpenPeers,
  onSendTo,
  onCancelPicker,
  onPing,
  transfers,
  showPicker,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pingTarget, setPingTarget] = useState(null);
  const dragCounter = useRef(0);

  const isActive = showPicker || transfers.length > 0 || isDragOver;
  const isExpanded = isHovered || isActive;

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const handleDragEnter = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items?.length > 0) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragOver(false);
    dragCounter.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (file) onFileDrop({ name: file.name, size: file.size, type: file.type, path: file.path });
  }, [onFileDrop]);

  // ── Ping ───────────────────────────────────────────────────────────────────
  const handlePing = useCallback((e, peerId) => {
    e.stopPropagation();
    setPingTarget(peerId);
    onPing(peerId);
    setTimeout(() => setPingTarget(null), 1200);
  }, [onPing]);

  // ── Sizing ─────────────────────────────────────────────────────────────────
  // Collapsed: small pill  — 120px × 28px
  // Hovered:   bar          — 380px × 52px
  // Picker:    tall         — 380px × dynamic
  // Transfer:  medium       — 380px × dynamic

  const pickerContentH = peers.length === 0
    ? 80
    : Math.min(peers.length, 4) * 54 + 8;

  const expandedWidth = isExpanded ? 380 : 120;
  const expandedHeight = isExpanded
    ? showPicker
      ? 52 + 1 + pickerContentH + 44   // bar + divider + list + footer
      : transfers.length > 0
      ? 52 + 1 + transfers.length * 54 + 12
      : 52
    : 28;

  const spring = { type: 'spring', stiffness: 380, damping: 32 };

  return (
    <motion.div
      className={`notch ${isDragOver ? 'drag-over' : ''} ${isExpanded ? 'expanded' : ''}`}
      animate={{ width: expandedWidth, height: expandedHeight, borderRadius: isExpanded ? 18 : 14 }}
      transition={spring}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ originX: 0.5, originY: 0 }}
    >
      {/* ── Collapsed dot indicator (visible when not expanded) ── */}
      <AnimatePresence>
        {!isExpanded && (
          <motion.div className="notch-dot"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}>
            <span className="notch-dot-icon">🌀</span>
            {peers.length > 0 && (
              <span className="notch-dot-badge">{peers.length}</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Expanded bar ── */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div className="notch-bar"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}>

            {/* Left: logo + name */}
            <div className="notch-left">
              <motion.span className="logo"
                animate={{ rotate: isDragOver ? [0, -12, 12, -6, 6, 0] : 0 }}
                transition={{ duration: 0.4 }}>🌀</motion.span>
              <div className="device-info">
                <span className="app-name">DropZone</span>
                <span className="device-name">{deviceName || '—'}</span>
              </div>
            </div>

            {/* Center: context hint */}
            <div className="notch-center">
              <AnimatePresence mode="wait">
                {droppedFile && !showPicker ? (
                  <motion.div key="file" className="file-pill"
                    initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.15 }}>
                    <span className="file-pill-icon">{fileIcon(droppedFile.name)}</span>
                    <span className="file-pill-name">{droppedFile.name}</span>
                    <span className="file-pill-size">{formatBytes(droppedFile.size)}</span>
                  </motion.div>
                ) : isDragOver ? (
                  <motion.span key="drop" className="hint-active"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    Release to drop
                  </motion.span>
                ) : showPicker ? (
                  <motion.span key="pick" className="hint-dim"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    Choose a device
                  </motion.span>
                ) : transfers.length > 0 ? (
                  <motion.span key="xfr" className="hint-dim"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    Transferring…
                  </motion.span>
                ) : (
                  <motion.span key="idle" className="hint-idle"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    Drop a file to send
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            {/* Right: peer badge */}
            <motion.button
              className={`peer-badge ${peers.length > 0 ? 'has-peers' : ''}`}
              onClick={() => !showPicker && onOpenPeers()}
              whileHover={{ scale: 1.07 }}
              whileTap={{ scale: 0.93 }}
              title="View devices"
            >
              <span className="peer-count">{peers.length}</span>
              <span className="peer-label">{peers.length === 1 ? 'dev' : 'devs'}</span>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Device Picker ── */}
      <AnimatePresence>
        {showPicker && isExpanded && (
          <motion.div className="notch-expanded"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}>
            <div className="divider" />
            {peers.length === 0 ? (
              <div className="no-peers">
                <span>🔍</span>
                <p>No devices found</p>
                <p className="no-peers-hint">Open DropZone on another device</p>
              </div>
            ) : (
              <div className="peer-list">
                {peers.map((peer, i) => (
                  <motion.div key={peer.id} className="peer-row"
                    initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04, type: 'spring', stiffness: 400, damping: 28 }}>
                    <button
                      className={`peer-send-btn ${!droppedFile ? 'ping-only' : ''}`}
                      onClick={() => droppedFile && onSendTo(peer.id)}
                      disabled={!droppedFile}
                    >
                      <span className="peer-avatar">{PLATFORM_ICONS[peer.platform] || '💻'}</span>
                      <span className="peer-name">{peer.name}</span>
                      <span className="peer-ip">{peer.host}</span>
                      {droppedFile && <span className="send-chevron">→</span>}
                    </button>
                    <motion.button
                      className={`ping-btn ${pingTarget === peer.id ? 'pinging' : ''}`}
                      onClick={(e) => handlePing(e, peer.id)}
                      whileTap={{ scale: 0.82 }}
                      title="Ping"
                    >
                      <motion.span
                        animate={pingTarget === peer.id
                          ? { scale: [1, 1.5, 1], rotate: [0, -20, 20, 0] } : {}}
                        transition={{ duration: 0.45 }}>🔔</motion.span>
                    </motion.button>
                  </motion.div>
                ))}
              </div>
            )}
            <div className="picker-footer">
              <button className="cancel-btn" onClick={onCancelPicker}>Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Transfer progress ── */}
      <AnimatePresence>
        {transfers.length > 0 && !showPicker && isExpanded && (
          <motion.div className="notch-expanded"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}>
            <div className="divider" />
            <div className="transfer-list">
              {transfers.map((t) => <TransferRow key={t.transferId} transfer={t} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function TransferRow({ transfer }) {
  const { filename, percent = 0, direction, status } = transfer;
  const isComplete = status === 'complete';
  const isError = status === 'error';

  return (
    <motion.div className="transfer-row"
      initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}>
      <div className="transfer-row-top">
        <span className={`xfr-badge ${direction === 'sending' ? 'send' : 'recv'}`}>
          {direction === 'sending' ? '↑' : '↓'}
        </span>
        <span className="xfr-name" title={filename}>{filename}</span>
        <span className="xfr-pct">
          {isComplete ? '✓' : isError ? '✗' : `${percent}%`}
        </span>
      </div>
      <div className="xfr-track">
        <motion.div
          className={`xfr-fill ${isComplete ? 'done' : isError ? 'err' : ''}`}
          initial={{ width: 0 }}
          animate={{ width: `${isComplete ? 100 : percent}%` }}
          transition={{ ease: 'easeOut', duration: 0.3 }}
        />
        {!isComplete && !isError && (
          <motion.div className="xfr-shimmer"
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }} />
        )}
      </div>
    </motion.div>
  );
}
