import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { EnquiryForm } from "@/components/EnquiryForm";
import { PageHero } from "@/components/PageHero";
import { PhoneContacts } from "@/components/PhoneContacts";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = createMetadata({
  title: "Book a Free Consultation",
  description:
    "Tell LearnThrive Tuition about your child’s year group, subject and support needs to begin a free consultation enquiry.",
  path: "/book",
});

export default function BookPage() {
  return (
    <>
      <PageHero
        eyebrow="Free consultation"
        title="Tell us how we can support your child"
        intro="Share a few practical details and prepare an email enquiry for LearnThrive. You will review and send it from your own email app."
        aside={
          <div className="contact-mini-card">
            <span>Prefer to speak directly?</span>
            <PhoneContacts layout="stacked" />
            <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
          </div>
        }
      />

      <section className="section booking-section">
        <Container className="booking-layout">
          <div className="booking-form-shell">
            <div className="booking-form-heading">
              <p className="eyebrow">Consultation enquiry</p>
              <h2>A few details to get started</h2>
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
                  <strong>Review your email</strong>
                  <p>Your device will open a pre-addressed draft for you to send.</p>
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
            <div className="honesty-note">
              <strong>Why email?</strong>
              <p>
                This marketing site does not store or send form data. It prepares
                a draft in your email app so you can review the details before
                choosing to send them.
              </p>
            </div>
          </aside>
        </Container>
      </section>
    </>
  );
}
