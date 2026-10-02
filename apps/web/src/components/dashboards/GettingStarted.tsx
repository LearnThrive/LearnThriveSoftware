"use client";

import { useSyncExternalStore } from "react";
import { Lightbulb, X } from "lucide-react";
import type { Role } from "@/lib/auth/types";

/**
 * First-run tips (plan15 Wave 11, feature A5): a short, dismissible card at the foot of the dashboard, per role.
 * Every tip names something that exists and works today; nothing here is a promise about the future.
 *
 * Dismissal is remembered in this browser only (localStorage, one key; the signed-in app is not live in
 * production yet, and apps/web/LEGAL_REVIEW.md lists the key for the cookie notice before it is). It sits at
 * the BOTTOM of the page on purpose: a card that appeared above the content after hydration, or vanished from
 * it for a returning visitor, would shift the page.
 */
export const GETTING_STARTED_KEY = "learnthrive:getting-started";

const TIPS: Record<Role, string[]> = {
  ADMIN: [
    "Press Ctrl K (or ⌘K) to search people, lessons and reports, or to jump to any page.",
    "Use Create at the top of the Overview to add a student, client, tutor, assignment or lesson.",
    "Tutors' reports wait for you to approve them before families see them. You can change that default in Settings.",
  ],
  TUTOR: [
    "A lesson is completed once attendance is marked and its report is submitted, so do those straight after teaching.",
    "Set your weekly availability so lessons can be scheduled around you.",
    "Press ? anywhere for the keyboard shortcuts, or Ctrl K (⌘K) to search.",
  ],
  CLIENT: [
    "Your children's lessons and approved reports are under Children and Lesson reports; See progress shows them over time.",
    "On any lesson page, Add to calendar puts it in your own calendar.",
    "A report appears here once it has been approved. You will see a notification when one arrives.",
  ],
  STUDENT: [
    "Open a lesson and choose Join classroom: it opens 10 minutes before the start.",
    "Your tutor's feedback is under Feedback, and See my progress shows every lesson in order.",
    "Press ? anywhere for the keyboard shortcuts, or Ctrl K (⌘K) to search.",
  ],
};

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("learnthrive:tips", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("learnthrive:tips", listener);
  };
}

function dismissedNow(): boolean {
  try {
    return window.localStorage.getItem(GETTING_STARTED_KEY) === "dismissed";
  } catch {
    return false;
  }
}

export function GettingStarted({ role }: { role: Role }) {
  // The server (and the first client render) always shows the card; a dismissed visitor loses it right after hydration.
  const dismissed = useSyncExternalStore(subscribe, dismissedNow, () => false);
  if (dismissed) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(GETTING_STARTED_KEY, "dismissed");
    } catch {
      /* blocked storage: it will simply show again next time */
    }
    window.dispatchEvent(new Event("learnthrive:tips"));
  }

  return (
    <aside className="getting-started card" aria-label="Getting started">
      <div className="getting-started__head">
        <h2 className="getting-started__title">
          <Lightbulb size={18} aria-hidden="true" />Getting started
        </h2>
        <button type="button" className="icon-button" onClick={dismiss} aria-label="Dismiss the getting started tips">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <ul className="getting-started__list">
        {TIPS[role].map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
      <button type="button" className="btn btn--secondary btn--sm" onClick={dismiss}>
        Got it
      </button>
    </aside>
  );
}
