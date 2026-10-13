import React from 'react';
import { motion } from 'framer-motion';
import { ArrowUp, ArrowDown, CheckCircle, XCircle } from 'lucide-react';
import '../styles/TransferStatus.css';

/**
 * TransferStatus — Shows one or more active transfer progress bars.
 * Renders below the notch during active sends/receives.
 */
export default function TransferStatus({ transfers }) {
  return (
    <motion.div
      className="transfer-status-container"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      {transfers.map((transfer) => (
        <TransferItem key={transfer.transferId} transfer={transfer} />
      ))}
    </motion.div>
  );
}

function TransferItem({ transfer }) {
  const { filename, percent = 0, direction, status } = transfer;
  const isComplete = status === 'complete';
  const isError = status === 'error';

  const isSending = direction === 'sending';
  const labelClass = isSending ? 'sending' : 'receiving';

  return (
    <motion.div
      className="transfer-item"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
    >
      <div className="transfer-info">
        <span className={`transfer-direction ${labelClass}`}>
          {isSending
            ? <><ArrowUp size={9} strokeWidth={3} /> Sending</>
            : <><ArrowDown size={9} strokeWidth={3} /> Receiving</>}
        </span>
        <span className="transfer-filename" title={filename}>
          {filename}
        </span>
        <span className="transfer-percent">
          {isComplete
            ? <CheckCircle size={11} strokeWidth={2.5} className="ts-done-icon" />
            : isError
            ? <XCircle size={11} strokeWidth={2.5} className="ts-err-icon" />
            : `${percent}%`}
        </span>
      </div>

      <div className="progress-track">
        <motion.div
          className={`progress-fill ${isComplete ? 'complete' : isError ? 'error' : ''}`}
          initial={{ width: 0 }}
          animate={{ width: `${isComplete ? 100 : percent}%` }}
          transition={{ ease: 'easeOut', duration: 0.3 }}
        />
        {/* Shimmer effect while active */}
        {!isComplete && !isError && (
          <motion.div
            className="progress-shimmer"
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </div>
    </motion.div>
  );
}
