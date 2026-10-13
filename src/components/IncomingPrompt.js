import React from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDownToLine,
  Image,
  Film,
  Music,
  FileText,
  File,
  Package,
} from 'lucide-react';
import '../styles/IncomingPrompt.css';

function formatBytes(bytes) {
  if (!bytes) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const FILE_ICON_MAP = {
  jpg: Image, jpeg: Image, png: Image, gif: Image, webp: Image, svg: Image,
  mp4: Film, mov: Film, avi: Film, mkv: Film,
  mp3: Music, wav: Music, flac: Music, aac: Music,
  pdf: FileText, doc: FileText, docx: FileText, txt: File, md: File,
  zip: Package, rar: Package, tar: Package, gz: Package,
};

function FileIcon({ filename, size = 26 }) {
  if (!filename) return <File size={size} />;
  const ext = filename.split('.').pop().toLowerCase();
  const Icon = FILE_ICON_MAP[ext] || File;
  return <Icon size={size} />;
}

/**
 * IncomingPrompt — AirDrop-style accept/decline popup.
 * Shown when another device wants to send a file.
 */
export default function IncomingPrompt({ request, onAccept, onDecline }) {
  const { senderName, filename, fileSize } = request;

  return (
    <motion.div
      className="incoming-overlay"
      initial={{ opacity: 0, scale: 0.85, y: -12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: -12 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
    >
      {/* Pulsing ring to grab attention */}
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
          <ArrowDownToLine size={20} className="incoming-icon-svg" />
        </motion.div>
        <div className="incoming-title">Incoming File</div>
      </div>

      <div className="incoming-body">
        <div className="sender-label">
          <span className="sender-name">{senderName}</span>
          <span className="wants-to-send"> wants to send you</span>
        </div>

        <div className="file-card">
          <div className="file-card-icon">
            <FileIcon filename={filename} size={26} />
          </div>
          <div className="file-card-info">
            <div className="file-card-name">{filename}</div>
            <div className="file-card-size">{formatBytes(fileSize)}</div>
          </div>
        </div>
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
        <motion.button
          className="action-btn accept-btn"
          onClick={onAccept}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
        >
          Accept
        </motion.button>
      </div>
    </motion.div>
  );
}
