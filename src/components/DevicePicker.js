import React from 'react';
import { motion } from 'framer-motion';
import '../styles/DevicePicker.css';

const PLATFORM_ICONS = {
  win32: '🪟',
  darwin: '🍎',
  linux: '🐧',
  unknown: '💻',
};

/**
 * DevicePicker — Slide-down panel showing available peers.
 * Appears below the notch when a file has been dropped.
 */
export default function DevicePicker({ peers, droppedFile, onSend, onClose }) {
  return (
    <motion.div
      className="picker-overlay"
      initial={{ opacity: 0, y: -20, scaleY: 0.8 }}
      animate={{ opacity: 1, y: 0, scaleY: 1 }}
      exit={{ opacity: 0, y: -20, scaleY: 0.8 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      style={{ originY: 0 }}
    >
      <div className="picker-header">
        <div className="picker-title">
          <span className="picker-icon">📡</span>
          <span>Send to...</span>
        </div>
        {droppedFile && (
          <div className="picker-file-badge">
            <span>{droppedFile.name}</span>
          </div>
        )}
      </div>

      <div className="picker-list">
        {peers.length === 0 ? (
          <motion.div
            className="no-peers-message"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <span className="no-peers-icon">🔍</span>
            <p>No devices found on your network.</p>
            <p className="hint">Make sure DropZone is open on the other device.</p>
          </motion.div>
        ) : (
          peers.map((peer, index) => (
            <motion.button
              key={peer.id}
              className="peer-item"
              onClick={() => onSend(peer.id)}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.06, type: 'spring', stiffness: 400, damping: 28 }}
              whileHover={{ scale: 1.02, x: 4 }}
              whileTap={{ scale: 0.97 }}
            >
              <div className="peer-avatar">
                {PLATFORM_ICONS[peer.platform] || '💻'}
              </div>
              <div className="peer-details">
                <span className="peer-name">{peer.name}</span>
                <span className="peer-host">{peer.host}</span>
              </div>
              <div className="send-arrow">→</div>
            </motion.button>
          ))
        )}
      </div>

      <div className="picker-footer">
        <motion.button
          className="cancel-btn"
          onClick={onClose}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          Cancel
        </motion.button>
      </div>
    </motion.div>
  );
}
