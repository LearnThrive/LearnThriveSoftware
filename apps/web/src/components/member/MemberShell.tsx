"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ChevronsLeft, ChevronsRight, House, Menu, MessagesSquare, Search, UserRound, X } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import styles from "./MemberShell.module.css";

/**
 * The signed-in Library area's frame: ONE navigation, the product's own sidebar convention (navy, labelled, collapsible; the same
 * look as the dashboard's app sidebar), instead of a floating icon rail. Pages can add their own section to the same sidebar (Study
 * Buddy puts the chat list there) through <SidebarSection>, so there is never a second, competing navigation column.
 *
 * Desktop (64rem and up): the sidebar sits beside the content and can be collapsed to icons (remembered for this visit only: nothing
 * is kept in the browser). Smaller screens: a slim top bar with the brand, the page name and a menu button; the same sidebar slides
 * in as a drawer, the page behind it is inert, Escape or the scrim closes it, and a navigation closes it too.
 */
export type MemberNavIcon = "home" | "library" | "study-buddy" | "search" | "account";
export interface MemberNavItem {
  href: string;
  label: string;
  icon: MemberNavIcon;
}

const ICONS: Record<MemberNavIcon, typeof House> = { home: House, library: BookOpen, "study-buddy": MessagesSquare, search: Search, account: UserRound };

interface SidebarApi {
  slot: HTMLElement | null;
  collapsed: boolean;
  closeDrawer: () => void;
}
const SidebarContext = createContext<SidebarApi>({ slot: null, collapsed: false, closeDrawer: () => {} });

/** Renders its children into the member sidebar, under the navigation. */
export function SidebarSection({ children }: { children: ReactNode }) {
  const { slot } = useContext(SidebarContext);
  return slot ? createPortal(children, slot) : null;
}

export function useMemberSidebar(): Pick<SidebarApi, "collapsed" | "closeDrawer"> {
  const { collapsed, closeDrawer } = useContext(SidebarContext);
  return { collapsed, closeDrawer };
}

/** The most specific item that matches the path: /library/study-buddy is Study Buddy, not Library. */
function activeHref(items: readonly MemberNavItem[], pathname: string): string | null {
  const matches = items.filter((item) => (item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

export function MemberShell({ items, children }: { items: readonly MemberNavItem[]; children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const active = activeHref(items, pathname);
  const current = items.find((item) => item.href === active);

  const closeDrawer = useCallback(() => setOpen(false), []);

  // Opening moves focus into the drawer; closing it (Escape, the close button, the scrim) gives focus back to the menu button once
  // the page is no longer inert. A navigation from inside the drawer leaves focus to the new page.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (open) {
      closeButton.current?.focus();
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          returnFocus.current = true;
          setOpen(false);
        }
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
    if (returnFocus.current) {
      returnFocus.current = false;
      menuButton.current?.focus();
    }
  }, [open]);

  const dismiss = () => {
    returnFocus.current = true;
    setOpen(false);
  };

  return (
    <SidebarContext.Provider value={{ slot, collapsed, closeDrawer }}>
      <div className={`${styles.shell} ${collapsed ? styles.collapsed : ""}`} data-member-shell="">
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>

        <header className={styles.topbar} inert={open || undefined}>
          <button ref={menuButton} type="button" className={styles.menuButton} onClick={() => setOpen(true)} aria-expanded={open} aria-controls="member-sidebar" aria-label="Open menu">
            <Menu size={20} aria-hidden="true" />
          </button>
          <Link href="/" className={styles.topBrand} aria-label="LearnThrive home">
            <BrandMark className={styles.mark} />
          </Link>
          <span className={styles.topTitle}>{current?.label ?? "Library"}</span>
        </header>

        <aside id="member-sidebar" className={`${styles.sidebar} ${open ? styles.open : ""}`} aria-label="Library navigation">
          <div className={styles.brandRow}>
            <Link href="/" className={styles.brand} onClick={closeDrawer}>
              <BrandMark className={styles.mark} />
              <span className={styles.word}>
                Learn<strong>Thrive</strong>
              </span>
            </Link>
            <button ref={closeButton} type="button" className={styles.closeButton} onClick={dismiss} aria-label="Close menu">
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <nav aria-label="Library" className={styles.nav}>
            <ul>
              {items.map((item) => {
                const Icon = ICONS[item.icon];
                const isActive = item.href === active;
                return (
                  <li key={item.href}>
                    <Link href={item.href} className={`${styles.link} ${isActive ? styles.active : ""}`} aria-current={isActive ? "page" : undefined} title={collapsed ? item.label : undefined} onClick={closeDrawer}>
                      <Icon size={18} aria-hidden="true" />
                      <span className={styles.label}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div ref={setSlot} className={styles.slot} hidden={collapsed || undefined} />

          <button type="button" className={styles.collapse} onClick={() => setCollapsed((c) => !c)} aria-pressed={collapsed} aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}>
            {collapsed ? <ChevronsRight size={16} aria-hidden="true" /> : <ChevronsLeft size={16} aria-hidden="true" />}
            <span className={styles.label}>{collapsed ? "Expand" : "Collapse"}</span>
          </button>
        </aside>
        {open ? <button type="button" className={styles.scrim} onClick={dismiss} tabIndex={-1} aria-hidden="true" /> : null}

        <div className={styles.content} inert={open || undefined}>
          {children}
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
