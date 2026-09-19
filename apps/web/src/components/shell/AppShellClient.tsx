"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bell, ChevronsLeft, ChevronsRight, LogOut, Menu, UserRound, X } from "lucide-react";
import { NavIcon } from "@/components/shell/NavIcon";
import { Avatar } from "@/components/ui/Avatar";
import { Toaster } from "@/components/ui/Toaster";
import { isNavItemActive, type AppNavSection } from "@/lib/navigation/appNavigation";
import {
  getSidebarCollapsed, getSidebarCollapsedServer, setSidebarCollapsed, subscribeToSidebarPreference,
} from "@/lib/ui/sidebarPreference";
import type { AuthenticatedUser } from "@/lib/auth/types";

const ROLE_LABELS: Record<AuthenticatedUser["role"], string> = {
  ADMIN: "Admin", TUTOR: "Tutor", CLIENT: "Parent", STUDENT: "Student",
};

export function AppShellClient({
  user, sections, unreadCount, children,
}: {
  user: AuthenticatedUser;
  sections: AppNavSection[];
  unreadCount: number;
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
            <span className="app-brand__mark" aria-hidden="true">LT</span>
            <span className="app-brand__word">Learn<strong>Thrive</strong></span>
          </Link>
        </div>
        {navigation}
        <button type="button" className="app-sidebar__collapse" onClick={() => setSidebarCollapsed(!collapsed)} aria-pressed={collapsed}>
          {collapsed ? <ChevronsRight size={16} aria-hidden="true" /> : <ChevronsLeft size={16} aria-hidden="true" />}
          <span className="app-nav__label">{collapsed ? "Expand" : "Collapse"}</span>
        </button>
      </aside>

      {drawerOpen && (
        <div className="app-drawer" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="app-drawer__panel">
            <div className="app-drawer__top">
              <Link href="/dashboard" className="app-brand">
                <span className="app-brand__mark" aria-hidden="true">LT</span>
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

          <Link href="/dashboard/notifications" className="icon-button app-topbar__bell" aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}>
            <Bell size={19} aria-hidden="true" />
            {unreadCount > 0 && <span className="app-topbar__badge" aria-hidden="true">{unreadCount > 9 ? "9+" : unreadCount}</span>}
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
            {menuOpen && (
              <div className="app-usermenu__panel" id={menuId} role="menu" ref={menuRef}>
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

        <main id="main-content" className="app-content">{children}</main>
      </div>

      {/* useSearchParams needs a Suspense boundary; the toaster renders nothing until an action
          actually reports back, so there's no fallback worth showing. */}
      <Suspense fallback={null}><Toaster /></Suspense>
    </div>
  );
}
