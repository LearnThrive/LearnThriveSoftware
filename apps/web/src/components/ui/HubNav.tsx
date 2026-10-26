"use client";

// Icon artwork and the expanding-label idea: From Uiverse.io by Admin12121 (UI Components/Radio.html).
// The Library icon is drawn here in the same 256-grid, 16-stroke style (the source's "Games" icon is dropped).
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./HubNav.module.css";

/**
 * The signed-in Library area's icon menu (plan19.md section 7): a bottom bar on narrow screens, a side rail from
 * 64rem up. Every label is visible (icon over label) except on a wide screen with a pointer, where it is the
 * Uiverse icon rail: the current item, and any item that is hovered or keyboard-focused, expands to show its label.
 * The label is always in the accessibility tree, so a collapsed link still has its name. Never use it in the
 * marketing header.
 *
 * - `placement="fixed"` (default) pins it to the bottom edge / left edge, respecting safe-area insets. The page
 *   must leave room: padding-block-end of about 5rem under 64rem (more if a label wraps), padding-inline-start of about 6rem from 64rem,
 *   and scroll-padding-block-end of the same, so a focused element is not hidden behind the bar.
 * - `placement="inline"` leaves it in normal flow (stories, benches, a layout that slots it into a grid).
 * - `current`: the href of the current page. Omitted, it is derived from the URL path (longest matching prefix),
 *   so it needs no wiring in a layout.
 *
 * This is a client module: a server component can render <HubNav /> (it uses its own default items) but cannot
 * read `hubNavItems` from here; copy the list or import it from another client component.
 */

export type HubNavIconName = "home" | "library" | "study-buddy" | "search" | "account";

export interface HubNavItem {
  href: string;
  label: string;
  /** One of the built-in icons, or your own element (it is sized by CSS, so leave off width and height). */
  icon: HubNavIconName | ReactNode;
}

/** Search is its own route, not a query string, so the current page can be derived from the path alone. */
export const hubNavItems: HubNavItem[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/library", label: "Library", icon: "library" },
  { href: "/library/study-buddy", label: "LearnThrive AI", icon: "study-buddy" },
  { href: "/library/search", label: "Search", icon: "search" },
  { href: "/account", label: "Account", icon: "account" },
];

/**
 * Picks the item whose path is the longest match for the page: "/library/study-buddy" is LearnThrive AI, not Library;
 * "/library/x" is Library; "/" matches only exactly. Query strings and hashes in an item's href are ignored.
 */
export function matchCurrentHref(items: readonly HubNavItem[], pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  let best: { href: string; length: number } | undefined;
  for (const { href } of items) {
    const path = href.split(/[?#]/)[0];
    if (!path) continue;
    const matches = pathname === path || (path !== "/" && pathname.startsWith(`${path}/`));
    if (matches && (!best || path.length > best.length)) best = { href, length: path.length };
  }
  return best?.href;
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeWidth={16}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<HubNavIconName, ReactNode> = {
  home: (
    <Svg>
      <path d="M213.3815,109.61945,133.376,36.88436a8,8,0,0,0-10.76339.00036l-79.9945,72.73477A8,8,0,0,0,40,115.53855V208a8,8,0,0,0,8,8H208a8,8,0,0,0,8-8V115.53887A8,8,0,0,0,213.3815,109.61945Z" />
    </Svg>
  ),
  library: (
    <Svg>
      <path d="M128 72a32 32 0 0 0-32-32H24v144h72a32 32 0 0 1 32 32" />
      <path d="M128 72a32 32 0 0 1 32-32h72v144h-72a32 32 0 0 0-32 32" />
      <line x1="128" y1="72" x2="128" y2="216" />
    </Svg>
  ),
  "study-buddy": (
    <Svg>
      <path d="M45.42853,176.99811A95.95978,95.95978,0,1,1,79.00228,210.5717l.00023-.001L45.84594,220.044a8,8,0,0,1-9.89-9.89l9.47331-33.15657Z" />
      <line x1="96" y1="112" x2="160" y2="112" />
      <line x1="96" y1="144" x2="160" y2="144" />
    </Svg>
  ),
  search: (
    <Svg>
      <circle cx="116" cy="116" r="84" />
      <line x1="175.39356" y1="175.40039" x2="223.99414" y2="224.00098" />
    </Svg>
  ),
  account: (
    <Svg>
      <circle cx="128" cy="96" r="64" />
      <path d="M30.989,215.99064a112.03731,112.03731,0,0,1,194.02311.002" />
    </Svg>
  ),
};

export interface HubNavProps {
  items?: readonly HubNavItem[];
  /** The href of the current page. Omit to derive it from the URL path. */
  current?: string;
  ariaLabel?: string;
  placement?: "fixed" | "inline";
}

export function HubNav({ items = hubNavItems, current, ariaLabel = "Library", placement = "fixed" }: HubNavProps) {
  const pathname = usePathname();
  const currentHref = current ?? matchCurrentHref(items, pathname);

  return (
    <nav className={styles.nav} aria-label={ariaLabel} data-placement={placement}>
      <ul className={styles.menu}>
        {items.map((item) => (
          <li className={styles.item} key={item.href}>
            <Link
              className={styles.link}
              href={item.href}
              aria-current={item.href === currentHref ? "page" : undefined}
              data-hub-nav-item={item.label}
            >
              <span className={styles.icon}>
                {typeof item.icon === "string" && Object.hasOwn(ICONS, item.icon) ? ICONS[item.icon as HubNavIconName] : item.icon}
              </span>
              <span className={styles.label}>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
