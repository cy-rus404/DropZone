import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import '../styles/DropNotch.css';

/**
 * DropNotch — The always-visible floating pill at the top of the screen.
 * Expands slightly on hover, glows on drag-over, shows dropped file info.
 */
export default function DropNotch({ deviceName, peerCount, onFileDrop, droppedFile }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      setIsDragging(false);
      dragCounter.current = 0;

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0]; // Take the first file
        onFileDrop({
          name: file.name,
          size: file.size,
          type: file.type,
          path: file.path, // Electron exposes file.path
        });
      }
    },
    [onFileDrop]
  );

  const getFileIcon = (filename) => {
    if (!filename) return '📄';
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
      mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬',
      mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵',
      pdf: '📕', doc: '📝', docx: '📝', txt: '📄', md: '📄',
      zip: '📦', rar: '📦', tar: '📦', gz: '📦',
      js: '⚙️', ts: '⚙️', py: '🐍', json: '📋',
      exe: '💻', dmg: '💻', app: '💻',
    };
    return icons[ext] || '📄';
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <motion.div
      className={`notch-container ${isDragOver ? 'drag-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      animate={{
        scaleX: isDragOver ? 1.04 : 1,
        scaleY: isDragOver ? 1.08 : 1,
      }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
    >
      {/* Drag-over glow ring */}
      <AnimatePresence>
        {isDragOver && (
          <motion.div
            className="drag-glow"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
        )}
      </AnimatePresence>

      <div className="notch-inner">
        {/* Left: Logo + device name */}
        <div className="notch-left">
          <motion.div
            className="logo-mark"
            animate={{
              rotate: isDragOver ? [0, -10, 10, -5, 5, 0] : 0,
              scale: isDragOver ? 1.2 : 1,
            }}
            transition={{ duration: 0.4 }}
          >
            🌀
          </motion.div>
          <div className="device-info">
            <span className="app-name">DropZone</span>
            <span className="device-name">{deviceName || 'Loading...'}</span>
          </div>
        </div>

        {/* Center: Drop hint or dropped file */}
        <div className="notch-center">
          <AnimatePresence mode="wait">
            {droppedFile ? (
              <motion.div
                key="file"
                className="dropped-file-info"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <span className="file-icon">{getFileIcon(droppedFile.name)}</span>
                <div className="file-meta">
                  <span className="file-name">{droppedFile.name}</span>
                  <span className="file-size">{formatBytes(droppedFile.size)}</span>
                </div>
              </motion.div>
            ) : isDragOver ? (
              <motion.div
                key="drop-hint"
                className="drop-hint active"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                Release to drop
              </motion.div>
            ) : (
              <motion.div
                key="idle-hint"
                className="drop-hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                Drop a file to send
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right: Peer count badge */}
        <div className="notch-right">
          <motion.div
            className={`peer-badge ${peerCount > 0 ? 'has-peers' : 'no-peers'}`}
            animate={{ scale: peerCount > 0 ? [1, 1.15, 1] : 1 }}
            transition={{ duration: 0.3 }}
            key={peerCount}
          >
            <span className="peer-count">{peerCount}</span>
            <span className="peer-label">{peerCount === 1 ? 'device' : 'devices'}</span>
          </motion.div>
        </div>
      </div>

      {/* Animated drop zone border sweep */}
      <AnimatePresence>
        {isDragOver && (
          <motion.div
            className="border-sweep"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            exit={{ pathLength: 0 }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
