import type { DisplayReaction } from '../meeting';

/** Purely decorative floating emoji; aria-hidden so it doesn't spam screen readers on top of
 * the (already announced) reaction toast/participant state. Respects reduced-motion via CSS. */
export function ReactionsLayer({ reactions }: { reactions: DisplayReaction[] }) {
  if (reactions.length === 0) return null;
  return (
    <div className="reactions-layer" aria-hidden="true">
      {reactions.map((reaction, index) => (
        <span key={reaction.id} className={`floating-reaction ${reaction.mine ? 'mine' : 'theirs'}`} style={{ left: `${15 + (index % 5) * 15}%` }}>
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}
