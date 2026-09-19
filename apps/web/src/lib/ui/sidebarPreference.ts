const STORAGE_KEY = "learnthrive:sidebar-collapsed";
const EVENT = "learnthrive:sidebar-collapsed-change";

/**
 * The collapsed-sidebar preference (plan6 section 22), stored per browser.
 *
 * Exposed as an external store rather than read into state inside an effect: the server has no
 * idea what this browser prefers, so `useSyncExternalStore` with a separate server snapshot is
 * the one pattern that gives a correct first paint without a hydration mismatch or an extra
 * render pass. Reads are defensive because storage throws in private mode and can be blocked
 * entirely — in which case "expanded" is a perfectly good answer.
 */
export function subscribeToSidebarPreference(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function getSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Server rendering has no browser storage; the sidebar starts expanded there. */
export function getSidebarCollapsedServer(): boolean {
  return false;
}

export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(collapsed));
  } catch {
    // Preference simply isn't remembered this session; the toggle still works in-page.
  }
  window.dispatchEvent(new Event(EVENT));
}
