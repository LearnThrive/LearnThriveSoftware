import type { Metadata } from "next";
import { ButtonLink } from "@/components/ButtonLink";
import { Container } from "@/components/Container";
import { CtaSection } from "@/components/CtaSection";
import { PageHero } from "@/components/PageHero";
import { PhoneContacts } from "@/components/PhoneContacts";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = createMetadata({
  title: "Contact",
  description:
    "Contact LearnThrive Tuition by email or phone, or begin a free consultation enquiry for personalised online tuition.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact LearnThrive"
        title="Start with a straightforward conversation"
        intro="Whether you know the subject support you need or are still working it out, contact LearnThrive using the published details below."
        aside={
          <div className="tagline-card tagline-card--compact">
            <span>LearnThrive Tuition</span>
            <strong>Learn. Grow. Thrive.</strong>
          </div>
        }
      />

      <section className="section contact-section">
        <Container>
          <div className="contact-cards">
            <article className="contact-card">
              <span className="contact-card__label">Email</span>
              <h2>Write to LearnThrive</h2>
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
              <p>
                Useful for sharing the student’s year group, subject and a brief
                outline of the support required.
              </p>
            </article>
            <article className="contact-card contact-card--green">
              <span className="contact-card__label">Phone</span>
              <h2>Call LearnThrive</h2>
              <PhoneContacts layout="stacked" />
              <p>Use either published number to discuss an initial enquiry directly.</p>
            </article>
          </div>

          <div className="contact-guidance">
            <div>
              <p className="eyebrow">Helpful information</p>
              <h2>What to include in an enquiry</h2>
            </div>
            <ul className="check-list">
              <li>The student’s current year group</li>
              <li>The subject or subjects they need help with</li>
              <li>Any current challenges or near-term goals</li>
              <li>Your preferred way to be contacted</li>
            </ul>
            <ButtonLink href="/book">Prepare a consultation enquiry</ButtonLink>
          </div>
        </Container>
      </section>

      <CtaSection
        title="Prefer a guided enquiry?"
        text="Use the consultation form to gather the key details in one place and prepare an email to LearnThrive."
      />
    </>
  );
}
