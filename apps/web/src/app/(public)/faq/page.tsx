import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/Container";
import { CtaSection } from "@/components/CtaSection";
import { FaqList } from "@/components/FaqList";
import { PageHero } from "@/components/PageHero";
import { createMetadata } from "@/lib/metadata";
import { faqSections } from "@/lib/faqs";

export const metadata: Metadata = createMetadata({
  title: "Frequently Asked Questions",
  description:
    "Answers about LearnThrive Tuition, online lessons, subjects, privacy, bookings, cancellations and safeguarding.",
  path: "/faq",
});

export default function FaqPage() {
  return (
    <>
      <PageHero
        eyebrow="Frequently asked questions"
        title="Clear answers before you get started"
        intro="Find practical information about LearnThrive’s online tuition, subjects, enquiries, privacy, bookings and safeguarding."
        aside={
          <nav className="faq-jump" aria-label="FAQ categories">
            <span>Jump to a topic</span>
            {faqSections.map((section) => (
              <Link href={`#${section.id}`} key={section.id}>
                {section.title}
                <span aria-hidden="true">↓</span>
              </Link>
            ))}
          </nav>
        }
      />

      <section className="section faq-page-section">
        <Container className="faq-page-layout">
          {faqSections.map((section) => (
            <section
              className="faq-category"
              id={section.id}
              key={section.id}
              aria-labelledby={`${section.id}-title`}
            >
              <div className="faq-category__heading">
                <h2 id={`${section.id}-title`}>{section.title}</h2>
                <p>{section.intro}</p>
              </div>
              <FaqList items={section.items} />
            </section>
          ))}
        </Container>
      </section>

      <CtaSection
        title="Still have a question?"
        text="Contact LearnThrive directly or share a few practical details in a free consultation enquiry."
      />
    </>
  );
}
