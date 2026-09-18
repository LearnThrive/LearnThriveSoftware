import { useRef, type RefObject } from 'react';
import { REACTION_EMOJIS, type ReactionEmoji } from '@learnthrive/shared/protocol';
import { usePopoverDismiss } from '../usePopoverDismiss';

interface ReactionPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (emoji: ReactionEmoji) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function ReactionPicker({ open, onClose, onSelect, triggerRef }: ReactionPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, onClose, pickerRef, triggerRef);

  if (!open) return null;

  return (
    <div className="reaction-picker" ref={pickerRef} role="menu" aria-label="Send a reaction">
      {REACTION_EMOJIS.map((emoji) => (
        <button key={emoji} type="button" className="reaction-picker-item" onClick={() => { onSelect(emoji); onClose(); }} aria-label={`Send ${emoji} reaction`}>
          {emoji}
        </button>
      ))}
    </div>
  );
}
