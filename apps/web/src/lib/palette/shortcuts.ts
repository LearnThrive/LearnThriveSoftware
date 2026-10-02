/**
 * Keyboard shortcuts for the command palette (plan15 Wave 9 section 13.3), all in one place so the
 * public site and the app share them and a change is one edit.
 *
 * Rules the plan sets, encoded here and unit-tested (tests/paletteShortcuts.test.mjs):
 *  - Ctrl+K (Windows/Linux) and Cmd+K (macOS) open the palette, and the browser's own binding for
 *    the same chord (focus the address/search bar in some browsers) is suppressed with preventDefault.
 *  - The shortcut is never captured while focus is in a text field, textarea, select or
 *    contenteditable — unless that field is the palette's own input — because someone typing into a
 *    form must never lose the chord to us.
 *  - `/` is an optional secondary opener with the same guard, and never with a modifier held.
 */
export interface ShortcutEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
}

export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

/** One map, one place. Add a shortcut here and in the palette's help text, nowhere else. */
export const PALETTE_SHORTCUTS = {
  /** Opens the palette. `mod` is Ctrl on Windows/Linux and Cmd on macOS. */
  open: { key: "k", mod: true },
  /** Optional secondary opener. */
  openSlash: { key: "/", mod: false },
} as const;

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "time", "week"]);

/** Is the user typing somewhere the shortcut must not steal a keystroke from? */
export function isTypingTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = ((target as { type?: string }).type ?? "text").toLowerCase();
    return TEXT_INPUT_TYPES.has(type);
  }
  return target.isContentEditable === true;
}

/** True for the palette's own input, where typing a `/` or a `k` is just typing. */
function isPaletteInput(target: TargetLike | null | undefined): boolean {
  return Boolean(target?.closest?.("[data-palette-input]"));
}

/**
 * Should this keydown open the palette? `isMac` only matters for which modifier is "mod": Cmd on
 * macOS, Ctrl elsewhere, and the other one must NOT be held (Ctrl+Cmd+K is somebody else's chord).
 */
export function opensPalette(event: ShortcutEventLike, target: TargetLike | null | undefined, isMac: boolean): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.altKey) return false;
  const key = event.key.toLowerCase();

  if (key === PALETTE_SHORTCUTS.open.key) {
    const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!mod || event.shiftKey) return false;
    // The chord is deliberate: it opens the palette even from inside a form field, because Ctrl/Cmd+K
    // is not something anyone types as text. (It would be wrong for a bare letter.)
    return true;
  }

  if (key === PALETTE_SHORTCUTS.openSlash.key) {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return false;
    return !isTypingTarget(target) && !isPaletteInput(target);
  }
  return false;
}

/** Heuristic only used to choose which modifier to name in the UI hint ("Ctrl K" vs "⌘K"). */
export function isMacPlatform(platform: string | undefined, userAgent: string | undefined): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "") || /mac os x/i.test(userAgent ?? "");
}
