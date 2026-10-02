import type { Metadata } from "next";
import Link from "next/link";
import { BrandIllustration } from "@/components/brand/BrandIllustration";
import { ButtonLink } from "@/components/ButtonLink";
import { Container } from "@/components/Container";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

/**
 * What /login and /dashboard show in production until the signed-in app exists (lib/portal.ts).
 * Not indexed, not in the sitemap, and says only what is true: the portal is not open yet, and the
 * enquiry route is the way in. It reuses the 404 page's layout so the two read as one family.
 */
export const metadata: Metadata = {
  ...createMetadata({
    title: "Portal opening soon",
    description: "The LearnThrive Tuition portal for families and tutors is not open yet.",
    path: "/portal-opening-soon",
  }),
  robots: { index: false, follow: false },
};

export default function PortalOpeningSoonPage() {
  return (
    <section className="not-found">
      <Container className="not-found__inner">
        <div>
          <p className="eyebrow">Portal opening soon</p>
          <h1>The LearnThrive portal is not open yet</h1>
          <p>
            Lessons, progress reports and the online classroom will live here for families and tutors. It
            is not available yet. In the meantime, the quickest way to reach us is to book a free
            consultation or send us a message.
          </p>
          <div className="button-group">
            <ButtonLink href="/book">Book a free consultation</ButtonLink>
            <Link className="text-link" href="/contact">
              Contact LearnThrive <span aria-hidden="true">→</span>
            </Link>
            <a className="text-link" href={`mailto:${siteConfig.email}`}>
              {siteConfig.email}
            </a>
          </div>
        </div>
        <BrandIllustration variant="soon" className="not-found__art" />
      </Container>
    </section>
  );
}
