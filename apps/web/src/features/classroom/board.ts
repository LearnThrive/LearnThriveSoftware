import type { CSSProperties } from 'react';
import { MAX_BOARD_UPDATE_BATCH, type BoardBackground, type BoardElement } from '@learnthrive/shared/protocol';

// The same version/versionNonce merge rule the server uses (see server/signalling.ts's
// shouldAcceptElement) — kept independently here rather than shared, since this one only ever
// merges into MeetingController's at-rest cache, never a live Excalidraw scene (that reconciliation,
// using Excalidraw's own `reconcileElements`, happens inside the Whiteboard component instead,
// which is the only place with access to the live scene).
function shouldAccept(existing: BoardElement, incoming: BoardElement): boolean {
  if (incoming.version > existing.version) return true;
  return incoming.version === existing.version && incoming.versionNonce > existing.versionNonce;
}

export function reconcileBoardElements(existing: readonly BoardElement[], incoming: readonly BoardElement[]): BoardElement[] {
  const merged = new Map(existing.map((element) => [element.id, element]));
  for (const element of incoming) {
    const current = merged.get(element.id);
    if (!current || shouldAccept(current, element)) merged.set(element.id, element);
  }
  return [...merged.values()];
}

/** Trailing-edge throttle: the last call within each window wins, fired once the window elapses.
 * Used for both whiteboard element batches and cursor/laser broadcasts, so an actively-drawing or
 * actively-pointing user sends at a bounded rate instead of once per animation frame. */
export function trailingThrottle<Args extends unknown[]>(fn: (...args: Args) => void, ms: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: Args | null = null;
  const invoke = () => {
    timeout = undefined;
    if (pendingArgs) { const args = pendingArgs; pendingArgs = null; fn(...args); }
  };
  const throttled = (...args: Args) => {
    pendingArgs = args;
    if (!timeout) timeout = setTimeout(invoke, ms);
  };
  throttled.cancel = () => { clearTimeout(timeout); timeout = undefined; pendingArgs = null; };
  throttled.flush = () => { if (timeout) { clearTimeout(timeout); invoke(); } };
  return throttled;
}

/**
 * Sends drawing changes at a bounded rate without losing any: everything that changed during a window is kept (each element in its latest state,
 * page by page) and sent when it ends, in messages no larger than the server accepts. A plain throttle keeps only the last call, so a picture
 * added just before a stroke would never reach anyone.
 */
export function boardBatcher(send: (pageId: string, elements: BoardElement[]) => void, ms: number) {
  const pending = new Map<string, Map<string, BoardElement>>();
  const tick = trailingThrottle(() => {
    const pages = [...pending];
    pending.clear();
    for (const [pageId, byId] of pages) {
      const all = [...byId.values()];
      for (let from = 0; from < all.length; from += MAX_BOARD_UPDATE_BATCH) send(pageId, all.slice(from, from + MAX_BOARD_UPDATE_BATCH));
    }
  }, ms);
  return {
    add(pageId: string, elements: readonly BoardElement[]) {
      const byId = pending.get(pageId) ?? new Map<string, BoardElement>();
      for (const element of elements) byId.set(element.id, element);
      pending.set(pageId, byId);
      tick();
    },
    flush: tick.flush,
  };
}

// Rendered as CSS behind a transparent-background Excalidraw canvas — never as actual board
// elements, so a background never costs board-element budget or shows up in export/undo history.
export function boardBackgroundStyle(background: BoardBackground): CSSProperties {
  const line = '#d7dee0';
  const axis = '#aab6ba';
  switch (background) {
    case 'lined':
      return { backgroundImage: `repeating-linear-gradient(0deg, ${line} 0, ${line} 1px, transparent 1px, transparent 32px)`, backgroundSize: '100% 32px' };
    case 'grid':
      return {
        backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
        backgroundSize: '24px 24px',
      };
    case 'dotted':
      return { backgroundImage: `radial-gradient(circle, ${line} 1.3px, transparent 1.3px)`, backgroundSize: '22px 22px' };
    case 'coordinate':
      return {
        backgroundImage: [
          `linear-gradient(${line} 1px, transparent 1px)`, `linear-gradient(90deg, ${line} 1px, transparent 1px)`,
          `linear-gradient(${axis} 2px, transparent 2px)`, `linear-gradient(90deg, ${axis} 2px, transparent 2px)`,
        ].join(', '),
        backgroundSize: '24px 24px, 24px 24px, 100% 2px, 2px 100%',
        backgroundPosition: '0 0, 0 0, 0 50%, 50% 0',
        backgroundRepeat: 'repeat, repeat, no-repeat, no-repeat',
      };
    case 'blank':
    default:
      return {};
  }
}
