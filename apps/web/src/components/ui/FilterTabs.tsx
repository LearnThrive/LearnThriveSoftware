"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  tone?: "warning";
}

/**
 * Tab-style filters backed by a real URL query parameter, not client state — so a filtered view
 * is linkable, survives a reload, and works with browser Back (plan6 sections 41, 57, 63, 107's
 * "filters must work").
 *
 * The underline slides between tabs rather than just appearing under whichever one is active
 * (plan8 section 18) — a small amount of measurement, not a rewrite: each tab keeps its own real
 * `<Link>` and its own always-correct border-bottom-color, and a `ResizeObserver` positions a
 * shared indicator bar under the active one on top of that. If the tabs wrap onto more than one
 * line (a narrow phone with several filters) sliding a single bar stops meaning anything, so the
 * indicator just hides and the per-tab border underneath — which needed no JS and is never
 * wrong — is what actually shows.
 */
export function FilterTabs({ basePath, param, current, options }: {
  basePath: string;
  param: string;
  current: string;
  options: FilterOption[];
}) {
  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef(new Map<string, HTMLAnchorElement>());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const activeTab = tabRefs.current.get(current);
    if (!nav || !activeTab) { setIndicator(null); return; }

    const measure = () => {
      const firstTab = tabRefs.current.get(options[0]?.value ?? "");
      // More than one line — a single sliding bar can't represent "the active tab" sensibly.
      if (firstTab && activeTab.offsetTop !== firstTab.offsetTop) { setIndicator(null); return; }
      setIndicator({ left: activeTab.offsetLeft, width: activeTab.offsetWidth });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [current, options]);

  return (
    <nav className="filter-tabs" aria-label="Filter" ref={navRef}>
      <span
        className={`filter-tabs__indicator ${indicator ? "is-visible" : ""}`}
        style={indicator ? { transform: `translateX(${indicator.left}px)`, width: `${indicator.width}px` } : undefined}
        aria-hidden="true"
      />
      {options.map((option) => {
        const active = option.value === current;
        return (
          <Link
            key={option.value}
            ref={(el) => { if (el) tabRefs.current.set(option.value, el); else tabRefs.current.delete(option.value); }}
            href={`${basePath}?${param}=${encodeURIComponent(option.value)}`}
            className={`filter-tab ${active ? "is-active" : ""} ${option.tone ? `filter-tab--${option.tone}` : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {option.label}
            {option.count !== undefined && <span className="filter-tab__count">{option.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
