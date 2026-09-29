"use client";

import { useEffect, useState } from "react";

/**
 * plan11.md task 12's "active-heading/section-progress indication without scroll-state rerender
 * flooding". Replaces LegalPage.tsx's plain static <nav> with one that highlights whichever
 * section is currently in view — via IntersectionObserver, not a scroll listener: the browser only
 * calls back when a section actually crosses the threshold, so a state update happens on real
 * section changes, never once per scroll pixel. The rootMargin biases toward "whichever heading is
 * near the top of the viewport" rather than "anything at all visible", so on a normal-length
 * section only one is ever the active one.
 *
 * Content itself is untouched — this only replaces the sidebar TOC, never the .legal-prose article
 * LegalPage.tsx still renders itself, so no legal wording passes through this file at all.
 */
export function LegalContentsNav({
  sections,
}: {
  sections: Array<{ id: string; title: string }>;
}) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.filter((entry) => entry.isIntersecting);
        if (intersecting.length === 0) return;
        setActiveId(intersecting[0].target.id);
      },
      // Biases toward a heading once it has scrolled into the top ~30% of the viewport, and stops
      // counting it once it's within the bottom 60% — approximating "the section the reader is
      // currently at", not merely "on screen somewhere".
      { rootMargin: "-15% 0px -60% 0px", threshold: 0 },
    );

    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => el !== null);
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav aria-labelledby="legal-contents-title">
      <h2 id="legal-contents-title">On this page</h2>
      <ol>
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={activeId === section.id ? "true" : undefined}
              className={activeId === section.id ? "is-active" : undefined}
            >
              {section.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
