import { useEffect, useRef, type RefObject } from 'react';
import { usePopoverDismiss } from '../usePopoverDismiss';

interface LeaveConfirmProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function LeaveConfirm({ open, onClose, onConfirm, triggerRef }: LeaveConfirmProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  usePopoverDismiss(open, onClose, ref, triggerRef);
  useEffect(() => { if (open) stayRef.current?.focus(); }, [open]);

  if (!open) return null;

  return (
    <div className="leave-confirm" ref={ref} role="dialog" aria-modal="true" aria-label="Confirm leaving the meeting">
      <p>Leave the meeting?</p>
      <div className="leave-confirm-actions">
        <button ref={stayRef} type="button" className="button-secondary" onClick={onClose}>Stay</button>
        <button type="button" className="button-danger" onClick={onConfirm}>Yes, leave</button>
      </div>
    </div>
  );
}
