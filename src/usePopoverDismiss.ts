import { useEffect, type RefObject } from 'react';

/** Escape closes and returns focus to the trigger; clicking outside closes without moving focus,
 * since the click itself already indicates where the user wants it. Shared by every small
 * popover (device menu, participant panel, reaction picker, leave confirm). */
export function usePopoverDismiss(
  open: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
  triggerRef?: RefObject<HTMLButtonElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
      triggerRef?.current?.focus();
    };
    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onClickOutside);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('mousedown', onClickOutside); };
  }, [open, onClose, containerRef, triggerRef]);
}
