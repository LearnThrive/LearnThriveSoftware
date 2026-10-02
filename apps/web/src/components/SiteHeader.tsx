"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMotionValueEvent, useScroll } from "framer-motion";
import { Brand } from "@/components/Brand";
import { ButtonLink } from "@/components/ButtonLink";
import { Container } from "@/components/Container";
import { PaletteTrigger } from "@/components/palette/PaletteTrigger";
import { ThemeToggle } from "@/components/ThemeToggle";
import { navigation } from "@/lib/site";

interface SiteHeaderSession {
  name: string;
  role: string;
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<SiteHeaderSession | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // plan11.md task 13's "airy at top -> compact/solid when scrolled, avoid per-pixel React scroll
  // state": scrollY is read via Motion's own scroll listener (framework-optimised, not a raw
  // `window.addEventListener("scroll", ...)`), and setState only fires when the boolean
  // *threshold* actually flips — never once per pixel scrolled. The same "compare against a ref,
  // setState only on a real change" shape as SafeguardingScene.tsx's select() and
  // thresholds.ts's createThresholdTracker.
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const scrolledRef = useRef(false);
  useMotionValueEvent(scrollY, "change", (latest) => {
    const next = latest > 24;
    if (next === scrolledRef.current) return;
    scrolledRef.current = next;
    setScrolled(next);
  });

  // Asked for after hydration rather than rendered on the server, so these pages stay statically
  // generated (plan6 section 99). Until it resolves the header shows "Login", which is the right
  // default for the overwhelming majority of marketing-site visitors.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { signedIn?: boolean; name?: string; role?: string } | null) => {
        if (cancelled || !data?.signedIn || !data.name || !data.role) return;
        setSession({ name: data.name, role: data.role });
      })
      .catch(() => { /* signed-out is the safe assumption, and the default already shown */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && open) {
        setOpen(false);
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
    }

    document.addEventListener("keydown", handleEscape);
    document.body.classList.toggle("menu-open", open);

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.classList.remove("menu-open");
    };
  }, [open]);

  function isCurrent(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  // Where the visitor is in the menu, so each link knows which way it leads. A page that is not a
  // menu item (a subject page, a legal page) counts as the Subjects/Home end of the menu: the
  // plain fade is used for those in practice, because only menu links carry a direction.
  const matchedIndex = navigation.findIndex((item) => item.href !== "/" && isCurrent(item.href));
  const currentIndex = matchedIndex !== -1 ? matchedIndex : isCurrent("/") ? 0 : -1;

  return (
    <header className={`site-header${scrolled ? " site-header--scrolled" : ""}`}>
      <Container className="site-header__inner">
        <Brand />
        <button
          ref={menuButtonRef}
          className="menu-toggle"
          type="button"
          aria-expanded={open}
          aria-controls="primary-navigation"
          aria-label={open ? "Close main menu" : "Open main menu"}
          onClick={() => setOpen((current) => !current)}
        >
          <span />
          <span />
          <span />
        </button>
        <div
          className={`navigation-shell ${open ? "navigation-shell--open" : ""}`}
          id="primary-navigation"
          data-lenis-prevent
        >
          <nav className="primary-navigation" aria-label="Main navigation">
            {navigation.map((item, index) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent(item.href) ? "page" : undefined}
                // Route-transition direction by position in the menu (plan15 Wave 8): going to a
                // later item slides the page in from the right, an earlier one from the left.
                transitionTypes={[index > currentIndex ? "nav-forward" : "nav-back"]}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {/* Someone already signed in has no use for a "Login" link — send them to their
              dashboard instead (plan6 sections 14 and 78). */}
          {session ? (
            <Link
              href="/dashboard"
              className="header-login"
              onClick={() => setOpen(false)}
            >
              Dashboard
              <span className="header-login__who">{session.name.split(" ")[0]}</span>
            </Link>
          ) : (
            <Link
              href="/login"
              className="header-login"
              aria-current={isCurrent("/login") ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              Login
            </Link>
          )}
          <PaletteTrigger className="header-icon-button" />
          <ThemeToggle variant="cycle" className="header-theme" />
          <ButtonLink href="/book" className="header-cta">
            Book a free consultation
          </ButtonLink>
        </div>
      </Container>
      {/* plan11.md task 13's "backdrop -> panel -> links -> CTA" mobile choreography: this dims the
          page behind the open menu and gives touch/mouse users a large, obvious way to dismiss it
          (keyboard users already have the Escape handler above). Only ever rendered with real
          effect on narrow viewports — .navigation-backdrop is 0-opacity/non-interactive outside
          the mobile menu's own breakpoint, see globals.css. */}
      <div
        className={`navigation-backdrop${open ? " navigation-backdrop--open" : ""}`}
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />
    </header>
  );
}
