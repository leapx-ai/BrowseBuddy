import React, { useEffect, useRef } from 'react';
import { getMessage } from '../../utils/i18n';

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

let dialogSeq = 0;

interface ConfirmDialogProps {
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables the confirm button while the action is running. */
  isBusy?: boolean;
  children?: React.ReactNode;
}

/**
 * Modal confirmation for destructive actions.
 *
 * Only mount this while the dialog should be open - it installs a document-level
 * key handler and moves focus on mount, then restores it on unmount.
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  confirmLabel,
  onConfirm,
  onCancel,
  isBusy = false,
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`dialog-title-${++dialogSeq}`).current;
  // Kept in a ref so the focus/keyboard effect never re-runs on re-render.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const items = () =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || []);

    // Land on Cancel, not on the destructive button.
    items()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      // Keep Tab inside the dialog instead of walking the page behind it.
      const focusable = items();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title" id={titleId}>{title}</h3>
        {children}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>
            {getMessage('cancel')}
          </button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={isBusy}>
            {isBusy ? <div className="spinner is-sm" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
