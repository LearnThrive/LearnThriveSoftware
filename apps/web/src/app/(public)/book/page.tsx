import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbData } from "@/lib/structuredData";
import { Container } from "@/components/Container";
import { EnquiryForm } from "@/components/EnquiryForm";
import { PageHero } from "@/components/PageHero";
import { PhoneContacts } from "@/components/PhoneContacts";
import { CinematicBackdrop } from "@/components/motion/primitives/CinematicBackdrop";
import { MaskedText } from "@/components/motion/primitives/MaskedText";
import { createMetadata } from "@/lib/metadata";
import { enquiryGuidanceItems, siteConfig } from "@/lib/site";

export const metadata: Metadata = createMetadata({
  title: "Book a Free Consultation",
  description:
    "Tell LearnThrive Tuition about your child’s year group, subject and support needs to begin a free consultation enquiry.",
  path: "/book",
});

export default function BookPage() {
  return (
    <>
      <JsonLd data={breadcrumbData([{ name: "Book a free consultation", path: "/book" }])} />
      <PageHero
        eyebrow="Free consultation"
        title="Tell us how we can support your child"
        intro="Share a few practical details and we'll be in touch to arrange a free consultation."
        aside={
          <div className="contact-mini-card">
            <span>Prefer to speak directly?</span>
            <PhoneContacts layout="stacked" />
            <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
          </div>
        }
      />

      <section className="section booking-section">
        <CinematicBackdrop
          lightChildren={<div className="booking-atmosphere" aria-hidden="true" />}
        >
          <div className="booking-atmosphere" aria-hidden="true" />
        </CinematicBackdrop>
        <Container className="booking-layout">
          <div className="booking-form-shell">
            <span className="booking-form-frame-corner booking-form-frame-corner--tl" aria-hidden="true" />
            <span className="booking-form-frame-corner booking-form-frame-corner--br" aria-hidden="true" />
            <div className="booking-form-heading">
              <p className="eyebrow">Consultation enquiry</p>
              <h2>
                <MaskedText>A few details to get started</MaskedText>
              </h2>
              <p>
                All fields are required except the phone number, unless phone is
                your preferred contact method.
              </p>
            </div>
            <EnquiryForm />
          </div>
          <aside className="booking-sidebar">
            <h2>What happens next?</h2>
            <ol>
              <li>
                <span>1</span>
                <div>
                  <strong>Complete the form</strong>
                  <p>Add only the information needed for an initial discussion.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>You get a confirmation email</strong>
                  <p>Your details go straight to LearnThrive, and we&apos;ll email you to confirm it arrived.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Discuss the support</strong>
                  <p>LearnThrive can then talk through needs, goals and next steps.</p>
                </div>
              </li>
            </ol>
            <div className="booking-checklist">
              <strong>Helpful to include</strong>
              <ul>
                {enquiryGuidanceItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="honesty-note">
              <strong>What happens to your details?</strong>
              <p>
                Your enquiry is sent directly to LearnThrive by email — nothing is
                stored on this website beyond what&apos;s needed to deliver that message.
              </p>
            </div>
          </aside>
        </Container>
      </section>
    </>
  );
}
