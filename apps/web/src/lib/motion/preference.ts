/**
 * The visitor's own motion preference (plan15 Wave 11, feature A3): System (follow the device, the
 * default) or Reduce.
 *
 * REDUCE ALWAYS WINS. It is a second, user-chosen way to switch on exactly what `prefers-reduced-motion`
 * switches on: the capability store reports the "reduced" tier, Motion is told to skip spatial animation,
 * and the blanket CSS rule in globals.css applies under `html[data-motion="reduce"]`. There is
 * deliberately no "full motion" choice that overrides an operating-system reduced-motion setting: a
 * visitor whose device says "reduce" is never made to see motion by this site. (Considered and not built;
 * recorded in docs/PLAN15_FEATURE_PROPOSALS.md.)
 *
 * Mechanics mirror the theme (lib/theme.ts): the choice is stored in localStorage only when it is "reduce"
 * ("system" removes the key), applied as `html[data-motion="reduce"]`, and re-applied before first paint by
 * THEME_INIT_SCRIPT. At runtime the attribute is the source of truth, so the choice still applies for the
 * rest of a page view when storage is blocked.
 */
export type MotionPreference = "system" | "reduce";

export const MOTION_STORAGE_KEY = "lt-motion";

/** Dispatched on `window` after a change, so every control and the capability store re-read it. */
export const MOTION_EVENT = "lt-motion-change";

export const MOTION_CHOICES: readonly MotionPreference[] = ["system", "reduce"];

export function isMotionPreference(value: unknown): value is MotionPreference {
  return value === "system" || value === "reduce";
}

/** Reads the stored choice; anything missing, invalid or unreadable is "system". */
export function readStoredMotionPreference(storage: Pick<Storage, "getItem"> | undefined): MotionPreference {
  try {
    return storage?.getItem(MOTION_STORAGE_KEY) === "reduce" ? "reduce" : "system";
  } catch {
    return "system";
  }
}

/** The preference in force on this page right now (the attribute, which the init script and setters keep current). */
export function currentMotionPreference(root: HTMLElement | undefined = typeof document === "undefined" ? undefined : document.documentElement): MotionPreference {
  return root?.getAttribute("data-motion") === "reduce" ? "reduce" : "system";
}

/** True when the visitor chose Reduce on this site. (The OS setting is read separately, by matchMedia.) */
export function userPrefersReducedMotion(): boolean {
  return currentMotionPreference() === "reduce";
}

export function applyMotionPreference(pref: MotionPreference, root: HTMLElement = document.documentElement) {
  if (pref === "reduce") root.setAttribute("data-motion", "reduce");
  else root.removeAttribute("data-motion");
}

/** Writes the choice and applies it. Storage failures are swallowed: it still applies to this page view. */
export function setMotionPreference(pref: MotionPreference, root: HTMLElement = document.documentElement) {
  try {
    if (pref === "reduce") window.localStorage.setItem(MOTION_STORAGE_KEY, "reduce");
    else window.localStorage.removeItem(MOTION_STORAGE_KEY);
  } catch {
    /* private window or blocked storage: apply without persisting */
  }
  applyMotionPreference(pref, root);
  window.dispatchEvent(new Event(MOTION_EVENT));
}

/** For useSyncExternalStore: re-read on our own event, and follow a change made in another tab. */
export function subscribeMotionPreference(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== MOTION_STORAGE_KEY && event.key !== null) return;
    applyMotionPreference(readStoredMotionPreference(window.localStorage));
    listener();
  };
  window.addEventListener(MOTION_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MOTION_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
