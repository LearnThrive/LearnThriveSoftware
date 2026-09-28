"use client";

import { useEffect } from "react";

/**
 * Opens the <details> element targeted by the URL hash, so links like
 * /faq#lesson-recordings reveal the answer instead of scrolling to a
 * collapsed row. Runs on mount and on every hash change.
 */
export function FaqHashOpener() {
  useEffect(() => {
    const openFromHash = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;

      let el: Element | null = null;
      try {
        el = document.getElementById(decodeURIComponent(id));
      } catch {
        el = document.getElementById(id);
      }
      if (!el) return;

      const details = el.closest("details");
      if (details instanceof HTMLDetailsElement && !details.open) {
        details.open = true;
        details.scrollIntoView({ block: "nearest" });
      }
    };

    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  return null;
}
