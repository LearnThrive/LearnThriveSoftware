import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ButtonLink } from "@/components/ButtonLink";
import { Container } from "@/components/Container";
import { PageHero } from "@/components/PageHero";
import { createMetadata } from "@/lib/metadata";
import { siteConfig, trustLinks } from "@/lib/site";

/**
 * The trust hub (plan15 Wave 10 section 14.3): one place that links to what already exists (safeguarding,
 * privacy, cookies, accessibility, complaints and both sets of terms), plus how an enquiry is handled
 * and who the company is. It makes no new claim: every description is the linked page's own
 * description, the enquiry sentences are the ones the enquiry form and the Cookie notice already say,
 * and the company details are the ones in the footer. There are no accreditations, vetting statements
 * or awards here because none has been supplied with evidence (docs/PLAN15_OWNER_INPUTS.md, item 6);
 * when they are, they belong in this page.
 */
export const metadata = createMetadata({
  title: "Trust and policies",
  description:
    "Safeguarding, privacy, accessibility, complaints and terms: the policies behind LearnThrive Tuition, in one place.",
  path: "/trust",
});

export default function TrustPage() {
  return (
    <>
      <PageHero
        eyebrow="Trust"
        title="Trust and policies"
        intro="The policies and notices that explain how LearnThrive Tuition approaches safeguarding, personal information, accessibility, complaints and the terms of tuition, together in one place."
        breadcrumb={<Breadcrumbs trail={[{ name: "Trust and policies", path: "/trust" }]} />}
      />

      <section className="section">
        <Container>
          <ul className="trust-hub">
            {trustLinks.map((link) => (
              <li key={link.href}>
                <Link className="trust-hub__card" href={link.href}>
                  <span className="trust-hub__title">{link.label}</span>
                  <span className="trust-hub__text">{link.text}</span>
                  <span className="trust-hub__go" aria-hidden="true">
                    Read <span>→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section className="section section--tint">
        <Container className="trust-hub__split">
          <div>
            <p className="eyebrow">Enquiries</p>
            <h2>How an enquiry is handled</h2>
            <p>
              The enquiry form holds your answers temporarily while the page is open, and sends them directly
              to LearnThrive by email when you submit. Your information will only be used to respond to your
              enquiry.
            </p>
            <p>
              Please avoid including sensitive personal or medical information. Our{" "}
              <Link href="/privacy">privacy notice</Link> explains what happens to the information you do
              send.
            </p>
            <div className="button-group">
              <ButtonLink href="/book">Book a free consultation</ButtonLink>
              <Link className="text-link" href="/contact">
                Contact LearnThrive <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
          <div>
            <p className="eyebrow">The company</p>
            <h2>Who we are</h2>
            <dl className="trust-hub__facts">
              <div>
                <dt>Company</dt>
                <dd>{siteConfig.legalName}</dd>
              </div>
              <div>
                <dt>Company number</dt>
                <dd>{siteConfig.companyNumber}</dd>
              </div>
              <div>
                <dt>Registered in</dt>
                <dd>{siteConfig.registeredIn}</dd>
              </div>
              <div>
                <dt>Correspondence address</dt>
                <dd>{siteConfig.correspondenceAddress}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
                </dd>
              </div>
            </dl>
          </div>
        </Container>
      </section>
    </>
  );
}
