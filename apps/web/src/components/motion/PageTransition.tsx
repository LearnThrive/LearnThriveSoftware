"use client";

import { ViewTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * The site-wide route transition (plan15 Wave 8): the header persists, and the page content
 * cross-fades with a small directional offset, ~260-380ms, never blocking.
 *
 * It wraps the content of every public page once, here, rather than in each of the seventeen
 * `page.tsx` files. Keying on the pathname makes React treat the outgoing and incoming page as an
 * exit/enter pair inside the navigation's own transition (Next navigations are React transitions,
 * so <ViewTransition> activates with no configuration; see node_modules/next/dist/docs/01-app/
 * 02-guides/view-transitions.md, step 4: "crossfade content within the same route", applied to the
 * whole route).
 *
 * Direction: the header's nav links tag their navigation `nav-forward` or `nav-back` by their order
 * in the menu (SiteHeader.tsx), and those two types slide the new page in from the right or the
 * left. Any other navigation (a button, a card, a footer link, the browser's own Back) carries no
 * type and gets the plain fade, which is the honest answer when "forward" has no meaning.
 *
 * What it must never do — and what tests-e2e/view-transitions.spec.ts asserts across a multi-route
 * journey — is delay an interaction: the overlay is `pointer-events: none` (globals.css), links and
 * buttons are actionable the instant the new page exists, and under reduced motion, on the light
 * tier, or in a browser without the View Transitions API the navigation is simply instant.
 * `default="none"` stops it animating for unrelated transitions (a Suspense reveal, a refresh).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition
      key={pathname}
      name="page-content"
      enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page-fade" }}
      exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page-fade" }}
      default="none"
    >
      <div className="page-transition">{children}</div>
    </ViewTransition>
  );
}
