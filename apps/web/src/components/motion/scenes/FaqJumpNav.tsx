"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "@/app/(public)/faq/faq.module.css";

export type FaqJumpNavSection = { id: string; title: string; count: number };

/**
 * plan12.md task 12's "active category/navigation polish": highlights whichever categories are
 * currently scrolled into the top band of the viewport. One IntersectionObserver watching every
 * section at once (not one scroll listener per pill). The category grid is two columns
 * (faq.module.css's `.faqSections`), so a row can hold two categories at the same vertical
 * position — both of that row's pills light up together, rather than picking a single "topmost"
 * winner that would arbitrarily prefer one of two side-by-side sections at the same scroll offset.
 */
export function FaqJumpNav({ sections }: { sections: readonly FaqJumpNavSection[] }) {
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(
    () => new Set(sections[0] ? [sections[0].id] : []),
  );
  const sectionIds = useRef(sections.map((section) => section.id));

  useEffect(() => {
    const elements = sectionIds.current
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setActiveIds((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            if (entry.isIntersecting) next.add(entry.target.id);
            else next.delete(entry.target.id);
          }
          return next;
        });
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className={styles.jumpNav} aria-label="FAQ categories">
      <span className={styles.jumpLabel}>Jump to a topic</span>
      {sections.map((section) => {
        const isActive = activeIds.has(section.id);
        return (
          <Link
            href={`#${section.id}`}
            key={section.id}
            className={`${styles.jumpPill}${isActive ? ` ${styles.jumpPillActive}` : ""}`}
            aria-current={isActive ? "true" : undefined}
          >
            {section.title}
            <span className={styles.jumpCount}>{section.count}</span>
          </Link>
        );
      })}
    </nav>
  );
}
