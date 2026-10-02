"use client";

import { useMemo } from "react";
import { buildPublicCommands } from "@/lib/palette/publicCommands";
import { CommandPalette } from "./CommandPalette";

/**
 * The public site's palette: the shared CommandPalette with the public command set. Loaded lazily by
 * PaletteHost (never imported statically), so this file and everything it pulls in (the FAQ text,
 * the palette itself) stay out of every page's bundle until the first time someone opens search.
 */
export default function PublicPalette({ open, onClose, shortcutLabel }: { open: boolean; onClose: () => void; shortcutLabel: string }) {
  const commands = useMemo(() => buildPublicCommands(), []);
  return (
    <CommandPalette
      open={open}
      onClose={onClose}
      commands={commands}
      storageKey="lt-palette-public"
      persist="session"
      label="Search LearnThrive"
      placeholder="Search pages, subjects and questions…"
      shortcutLabel={shortcutLabel}
    />
  );
}
