import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import '../styles/Settings.css';

const AVATARS = [
  '🐶','🐱','🦊','🐼','🐨','🦁',
  '🐯','🐸','🐧','🦋','🦄','🐲',
  '👾','🤖','👻','🎃','⚡','🔥',
  '🌊','🌈','🍕','🎮','🚀','💎',
];

/**
 * Settings
 *
 * Slides in to replace the peer-list area inside the notch pill.
 *
 * Props:
 *   deviceName        {string}   Current device display name
 *   avatar            {string}   Emoji avatar for this device
 *   pinEnabled        {boolean}  Whether PIN protection is active
 *   pin               {string}   6-digit PIN string, e.g. '482193'
 *   onTogglePin       {fn}       Called with (boolean) when toggle flips
 *   onRefreshPin      {fn}       Called when 🔄 is pressed
 *   saveFolder        {string}   Absolute path or null/empty
 *   onPickSaveFolder  {fn}       Called when 'Browse…' is clicked
 *   onClearSaveFolder {fn}       Called when 'Clear' is clicked
 *   onSaveProfile     {fn}       Called with (name, avatar) when profile is saved
 *   onClose           {fn}       Called when 'Done' / close is pressed
 */
export default function Settings({
  deviceName,
  avatar,
  pinEnabled,
  pin,
  onTogglePin,
  onRefreshPin,
  saveFolder,
  onPickSaveFolder,
  onClearSaveFolder,
  onSaveProfile,
  onClose,
}) {
  const [editingProfile, setEditingProfile] = useState(false);
  const [draftName, setDraftName]           = useState(deviceName || '');
  const [draftAvatar, setDraftAvatar]       = useState(avatar || '🤖');
  const [nameError, setNameError]           = useState('');

  const handleOpenEdit = () => {
    setDraftName(deviceName || '');
    setDraftAvatar(avatar || '🤖');
    setNameError('');
    setEditingProfile(true);
  };

  const handleSaveProfile = () => {
    const trimmed = draftName.trim();
    if (!trimmed) { setNameError('Name cannot be empty'); return; }
    if (trimmed.length > 32) { setNameError('Max 32 characters'); return; }
    onSaveProfile(trimmed, draftAvatar);
    setEditingProfile(false);
  };
  // Format the PIN string into spaced digits: '482193' → '4 8 2 1 9 3'
  const formattedPin = pin
    ? String(pin).split('').join(' ')
    : '— — — — — —';

  // Truncate long paths for display
  const displayPath = saveFolder
    ? truncatePath(saveFolder, 34)
    : null;

  return (
    <motion.div
      className="settings-panel"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* ── Device header ─────────────────────────────────── */}
      <div className="settings-header">
        <motion.button
          className="settings-avatar settings-avatar-btn"
          onClick={handleOpenEdit}
          whileHover={{ scale: 1.12 }}
          whileTap={{ scale: 0.92 }}
          title="Edit profile"
          aria-label="Edit avatar and name"
        >
          {avatar || '💻'}
          <span className="settings-avatar-edit-hint">✏️</span>
        </motion.button>
        <div className="settings-header-info">
          <span className="settings-device-name">{deviceName || 'This Device'}</span>
          <button className="settings-edit-link" onClick={handleOpenEdit}>
            Edit profile
          </button>
        </div>
        <button
          className="settings-close-x"
          onClick={onClose}
          aria-label="Close settings"
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* ── Edit Profile Panel ────────────────────────────── */}
      <AnimatePresence>
        {editingProfile && (
          <motion.div
            className="settings-edit-profile"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="settings-divider" />
            <div className="settings-section">
              <div className="settings-section-label">Edit Profile</div>

              {/* Avatar grid */}
              <div className="settings-avatar-grid">
                {AVATARS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={`settings-avatar-option${draftAvatar === emoji ? ' selected' : ''}`}
                    onClick={() => setDraftAvatar(emoji)}
                    aria-label={`Select avatar ${emoji}`}
                    aria-pressed={draftAvatar === emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Name input */}
              <input
                className={`settings-name-input${nameError ? ' has-error' : ''}`}
                type="text"
                value={draftName}
                onChange={(e) => { setDraftName(e.target.value); setNameError(''); }}
                placeholder="Device name"
                maxLength={32}
                spellCheck={false}
              />
              {nameError && <span className="settings-name-error">{nameError}</span>}

              {/* Actions */}
              <div className="settings-edit-actions">
                <button
                  className="settings-btn-clear"
                  onClick={() => setEditingProfile(false)}
                >
                  Cancel
                </button>
                <motion.button
                  className="settings-btn-secondary"
                  onClick={handleSaveProfile}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                >
                  Save
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Section 1: Default Save Folder ────────────────── */}
      <div className="settings-divider" />
      <section className="settings-section" aria-label="Default save folder">
        <div className="settings-section-label">Default Save Folder</div>

        <div className="settings-folder-row">
          {/* Current path or placeholder */}
          <div className="settings-folder-path" title={saveFolder || undefined}>
            {displayPath ? (
              <>
                <span className="settings-folder-icon" aria-hidden="true">📁</span>
                <span className="settings-folder-text">{displayPath}</span>
              </>
            ) : (
              <span className="settings-folder-placeholder">Ask every time</span>
            )}
          </div>

          {/* Action buttons */}
          <div className="settings-folder-actions">
            <button
              className="settings-btn-secondary"
              onClick={onPickSaveFolder}
              aria-label="Browse for save folder"
            >
              Browse…
            </button>

            <AnimatePresence>
              {saveFolder && (
                <motion.button
                  className="settings-btn-clear"
                  onClick={onClearSaveFolder}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.12 }}
                  aria-label="Clear save folder"
                >
                  Clear
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {saveFolder && (
          <p className="settings-hint">
            Transfers will be saved here automatically.
          </p>
        )}
      </section>

      <div className="settings-divider" />

      {/* ── Section 2: PIN Protection ─────────────────────── */}
      <section className="settings-section" aria-label="PIN protection">
        <div className="settings-toggle-row">
          <span className="settings-section-label">Require PIN from senders</span>

          {/* CSS-only toggle switch */}
          <button
            role="switch"
            aria-checked={pinEnabled}
            className={`settings-toggle ${pinEnabled ? 'on' : ''}`}
            onClick={() => onTogglePin(!pinEnabled)}
            aria-label={`PIN protection ${pinEnabled ? 'enabled' : 'disabled'}`}
          >
            <span className="settings-toggle-thumb" />
          </button>
        </div>

        <AnimatePresence>
          {pinEnabled && (
            <motion.div
              className="settings-pin-block"
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 10 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              style={{ overflow: 'hidden' }}
            >
              {/* PIN digits + refresh */}
              <div className="settings-pin-row">
                <span
                  className="settings-pin-digits"
                  aria-label={`Current PIN: ${formattedPin}`}
                >
                  {formattedPin}
                </span>
                <motion.button
                  className="settings-pin-refresh"
                  onClick={onRefreshPin}
                  whileTap={{ rotate: 360 }}
                  transition={{ duration: 0.4, ease: 'easeInOut' }}
                  aria-label="Generate new PIN"
                  title="New PIN"
                >
                  🔄
                </motion.button>
              </div>

              <p className="settings-pin-hint">
                Share this PIN with anyone who wants to send you a file
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <div className="settings-divider" />

      {/* ── Footer ────────────────────────────────────────── */}
      <div className="settings-footer">
        <motion.button
          className="settings-btn-done"
          onClick={onClose}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
        >
          Done
        </motion.button>
      </div>
    </motion.div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Truncate a file-system path from the right, preserving the tail.
 * e.g. '/Users/alice/Documents/Work/Projects' → '…/Work/Projects'
 */
function truncatePath(p, maxLen) {
  if (!p) return '';
  if (p.length <= maxLen) return p;
  // Try to keep the last two segments
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  let result = p;
  while (result.length > maxLen && parts.length > 1) {
    parts.shift();
    result = '…/' + parts.join('/');
  }
  if (result.length > maxLen) {
    result = '…' + result.slice(result.length - maxLen + 1);
  }
  return result;
}
