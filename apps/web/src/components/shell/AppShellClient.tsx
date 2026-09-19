"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bell, ChevronsLeft, ChevronsRight, LogOut, Menu, UserRound, X } from "lucide-react";
import { NavIcon } from "@/components/shell/NavIcon";
import { Avatar } from "@/components/ui/Avatar";
import { Toaster } from "@/components/ui/Toaster";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { isNavItemActive, type AppNavSection } from "@/lib/navigation/appNavigation";
import { prefersReducedMotion } from "@/lib/motion/reducedMotion";
import { useDelayedUnmount } from "@/lib/motion/useDelayedUnmount";
import {
  getSidebarCollapsed, getSidebarCollapsedServer, setSidebarCollapsed, subscribeToSidebarPreference,
} from "@/lib/ui/sidebarPreference";
import type { AuthenticatedUser } from "@/lib/auth/types";

const ROLE_LABELS: Record<AuthenticatedUser["role"], string> = {
  ADMIN: "Admin", TUTOR: "Tutor", CLIENT: "Parent", STUDENT: "Student",
};

export function AppShellClient({
  user, sections, unreadCount, isDevelopment, children,
}: {
  user: AuthenticatedUser;
  sections: AppNavSection[];
  unreadCount: number;
  isDevelopment: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeToSidebarPreference, getSidebarCollapsed, getSidebarCollapsedServer);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  // Keeps each panel mounted for its own exit animation (app-pop-out / app-drawer-out) instead
  // of it vanishing the instant state flips to closed — see useDelayedUnmount's own comment.
  const menu = useDelayedUnmount(menuOpen, 100);
  const drawer = useDelayedUnmount(drawerOpen, 160);

  // The sidebar/topbar are the one part of the shell that persists across a client-side
  // navigation (only `children` swaps), so `unreadCount` genuinely can change under this same
  // mounted instance — e.g. marking a notification read elsewhere. A one-off ring on a real
  // *increase* (never on the initial mount, never on a decrease) is what plan8 section 31 asks
  // for. The change is detected during render via a second piece of state holding the previous
  // count (the paired-useState pattern useDelayedUnmount.ts's own comment explains) rather than a
  // ref — this project's lint config disallows reading a ref's `.current` during render — and the
  // effect below exists only to run the auto-clear timer, whose setState call lives inside the
  // timer callback rather than as a bare statement in the effect body.
  const [bellRinging, setBellRinging] = useState(false);
  const [previousUnreadCount, setPreviousUnreadCount] = useState(unreadCount);
  if (unreadCount !== previousUnreadCount) {
    const increased = unreadCount > previousUnreadCount;
    setPreviousUnreadCount(unreadCount);
    if (increased && !prefersReducedMotion()) setBellRinging(true);
  }
  useEffect(() => {
    if (!bellRinging) return;
    const timer = setTimeout(() => setBellRinging(false), 500);
    return () => clearTimeout(timer);
  }, [bellRinging]);

  /** Closes anything transient. Called when a navigation starts, rather than watching pathname
   * from an effect — the click is the moment we actually know a navigation is happening. */
  function dismissOverlays() {
    setDrawerOpen(false);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!drawerOpen && !menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (menuOpen) { setMenuOpen(false); menuTriggerRef.current?.focus(); }
      else if (drawerOpen) setDrawerOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!menuOpen) return;
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [drawerOpen, menuOpen]);

  // Focus the drawer's own close control when it opens, so keyboard users land inside it.
  useEffect(() => { if (drawerOpen) drawerCloseRef.current?.focus(); }, [drawerOpen]);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // replace(), not push() — the dashboard must not sit in history for Back to reveal after
      // signing out (plan6 section 25). refresh() drops the router's cached RSC payloads too.
      router.replace("/");
      router.refresh();
    }
  }

  const navigation = (
    <nav className="app-nav" aria-label="Main navigation">
      {sections.map((section, index) => (
        <div className="app-nav__section" key={section.title ?? `section-${index}`}>
          {section.title && <p className="app-nav__heading">{section.title}</p>}
          <ul>
            {section.items.map((item) => {
              const active = isNavItemActive(item, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`app-nav__link ${active ? "is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    onClick={dismissOverlays}
                  >
                    <NavIcon name={item.icon} />
                    <span className="app-nav__label">{item.label}</span>
                    {item.icon === "notifications" && unreadCount > 0 && (
                      <span className="app-nav__count" aria-label={`${unreadCount} unread`}>{unreadCount}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className={`app-shell ${collapsed ? "app-shell--collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <aside className="app-sidebar" aria-label="Product navigation">
        <div className="app-sidebar__brand">
          <Link href="/dashboard" className="app-brand">
            <Image className="app-brand__mark" src="/brand/learnthrive-mark.png" alt="" width={28} height={24} priority />
            <span className="app-brand__word">Learn<strong>Thrive</strong></span>
          </Link>
        </div>
        {navigation}
        <button type="button" className="app-sidebar__collapse" onClick={() => setSidebarCollapsed(!collapsed)} aria-pressed={collapsed}>
          {collapsed ? <ChevronsRight size={16} aria-hidden="true" /> : <ChevronsLeft size={16} aria-hidden="true" />}
          <span className="app-nav__label">{collapsed ? "Expand" : "Collapse"}</span>
        </button>
      </aside>

      {drawer.rendered && (
        <div className={`app-drawer ${drawer.closing ? "is-closing" : ""}`} role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="app-drawer__panel">
            <div className="app-drawer__top">
              <Link href="/dashboard" className="app-brand">
                <Image className="app-brand__mark" src="/brand/learnthrive-mark.png" alt="" width={28} height={24} priority />
                <span className="app-brand__word">Learn<strong>Thrive</strong></span>
              </Link>
              <button ref={drawerCloseRef} type="button" className="icon-button" onClick={() => setDrawerOpen(false)} aria-label="Close navigation">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {navigation}
          </div>
          <button type="button" className="app-drawer__scrim" onClick={() => setDrawerOpen(false)} tabIndex={-1} aria-hidden="true" />
        </div>
      )}

      <div className="app-main">
        <header className="app-topbar">
          <button type="button" className="icon-button app-topbar__menu" onClick={() => setDrawerOpen(true)} aria-label="Open navigation" aria-expanded={drawerOpen}>
            <Menu size={20} aria-hidden="true" />
          </button>

          <div className="app-topbar__spacer" />

          {isDevelopment && (
            <span className="dev-badge" title="Development environment · Data resets on server restart">
              Dev
            </span>
          )}

          <Link
            href="/dashboard/notifications"
            className={`icon-button app-topbar__bell ${bellRinging ? "is-ringing" : ""}`}
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          >
            <Bell size={19} aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="app-topbar__badge" aria-hidden="true">
                {unreadCount > 9 ? "9+" : <AnimatedNumber value={unreadCount} />}
              </span>
            )}
          </Link>

          <div className="app-usermenu">
            <button
              ref={menuTriggerRef}
              type="button"
              className="app-usermenu__trigger"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-controls={menuId}
              aria-label="Account menu"
            >
              <Avatar name={user.name} size="sm" />
              <span className="app-usermenu__who">
                <span className="app-usermenu__name">{user.name}</span>
                <span className="app-usermenu__role">{ROLE_LABELS[user.role]}</span>
              </span>
            </button>
            {menu.rendered && (
              <div className={`app-usermenu__panel ${menu.closing ? "is-closing" : ""}`} id={menuId} role="menu" ref={menuRef}>
                <div className="app-usermenu__header">
                  <Avatar name={user.name} size="md" />
                  <div>
                    <p className="app-usermenu__name">{user.name}</p>
                    <p className="app-usermenu__meta">{ROLE_LABELS[user.role]} · {user.email}</p>
                  </div>
                </div>
                <Link href="/dashboard/settings" className="app-usermenu__item" role="menuitem">
                  <UserRound size={16} aria-hidden="true" />Account settings
                </Link>
                <button type="button" className="app-usermenu__item app-usermenu__item--danger" role="menuitem" onClick={handleLogout} disabled={signingOut}>
                  <LogOut size={16} aria-hidden="true" />{signingOut ? "Signing out…" : "Log out"}
                </button>
              </div>
            )}
          </div>
        </header>

        {/* plan8 section 12 asks for a restrained per-navigation content fade. Tried it here as
            `key={pathname}` on this element (forcing a fresh mount so the CSS entrance animation
            replays on every navigation) — reverted: it made the incoming page's own controls
            briefly "unstable" during the transition (a link Playwright's actionability check, and
            a real click, both have to wait out), catching real interaction failures across the
            e2e suite the instant it landed. Section 72 is explicit that interaction must never be
            delayed to let a motion effect finish, and this genuinely did — so on that rule alone,
            not just the test failures, it comes back out rather than being patched to "pass". */}
        <main id="main-content" className="app-content">{children}</main>
      </div>

      {/* useSearchParams needs a Suspense boundary; the toaster renders nothing until an action
          actually reports back, so there's no fallback worth showing. */}
      <Suspense fallback={null}><Toaster /></Suspense>
    </div>
  );
}
