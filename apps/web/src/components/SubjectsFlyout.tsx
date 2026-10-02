"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { subjects } from "@/lib/site";

/**
 * The "Subjects" entry of the primary navigation, with a flyout of the four subjects (plan15 Wave 10 section
 * 14.2). The link itself still goes to /subjects; a separate button beside it opens the panel, so:
 *
 *  - Keyboard: Tab reaches the link and then the button; Enter/Space opens; Tab moves through the panel's
 *    links; Escape closes it and puts focus back on the button; tabbing out of the whole thing closes it.
 *  - Touch and screen readers: it opens on a tap or press, with `aria-expanded` and `aria-controls`. Nothing
 *    is hover-only. A mouse pointer additionally opens it on hover, as a convenience.
 *  - A page change closes it (open state belongs to the pathname it was opened on).
 *  - Under the mobile breakpoint (globals.css) the panel is not a floating card but an inline block inside
 *    the open menu.
 *
 * The accessible names say "what we teach" rather than "subjects" on purpose: a form field elsewhere on the
 * site is labelled "Subject", and a label-based locator (or a person's voice command) for that field must
 * not also match this menu.
 *
 * A disclosure, not a menu widget: the links are ordinary links in the normal tab order, which is what
 * the ARIA authoring guide recommends for site navigation. No motion beyond a CSS fade.
 */
export function SubjectsFlyout({
  current,
  transitionType,
  onNavigate,
}: {
  current: boolean;
  transitionType: "nav-forward" | "nav-back";
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [pinnedOn, setPinnedOn] = useState<string | null>(null);
  const [hoverOn, setHoverOn] = useState<string | null>(null);
  const open = pinnedOn === pathname || hoverOn === pathname;

  // Outside press closes it (only while it is open, so a closed flyout costs no listener).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPinnedOn(null);
        setHoverOn(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  return (
    <div
      ref={rootRef}
      className="nav-flyout"
      data-open={open ? "true" : "false"}
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return;
        window.clearTimeout(hoverTimer.current);
        setHoverOn(pathname);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => setHoverOn(null), 140);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setPinnedOn(null);
          setHoverOn(null);
          buttonRef.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
          setPinnedOn(null);
          setHoverOn(null);
        }
      }}
    >
      <Link
        href="/subjects"
        aria-current={current ? "page" : undefined}
        transitionTypes={[transitionType]}
        onClick={() => {
          setPinnedOn(null);
          setHoverOn(null);
          onNavigate();
        }}
      >
        Subjects
      </Link>
      <button
        ref={buttonRef}
        className="nav-flyout__toggle"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Open the what we teach menu"
        onClick={() => setPinnedOn(pinnedOn === pathname ? null : pathname)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>
      <div className="nav-flyout__panel" id={panelId} role="group" aria-label="What we teach" inert={!open}>
        <ul>
          {subjects.map((subject) => (
            <li key={subject.slug}>
              <Link
                href={subject.path}
                onClick={() => {
                  setPinnedOn(null);
                  setHoverOn(null);
                  onNavigate();
                }}
              >
                <span className="nav-flyout__icon">
                  <Icon name={subject.icon} />
                </span>
                <span className="nav-flyout__text">
                  <strong>{subject.title}</strong>
                  <span>{subject.stage}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link className="nav-flyout__all" href="/subjects" onClick={() => { setPinnedOn(null); setHoverOn(null); onNavigate(); }}>
          All subjects <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
