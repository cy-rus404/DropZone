import React, { useState } from 'react';
import { motion } from 'framer-motion';
import './NameSetup.css';

/**
 * NameSetup — First-launch modal asking the user to set a display name.
 * Shown once; the name is saved to device.json via IPC.
 */
export default function NameSetup({ onSave }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Please enter a name'); return; }
    if (trimmed.length > 32) { setError('Name must be 32 characters or less'); return; }
    onSave(trimmed);
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
        <div className="name-setup-icon">🌀</div>
        <h1 className="name-setup-title">Welcome to DropZone</h1>
        <p className="name-setup-subtitle">
          Set a display name so others on your network know who you are.
        </p>

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
