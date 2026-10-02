"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Role } from "@/lib/auth/types";
import { OPEN_PALETTE_EVENT } from "@/lib/palette/events";
import { createGoToTracker, goToTargetsFor, isGoToCandidate, opensShortcutHelp } from "@/lib/palette/appShortcuts";
import { isMacPlatform, opensPalette } from "@/lib/palette/shortcuts";
import { ShortcutsOverlay } from "./ShortcutsOverlay";

// The palette (and its server-search wiring) is a separate chunk, fetched on first use or when the browser is
// idle, never in the app's first load.
const AppPalette = dynamic(() => import("./AppPalette"), { ssr: false });

/**
 * Mounts once in the signed-in app shell (components/shell/AppShellClient.tsx), and nowhere else: the
 * classroom is its own route group without the shell, so a whiteboard shortcut can never collide with these.
 * It owns the palette's and the help overlay's open state and the keyboard: Ctrl/Cmd+K (and `/`) for the
 * palette, `?` for the help, and `g` then a letter to go to a page (role-scoped; see appShortcuts.ts).
 */
export function AppPaletteHost({ role, onSignOut }: { role: Role; onSignOut: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mac, setMac] = useState(false);

  const showShortcuts = useCallback(() => setHelpOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  useEffect(() => {
    const isMac = isMacPlatform(navigator.platform, navigator.userAgent);
    setMac(isMac); // eslint-disable-line react-hooks/set-state-in-effect
    const tracker = createGoToTracker(goToTargetsFor(role));

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (opensPalette(event, target, isMac)) {
        event.preventDefault();
        setLoaded(true);
        setHelpOpen(false);
        setOpen((current) => !current);
        return;
      }
      // A modal that is already open owns the keyboard.
      if (document.body.classList.contains("has-dialog") || document.querySelector("[role='dialog'][aria-modal='true']")) return;
      if (opensShortcutHelp(event, target)) {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (!isGoToCandidate(event, target)) {
        tracker.reset();
        return;
      }
      const step = tracker.press(event.key, performance.now());
      if (step.kind === "go") {
        event.preventDefault();
        router.push(step.href);
      }
    };
    const onOpen = () => {
      setLoaded(true);
      setOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);

    const warm = () => void import("./AppPalette");
    const idleWindow = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    const handle = idleWindow.requestIdleCallback ? idleWindow.requestIdleCallback(warm, { timeout: 5000 }) : window.setTimeout(warm, 3000);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
      if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [role, router]);

  return (
    <>
      {loaded ? (
        <AppPalette
          open={open}
          onClose={closePalette}
          shortcutLabel={mac ? "⌘K" : "Ctrl K"}
          role={role}
          onShowShortcuts={showShortcuts}
          onSignOut={onSignOut}
        />
      ) : null}
      <ShortcutsOverlay open={helpOpen} onClose={closeHelp} role={role} mac={mac} />
    </>
  );
}
