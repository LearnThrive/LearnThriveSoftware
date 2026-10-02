"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { OPEN_PALETTE_EVENT } from "@/lib/palette/events";
import { isMacPlatform, opensPalette } from "@/lib/palette/shortcuts";

// The palette and its command set are a separate chunk, fetched on first use or when the browser is
// idle, never on the critical path.
const PublicPalette = dynamic(() => import("./PublicPalette"), { ssr: false });

/**
 * Mounts once in the public layout. It is deliberately tiny: it owns the open state, listens for the
 * shortcut and for the header button's event, and loads the real palette the first time it is asked
 * for (or, once, when the browser is idle, so the first open is instant).
 *
 * Ctrl/Cmd+K opens (and the browser's own binding is suppressed with preventDefault); `/` also opens
 * when focus is not in a text field. See lib/palette/shortcuts.ts for the rules and their tests.
 */
export function PaletteHost() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [shortcutLabel, setShortcutLabel] = useState("Ctrl K");

  useEffect(() => {
    const mac = isMacPlatform(navigator.platform, navigator.userAgent);
    setShortcutLabel(mac ? "⌘K" : "Ctrl K"); // eslint-disable-line react-hooks/set-state-in-effect

    const onKeyDown = (event: KeyboardEvent) => {
      if (!opensPalette(event, event.target as HTMLElement | null, mac)) return;
      event.preventDefault();
      setLoaded(true);
      setOpen((current) => !current);
    };
    const onOpen = () => {
      setLoaded(true);
      setOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);

    // Warm the chunk once the browser has nothing better to do.
    // (requestIdleCallback is missing in Safari; fall back to a timer.)
    const warm = () => void import("./PublicPalette");
    const idleWindow = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    const handle = idleWindow.requestIdleCallback ? idleWindow.requestIdleCallback(warm, { timeout: 4000 }) : window.setTimeout(warm, 2500);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
      if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  if (!loaded) return null;
  return <PublicPalette open={open} onClose={() => setOpen(false)} shortcutLabel={shortcutLabel} />;
}
