import type { ReactNode } from "react";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import { PageTransition } from "@/components/motion/PageTransition";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

/**
 * Chrome for every public marketing page (plan6 section 13's PublicShell).
 *
 * Deliberately does NOT read the session here. These pages are statically generated for SEO
 * (plan6 section 99) and touching cookies in this layout would turn all of them dynamic — the
 * header handles session awareness itself, after hydration, via /api/auth/session.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <AnnouncementBar />
      <SiteHeader />
      <main id="main-content">
        <PageTransition>{children}</PageTransition>
      </main>
      <SiteFooter />
    </>
  );
}
