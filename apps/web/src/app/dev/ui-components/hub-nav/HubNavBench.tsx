"use client";

import { useState, type MouseEvent } from "react";
import { HubNav, hubNavItems, type HubNavItem } from "@/components/ui/HubNav";
import styles from "./page.module.css";

/** The live bench: the default items' labels and icons, but each link goes to a harmless anchor on this page. */
const LIVE_ITEMS: HubNavItem[] = hubNavItems.map((item) => ({
  ...item,
  href: `#live-${item.label.toLowerCase().replace(/\s+/g, "-")}`,
}));

/** URL-derived: no `current` prop. This page is /dev/ui-components/hub-nav, so the longest match wins over /dev/ui-components. */
const DERIVED_ITEMS: HubNavItem[] = [
  { href: "/dev", label: "Dev", icon: "home" },
  { href: "/dev/ui-components", label: "Components", icon: "library" },
  { href: "/dev/ui-components/hub-nav", label: "Hub nav", icon: "search" },
];

export function HubNavBench() {
  const [liveCurrent, setLiveCurrent] = useState(LIVE_ITEMS[0].href);
  const [activated, setActivated] = useState("none yet");

  // next/link updates the address bar with pushState, which fires no event, so the bench watches the clicks
  // (Enter on a focused link is a click too) and moves `current` itself, as a real layout would by route.
  function onLiveClick(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element).closest("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    setLiveCurrent(href);
    setActivated(anchor?.textContent ?? href);
  }

  return (
    <>
      <section aria-labelledby="states-heading">
        <h2 id="states-heading">Each current item</h2>
        <div className={styles.row}>
          {hubNavItems.map((item) => (
            <div key={item.href} className={styles.cell} data-testid={`state-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <p className={styles.caption}>{item.label} is current</p>
              <HubNav placement="inline" current={item.href} ariaLabel={`Library menu, ${item.label} current`} />
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="derived-heading">
        <h2 id="derived-heading">Current derived from the URL</h2>
        <div className={styles.cell} data-testid="state-derived">
          <p className={styles.caption}>No current prop</p>
          <HubNav placement="inline" items={DERIVED_ITEMS} ariaLabel="Library menu, derived current" />
        </div>
      </section>

      <section aria-labelledby="live-heading">
        <h2 id="live-heading">Live, pinned to the edge</h2>
        <p role="status" data-testid="live-status">
          Last activated: {activated}
        </p>
        <div onClickCapture={onLiveClick}>
          <HubNav items={LIVE_ITEMS} current={liveCurrent} ariaLabel="Library menu, live" />
        </div>
        <p id="live-home" tabIndex={-1} className={styles.target}>
          Home target
        </p>
        <p id="live-library" tabIndex={-1} className={styles.target}>
          Library target
        </p>
        <p id="live-study-buddy" tabIndex={-1} className={styles.target}>
          Study Buddy target
        </p>
        <p id="live-search" tabIndex={-1} className={styles.target}>
          Search target
        </p>
        <p id="live-account" tabIndex={-1} className={styles.target}>
          Account target
        </p>
      </section>
    </>
  );
}
