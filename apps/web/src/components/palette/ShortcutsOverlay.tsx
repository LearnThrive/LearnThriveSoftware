"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Role } from "@/lib/auth/types";
import { goToTargetsFor, GO_PREFIX } from "@/lib/palette/appShortcuts";
import { useDelayedUnmount } from "@/lib/motion/useDelayedUnmount";
import styles from "./ShortcutsOverlay.module.css";

/**
 * The keyboard shortcut list (`?`), for the signed-in app. A plain, labelled modal: focus moves to the close
 * button on open and returns to what had it on close, Escape and the scrim close it, and it closes at once
 * under reduced motion. The list is built from the same data the shortcuts themselves use
 * (lib/palette/appShortcuts.ts), so it cannot drift from what actually works for this role.
 */
export function ShortcutsOverlay({
  open,
  onClose,
  role,
  mac,
}: {
  open: boolean;
  onClose: () => void;
  role: Role;
  mac: boolean;
}) {
  const dialog = useDelayedUnmount(open, 160);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        // One focusable control: keep focus on it.
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnTo.current?.focus();
    };
  }, [open, onClose]);

  if (!dialog.rendered) return null;
  const targets = goToTargetsFor(role);
  const mod = mac ? "⌘" : "Ctrl";

  return (
    <div className={`dialog ${styles.root} ${dialog.closing ? "is-closing" : ""}`}>
      <button type="button" className="dialog__scrim" aria-label="Close keyboard shortcuts" tabIndex={-1} onClick={onClose} />
      <div className={`dialog__panel ${styles.panel} ${dialog.closing ? "is-closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <div className={styles.head}>
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" className="icon-button" aria-label="Close keyboard shortcuts" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <h3 className={styles.group}>Anywhere</h3>
        <dl className={styles.list}>
          <div>
            <dt><kbd>{mod}</kbd> <kbd>K</kbd> or <kbd>/</kbd></dt>
            <dd>Search, and jump to a page</dd>
          </div>
          <div>
            <dt><kbd>?</kbd></dt>
            <dd>Show this list</dd>
          </div>
          <div>
            <dt><kbd>Esc</kbd></dt>
            <dd>Close whatever is open</dd>
          </div>
        </dl>

        <h3 className={styles.group}>Go to a page</h3>
        <p className={styles.note}>
          Press <kbd>{GO_PREFIX.toUpperCase()}</kbd>, then a letter.
        </p>
        <dl className={styles.list}>
          {targets.map((target) => (
            <div key={target.key}>
              <dt><kbd>{GO_PREFIX.toUpperCase()}</kbd> <kbd>{target.key.toUpperCase()}</kbd></dt>
              <dd>{target.label}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.note}>Shortcuts never type into a field and never change anything.</p>
      </div>
    </div>
  );
}
