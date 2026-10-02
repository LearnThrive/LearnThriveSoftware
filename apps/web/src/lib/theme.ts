/**
 * Theme choice (plan15 Wave 3): System (the default), Light or Dark.
 *
 * Mechanics, in the order they happen:
 *  1. CSS alone handles System: tokens.css applies the dark values under
 *     `@media (prefers-color-scheme: dark)` unless `html[data-theme="light"]` is set.
 *  2. An explicit choice is stored in localStorage (never a cookie: nothing here is sent to the
 *     server) and applied as `html[data-theme]`. "system" removes the attribute.
 *  3. THEME_INIT_SCRIPT runs synchronously in <head>, before first paint, and applies the stored
 *     choice, so a visitor who chose Dark never sees a light frame. It is a fixed string with no
 *     interpolation, which also makes it hashable for a Content-Security-Policy.
 *  4. Everything is wrapped in try/catch: localStorage throws in private windows and with site data
 *     blocked, and the site must render correctly (System) when it does.
 *
 * The whole feature has a kill switch, NEXT_PUBLIC_THEME_TOGGLE=0 (see THEMES_ENABLED): with it set the
 * layout never sets `html[data-themes="on"]`, the dark CSS never applies, the init script is not
 * emitted and the toggle renders nothing: the site is exactly the light site it was before.
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

export const THEME_STORAGE_KEY = "lt-theme";

/** Read at build time (NEXT_PUBLIC_*), so it is a constant per build. ON unless "0": the dark theme
 * is finished on every route (plan15 Wave 3), and the flag stays as the kill switch. */
export const THEMES_ENABLED = process.env.NEXT_PUBLIC_THEME_TOGGLE !== "0";

/** The `theme-color` of each scheme: the navy browser chrome of the light site, a deeper one in dark. */
export const THEME_COLOURS = { light: "#0e2a47", dark: "#061321" } as const;

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

/** Reads the stored choice; anything missing, invalid or unreadable is "system". */
export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined): ThemeChoice {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(value) ? value : "system";
  } catch {
    return "system";
  }
}

/** Writes the choice and applies it. Storage failures are swallowed: the choice still applies for
 * the rest of this page view, it just does not persist. */
export function setTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement) {
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* private window or blocked storage: apply without persisting */
  }
  applyTheme(choice, root);
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement) {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/** The scheme that is actually showing, resolving "system" through the OS preference. */
export function resolvedScheme(choice: ThemeChoice, systemPrefersDark: boolean): "light" | "dark" {
  return choice === "system" ? (systemPrefersDark ? "dark" : "light") : choice;
}

/** Dispatched on `window` after setTheme, so every toggle on the page re-reads the choice. */
export const THEME_EVENT = "lt-theme-change";

/**
 * Runs before first paint. Keep it tiny, self-contained and free of interpolation: it is inlined
 * into every page, and a fixed string can be allowed by hash in a CSP. It also applies the visitor's
 * motion preference (lib/motion/preference.ts), so a visitor who chose Reduce never sees one frame of
 * motion; the key is spelled out here because the script cannot import.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")d.setAttribute("data-theme",t);if(localStorage.getItem("lt-motion")==="reduce")d.setAttribute("data-motion","reduce")}catch(e){}})()`;
