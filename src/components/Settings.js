import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Folder, RefreshCw, Pencil, X } from 'lucide-react';
import { AVATAR_LIST, DEFAULT_AVATAR, AvatarIcon } from '../avatarIcons';
import '../styles/Settings.css';

/**
 * Settings
 *
 * Slides in to replace the peer-list area inside the notch pill.
 *
 * Props:
 *   deviceName        {string}   Current device display name
 *   avatar            {string}   Avatar icon ID, e.g. "Zap"
 *   pinEnabled        {boolean}  Whether PIN protection is active
 *   pin               {string}   6-digit PIN string, e.g. '482193'
 *   onTogglePin       {fn}       Called with (boolean) when toggle flips
 *   onRefreshPin      {fn}       Called when refresh is pressed
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
  const [draftAvatar, setDraftAvatar]       = useState(avatar || DEFAULT_AVATAR);
  const [nameError, setNameError]           = useState('');

  const handleOpenEdit = () => {
    setDraftName(deviceName || '');
    setDraftAvatar(avatar || DEFAULT_AVATAR);
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
  const displayPath = saveFolder ? truncatePath(saveFolder, 34) : null;

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
          <AvatarIcon id={avatar || DEFAULT_AVATAR} size={16} />
          <span className="settings-avatar-edit-hint"><Pencil size={9} /></span>
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
          <X size={13} strokeWidth={2.5} />
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

              {/* Icon avatar grid */}
              <div className="settings-avatar-grid">
                {AVATAR_LIST.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`settings-avatar-option${draftAvatar === id ? ' selected' : ''}`}
                    onClick={() => setDraftAvatar(id)}
                    aria-label={`Select avatar ${id}`}
                    aria-pressed={draftAvatar === id}
                  >
                    <AvatarIcon id={id} size={15} />
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
          <div className="settings-folder-path" title={saveFolder || undefined}>
            {displayPath ? (
              <>
                <span className="settings-folder-icon" aria-hidden="true">
                  <Folder size={12} />
                </span>
                <span className="settings-folder-text">{displayPath}</span>
              </>
            ) : (
              <span className="settings-folder-placeholder">Ask every time</span>
            )}
          </div>

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
                  <RefreshCw size={13} strokeWidth={2} />
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
function truncatePath(p, maxLen) {
  if (!p) return '';
  if (p.length <= maxLen) return p;
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
