"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMotionValueEvent, useScroll } from "framer-motion";

/**
 * A sticky "Book a free consultation" bar for phones (plan15 Wave 10 section 14.2): it appears once the
 * visitor has scrolled past the first screen, stays out of the way, and goes away for good when dismissed.
 *
 *  - Phones only: it is `display: none` above the mobile breakpoint (globals.css), so the desktop header's
 *    own persistent CTA is the only one there.
 *  - Never over a form: it is not rendered on the pages that ARE the enquiry (/book, /contact, the portal
 *    notice), and it hides while any form field has focus (the on-screen keyboard is up and the bar would
 *    sit on top of what is being typed) and while the footer is on screen.
 *  - Safe-area aware (the iPhone home indicator), a 44px dismiss target, and a plain link otherwise.
 *  - Dismissal lasts until the page is reloaded and is kept in memory, not in browser storage (the
 *    Cookie notice says exactly what the site stores, and this is not worth adding to it).
 *
 * Tiers: no motion beyond a CSS slide; under reduced motion globals.css removes the transition.
 */
const HIDDEN_ON = new Set(["/book", "/contact", "/portal-opening-soon"]);
let dismissedThisPageLoad = false;

export function MobileEnquiryBar() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(dismissedThisPageLoad);
  const [pastHero, setPastHero] = useState(false);
  const [typing, setTyping] = useState(false);
  const [footerInView, setFooterInView] = useState(false);
  const pastRef = useRef(false);

  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, "change", (latest) => {
    const next = latest > window.innerHeight * 0.9;
    if (next === pastRef.current) return;
    pastRef.current = next;
    setPastHero(next);
  });

  useEffect(() => {
    const isField = (target: EventTarget | null) =>
      target instanceof HTMLElement && target.matches("input, textarea, select, [contenteditable='true']");
    const onFocusIn = (event: FocusEvent) => setTyping(isField(event.target));
    const onFocusOut = () => setTyping(false);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useEffect(() => {
    const footer = document.querySelector("footer.site-footer");
    if (!footer) return;
    const observer = new IntersectionObserver(([entry]) => setFooterInView(entry.isIntersecting));
    observer.observe(footer);
    return () => observer.disconnect();
  }, [pathname]);

  if (dismissed || HIDDEN_ON.has(pathname)) return null;

  const visible = pastHero && !typing && !footerInView;
  return (
    <aside className="enquiry-bar" data-visible={visible ? "true" : "false"} aria-label="Free consultation" inert={!visible}>
      <Link className="enquiry-bar__cta" href="/book">
        Book a free consultation
      </Link>
      <button
        className="enquiry-bar__dismiss"
        type="button"
        aria-label="Dismiss this bar"
        onClick={() => {
          dismissedThisPageLoad = true;
          setDismissed(true);
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 5l10 10M15 5L5 15" />
        </svg>
      </button>
    </aside>
  );
}
