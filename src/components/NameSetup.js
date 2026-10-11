import React, { useState } from 'react';
import { motion } from 'framer-motion';
import './NameSetup.css';

const AVATARS = [
  '🐶','🐱','🦊','🐼','🐨','🦁',
  '🐯','🐸','🐧','🦋','🦄','🐲',
  '👾','🤖','👻','🎃','⚡','🔥',
  '🌊','🌈','🍕','🎮','🚀','💎',
];

const DEFAULT_AVATAR = '🤖';

/**
 * NameSetup — First-launch modal asking the user to choose an avatar and set a
 * display name. Shown once; the name and avatar are saved to device.json via IPC.
 */
export default function NameSetup({ onSave }) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(DEFAULT_AVATAR);
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Please enter a name'); return; }
    if (trimmed.length > 32) { setError('Name must be 32 characters or less'); return; }
    onSave(trimmed, avatar);
  };

  return (
    <motion.div
      className="name-setup-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.div
        className="name-setup-card"
        initial={{ opacity: 0, y: -24, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      >
        <h1 className="name-setup-title">Welcome to DropZone</h1>
        <p className="name-setup-subtitle">
          Pick an avatar and set a display name so others on your network know who you are.
        </p>

        {/* Avatar preview */}
        <div className="avatar-preview">{avatar}</div>

        {/* Avatar grid */}
        <div className="avatar-grid">
          {AVATARS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={`avatar-option${avatar === emoji ? ' selected' : ''}`}
              onClick={() => setAvatar(emoji)}
              aria-label={`Select avatar ${emoji}`}
              aria-pressed={avatar === emoji}
            >
              {emoji}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="name-setup-form">
          <input
            className={`name-input ${error ? 'has-error' : ''}`}
            type="text"
            placeholder="e.g. Alex's MacBook"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            autoFocus
            maxLength={32}
            spellCheck={false}
          />
          {error && <span className="name-error">{error}</span>}
          <motion.button
            type="submit"
            className="name-save-btn"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            Get Started
          </motion.button>
        </form>
      </motion.div>
    </motion.div>
  );
}
