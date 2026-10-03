"use client";

import { Search } from "lucide-react";
import { OPEN_PALETTE_EVENT } from "@/lib/palette/events";

/**
 * The visible entry point (plan15 13.3: "a visible Search button in the header") for visitors who
 * will never press Ctrl+K — most parents, and everyone on a phone. It only announces the request;
 * PaletteHost, mounted once in the layout, owns the palette.
 */
export function PaletteTrigger({ className, label = "Search the site" }: { className?: string; label?: string }) {
  return (
    <button
      type="button"
      className={className}
      data-palette-trigger=""
      aria-label={label}
      aria-haspopup="dialog"
      onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
    >
      <Search aria-hidden="true" size={18} strokeWidth={1.8} />
    </button>
  );
}
