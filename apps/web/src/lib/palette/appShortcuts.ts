import type { Role } from "@/lib/auth/types";
import { navigationFor } from "@/lib/navigation/appNavigation";
import { isTypingTarget, type ShortcutEventLike, type TargetLike } from "@/lib/palette/shortcuts";

/**
 * The signed-in app's keyboard shortcuts (plan15 Wave 11 section 15.2): Ctrl/Cmd+K for the palette (see
 * shortcuts.ts), `?` for this list, and a small set of two-key "go to" sequences (press `g`, then a letter).
 *
 * Rules, all tested in tests/appShortcuts.test.mjs:
 *  - Role-scoped: a sequence exists only if the role's own navigation has that page, so an Admin-only page
 *    is never reachable by shortcut for a Tutor (the page would refuse them anyway; this keeps the help
 *    overlay honest).
 *  - Never destructive: every shortcut here navigates or shows help. Nothing creates, deletes or signs out.
 *  - Never steals typing: none fires while focus is in a text field, with a modifier held, or during IME
 *    composition.
 *  - Forgiving: the second key must come within GO_TIMEOUT_MS of `g`; anything else cancels the sequence.
 */
export const GO_PREFIX = "g";
export const GO_TIMEOUT_MS = 1200;

export interface GoToTarget {
  /** The second key of the sequence. */
  key: string;
  label: string;
  href: string;
}

const CANDIDATES: Array<{ key: string; label: string; hrefFor: (role: Role) => string | null }> = [
  { key: "d", label: "Overview", hrefFor: () => "/dashboard" },
  { key: "c", label: "Calendar", hrefFor: () => "/dashboard/calendar" },
  { key: "l", label: "Lessons", hrefFor: () => "/dashboard/lessons" },
  { key: "r", label: "Reports", hrefFor: () => "/dashboard/reports" },
  { key: "n", label: "Notifications", hrefFor: () => "/dashboard/notifications" },
  { key: "s", label: "Settings", hrefFor: () => "/dashboard/settings" },
  {
    key: "p",
    label: "People",
    hrefFor: (role) =>
      role === "ADMIN" ? "/dashboard/admin/people/students" : role === "TUTOR" ? "/dashboard/students" : role === "CLIENT" ? "/dashboard/children" : null,
  },
  { key: "a", label: "Assignments", hrefFor: (role) => (role === "ADMIN" ? "/dashboard/admin/assignments" : null) },
  { key: "v", label: "Availability", hrefFor: (role) => (role === "TUTOR" ? "/dashboard/tutor/availability" : null) },
];

/** The go-to sequences this role has: only pages that are in its own navigation. */
export function goToTargetsFor(role: Role): GoToTarget[] {
  const navigable = new Set(navigationFor(role).flatMap((section) => section.items.map((item) => item.href)));
  const targets: GoToTarget[] = [];
  for (const candidate of CANDIDATES) {
    const href = candidate.hrefFor(role);
    if (href && navigable.has(href)) targets.push({ key: candidate.key, label: candidate.label, href });
  }
  return targets;
}

export type GoToStep = { kind: "pending" } | { kind: "go"; href: string } | { kind: "none" };

/**
 * A tiny state machine for "g then d". `press` takes each unmodified key press (the caller has already
 * dropped typing targets and modifiers) and says what to do. Time comes in as an argument so the
 * timeout is testable without waiting.
 */
export function createGoToTracker(targets: readonly GoToTarget[]) {
  let armedAt: number | null = null;
  return {
    press(key: string, now: number): GoToStep {
      const k = key.toLowerCase();
      if (armedAt !== null && now - armedAt <= GO_TIMEOUT_MS) {
        armedAt = null;
        const target = targets.find((t) => t.key === k);
        return target ? { kind: "go", href: target.href } : { kind: "none" };
      }
      if (k === GO_PREFIX) {
        armedAt = now;
        return { kind: "pending" };
      }
      armedAt = null;
      return { kind: "none" };
    },
    reset() {
      armedAt = null;
    },
  };
}

/** Does this keydown open the shortcuts overlay (`?`, which is Shift+/ on most layouts)? */
export function opensShortcutHelp(event: ShortcutEventLike, target: TargetLike | null | undefined): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key === "?" && !isTypingTarget(target);
}

/** Should a bare key press be considered for a go-to sequence at all? */
export function isGoToCandidate(event: ShortcutEventLike, target: TargetLike | null | undefined): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if (event.key.length !== 1) return false;
  return !isTypingTarget(target);
}
