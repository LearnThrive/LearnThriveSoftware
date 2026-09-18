import { useEffect, useRef, type RefObject } from 'react';
import { usePopoverDismiss } from '../usePopoverDismiss';

interface LeaveConfirmProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  isTutor?: boolean;
}

// There is exactly one tutor, so their departure always ends the class for everyone — this is a
// copy-only distinction (isTutor), not a separate protocol event or confirmation flow.
export function LeaveConfirm({ open, onClose, onConfirm, triggerRef, isTutor = false }: LeaveConfirmProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  usePopoverDismiss(open, onClose, ref, triggerRef);
  useEffect(() => { if (open) stayRef.current?.focus(); }, [open]);

  if (!open) return null;

  return (
    <div className="leave-confirm" ref={ref} role="dialog" aria-modal="true" aria-label={isTutor ? 'Confirm ending the class' : 'Confirm leaving the meeting'}>
      <p>{isTutor ? 'End class for everyone?' : 'Leave the meeting?'}</p>
      {isTutor && <p className="leave-confirm-note">Every student will be disconnected immediately.</p>}
      <div className="leave-confirm-actions">
        <button ref={stayRef} type="button" className="button-secondary" onClick={onClose}>Stay</button>
        <button type="button" className="button-danger" onClick={onConfirm}>{isTutor ? 'Yes, end class' : 'Yes, leave'}</button>
      </div>
    </div>
  );
}
