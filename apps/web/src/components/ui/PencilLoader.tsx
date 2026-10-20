"use client";

// From Uiverse.io by gustavofusco (https://uiverse.io), MIT licensed. Rebuilt as a React component:
// a clip id per instance, theme tokens instead of fixed blues, a status role, and a still pencil
// whenever motion is reduced. The original markup and animation live in `UI Components/Pencil.*`.

import { useEffect, useId, useRef, useState } from "react";
import styles from "./PencilLoader.module.css";

export type PencilLoaderSize = "sm" | "md" | "lg";

export interface PencilLoaderProps {
  /** Rendered size: sm 2.5rem, md 5rem, lg 10rem (the original's 10em). */
  size?: PencilLoaderSize;
  /** The words a screen reader announces. Visually hidden. */
  label?: string;
  className?: string;
}

/**
 * The pencil drawing a circle. Decorative on its own (aria-hidden); the wrapping status element carries
 * the meaning. The static pose in the attributes is what shows when motion is reduced; the stylesheet
 * animates away from it only when motion is allowed.
 */
function PencilSvg({ size }: { size: PencilLoaderSize }) {
  // useId gives ":r1:" style ids: strip everything that is not valid inside url(#...).
  const clipId = `pencil-eraser-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <svg className={`${styles.pencil} ${styles[size]}`} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <rect height="30" width="30" ry="5" rx="5" />
        </clipPath>
      </defs>
      <circle
        className={styles.stroke}
        transform="translate(100 100) rotate(-113)"
        strokeLinecap="round"
        strokeDashoffset="164.93"
        strokeDasharray="439.82 439.82"
        strokeWidth="2"
        stroke="currentColor"
        fill="none"
        r="70"
      />
      <g className={styles.rotate} transform="translate(100 100)">
        <g fill="none">
          <circle className={styles.body1} transform="rotate(-225)" strokeDashoffset="150.8" strokeDasharray="402.12 402.12" strokeWidth="30" r="64" />
          <circle className={styles.body2} transform="rotate(-225)" strokeDashoffset="174.36" strokeDasharray="464.96 464.96" strokeWidth="10" r="74" />
          <circle className={styles.body3} transform="rotate(-225)" strokeDashoffset="127.23" strokeDasharray="339.29 339.29" strokeWidth="10" r="54" />
        </g>
        <g className={styles.eraser} transform="translate(49 0)">
          <g className={styles.eraserSkew}>
            <rect className={styles.eraserFace} height="30" width="30" ry="5" rx="5" />
            <rect className={styles.eraserEdge} clipPath={`url(#${clipId})`} height="30" width="5" />
            <rect className={styles.ferrule} height="20" width="30" />
            <rect className={styles.ferruleShade} height="20" width="15" />
            <rect className={styles.ferruleEdge} height="20" width="5" />
            <rect className={styles.ferruleRing} height="2" width="30" y="6" />
            <rect className={styles.ferruleRing} height="2" width="30" y="13" />
          </g>
        </g>
        <g className={styles.point} transform="rotate(-225) translate(49 -30)">
          <polygon className={styles.wood} points="15 0,30 30,0 30" />
          <polygon className={styles.woodShade} points="15 0,6 30,0 30" />
          <polygon className={styles.graphite} points="15 0,20 10,10 10" />
        </g>
      </g>
    </svg>
  );
}

/** True while the element is on screen, so the stylesheet can pause the animation when it is not. */
function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, onScreen] as const;
}

/** The loading indicator: an animated pencil with a hidden "Loading" for screen readers. */
export function PencilLoader({ size = "md", label = "Loading", className }: PencilLoaderProps) {
  const [ref, onScreen] = useOnScreen<HTMLSpanElement>();
  return (
    <span ref={ref} role="status" className={[styles.root, className].filter(Boolean).join(" ")} data-paused={onScreen ? undefined : ""}>
      <PencilSvg size={size} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export interface ThinkingIndicatorProps {
  /** The visible words, announced as they are. */
  label?: string;
  size?: PencilLoaderSize;
  className?: string;
}

/** The chat's "assistant is working" line: the pencil beside visible text. */
export function ThinkingIndicator({ label = "Thinking…", size = "sm", className }: ThinkingIndicatorProps) {
  const [ref, onScreen] = useOnScreen<HTMLSpanElement>();
  return (
    <span
      ref={ref}
      role="status"
      className={[styles.root, styles.thinking, className].filter(Boolean).join(" ")}
      data-paused={onScreen ? undefined : ""}
    >
      <PencilSvg size={size} />
      <span className={styles.thinkingText}>{label}</span>
    </span>
  );
}
