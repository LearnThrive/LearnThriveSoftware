import Link from "next/link";
import { Brand } from "@/components/Brand";
import { Container } from "@/components/Container";
import { PhoneContacts } from "@/components/PhoneContacts";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { navigation, siteConfig, subjects } from "@/lib/site";

// Kept "Privacy" ahead of the requested Cookies/Website Terms/Tuition Terms/Safeguarding/
// Complaints/Accessibility row rather than dropping it: EnquiryForm already links to it
// ("you agree to our privacy notice"), and UK GDPR expects a visible privacy notice link.
const legalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/cookies", label: "Cookies" },
  { href: "/terms", label: "Website Terms" },
  { href: "/tuition-terms", label: "Tuition Terms" },
  { href: "/safeguarding", label: "Safeguarding" },
  { href: "/complaints", label: "Complaints" },
  { href: "/accessibility", label: "Accessibility" },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      {/* plan11.md task 13's "small settle/handoff effect, no loop" — a one-time rise-and-fade as
          the footer scrolls into view, the same Reveal every other below-the-fold block on the
          site already uses. It's the last thing on every page, so there's no LCP concern here the
          way there is for first-screen content. */}
      <Reveal variant="soft">
        <Container>
          <div className="footer-grid">
            <div className="footer-brand">
              <Brand inverse />
              <p className="footer-tagline">{siteConfig.tagline}</p>
              <p>
                Personalised online tuition built around each student’s needs,
                pace and goals.
              </p>
            </div>
            <div className="footer-column">
              <h2>Explore</h2>
              <ul>
                {navigation.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href}>{item.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="footer-column">
              <h2>Subjects</h2>
              <ul>
                {subjects.map((subject) => (
                  <li key={subject.slug}>
                    <Link href={subject.path}>{subject.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="footer-column footer-contact">
              <h2>Contact</h2>
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
              <PhoneContacts layout="stacked" />
              <div className="footer-social">
                <a
                  href={siteConfig.social.instagram}
                  target="_blank"
                  rel="noreferrer"
                >
                  Instagram<span className="sr-only"> (opens in a new tab)</span>
                </a>
                <a
                  href={siteConfig.social.linkedin}
                  target="_blank"
                  rel="noreferrer"
                >
                  LinkedIn<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </div>
              <Link
                className="footer-login"
                href={siteConfig.tutorLoginUrl}
              >
                Tutor login
              </Link>
            </div>
          </div>
          <div className="footer-bottom">
            <p>
              © {new Date().getFullYear()} {siteConfig.name}. All rights reserved.
            </p>
            <nav aria-label="Legal information">
              {legalLinks.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <p className="footer-registration">
            {siteConfig.legalName} &middot; Company No. {siteConfig.companyNumber} &middot;
            registered in {siteConfig.registeredIn} &middot; Correspondence address:{" "}
            {siteConfig.correspondenceAddress}
          </p>
        </Container>
      </Reveal>
    </footer>
  );
}
