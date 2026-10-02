import type { CSSProperties, ElementType } from "react";
import styles from "./ScrubStatement.module.css";

/**
 * An editorial statement whose words shift from muted to strong tone as the paragraph scrolls
 * through the viewport (plan15 Wave 6 section 10.2): you read it into focus.
 *
 * It is a server component with no JavaScript at all. The effect is pure CSS scroll-driven
 * animation (`animation-timeline` on the paragraph's own view timeline), enabled only on the
 * full and standard motion tiers (`html[data-motion-tier]`), only when the visitor has not asked
 * for reduced motion, and only where the browser supports it (`@supports`). Everywhere else, the
 * statement is simply the finished, full-contrast text: that is also what assistive technology
 * and a text-only reader get, because the words are ordinary text in the DOM in every case.
 *
 * Purely decorative motion, so it is allowed to be native CSS (plan15 10.7): it never drives a
 * property from a second system, and removing it removes nothing.
 */
export function ScrubStatement({
  text,
  as: Tag = "p",
  className,
}: {
  text: string;
  as?: ElementType;
  className?: string;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const last = Math.max(1, words.length - 1);
  return (
    <Tag className={[styles.statement, className].filter(Boolean).join(" ")} data-scrub-statement="">
      {words.map((word, index) => (
        <span key={`${index}-${word}`}>
          <span className={styles.word} style={{ "--w": (index / last).toFixed(3) } as CSSProperties}>
            {word}
          </span>
          {index < words.length - 1 ? " " : null}
        </span>
      ))}
    </Tag>
  );
}
