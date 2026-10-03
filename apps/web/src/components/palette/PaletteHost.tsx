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
 * for, or the first time someone shows intent (hovers or focuses the Search button, touches it, or presses
 * Ctrl/Cmd), so the first open is usually instant without costing every page load the chunk.
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

    // Warm the chunk the moment someone shows intent, not on page load: the palette (and the FAQ text inside it)
    // is ~25 KB gz that most visitors never open, and the marketing JavaScript budget is tight (plan15 section 2).
    // Intent is hovering or focusing the Search button, touching it, or pressing Ctrl/Cmd (the start of Ctrl+K),
    // so by the time the shortcut or the click completes the chunk is usually already there.
    let warmed = false;
    const warm = () => {
      if (warmed) return;
      warmed = true;
      void import("./PublicPalette");
    };
    const onIntent = (event: Event) => {
      if ((event.target as HTMLElement | null)?.closest?.("[data-palette-trigger]")) warm();
    };
    const onModifier = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") warm();
    };
    document.addEventListener("pointerover", onIntent);
    document.addEventListener("focusin", onIntent);
    document.addEventListener("touchstart", onIntent, { passive: true });
    document.addEventListener("keydown", onModifier);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
      document.removeEventListener("pointerover", onIntent);
      document.removeEventListener("focusin", onIntent);
      document.removeEventListener("touchstart", onIntent);
      document.removeEventListener("keydown", onModifier);
    };
  }, []);

  if (!loaded) return null;
  return <PublicPalette open={open} onClose={() => setOpen(false)} shortcutLabel={shortcutLabel} />;
}
