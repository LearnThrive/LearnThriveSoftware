import type { Metadata } from "next";
import Link from "next/link";
import { BodyClass } from "@/components/BodyClass";
import { ScrollReveal } from "@/components/ScrollReveal";
import { FaqList } from "@/components/FaqList";
import { FaqHashOpener } from "@/components/FaqHashOpener";
import { createMetadata } from "@/lib/metadata";
import { faqSections } from "@/lib/faqs";
import styles from "./faq.module.css";

export const metadata: Metadata = createMetadata({
  title: "Frequently Asked Questions",
  description:
    "Answers about LearnThrive Tuition, online lessons, subjects, privacy, bookings, cancellations and safeguarding.",
  path: "/faq",
});

export default function FaqPage() {
  return (
    <div className={styles.page}>
      <BodyClass className="is-faq" />
      <FaqHashOpener />

      {/* ── Hero ──────────────────────────────────────── */}
      <section className={styles.hero} id="faq-top">
        <div className={styles.heroDots} aria-hidden="true" />
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Frequently asked questions</p>
          <h1 className={styles.heroTitle}>
            Clear answers before you{" "}
            <span className={styles.heroMark}>
              <span className={styles.heroMarkBg} aria-hidden="true" />
              <span className={styles.heroMarkText}>get started</span>
            </span>
          </h1>
          <p className={styles.heroLead}>
            Find practical information about LearnThrive&apos;s online tuition,
            subjects, enquiries, privacy, bookings and safeguarding.
          </p>
          <nav className={styles.jumpNav} aria-label="FAQ categories">
            <span className={styles.jumpLabel}>Jump to a topic</span>
            {faqSections.map((section) => (
              <Link
                href={`#${section.id}`}
                key={section.id}
                className={styles.jumpPill}
              >
                {section.title}
                <span className={styles.jumpCount}>{section.items.length}</span>
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {/* ── Category cards ───────────────────────────── */}
      <div className={styles.faqSections}>
        {faqSections.map((section, i) => (
          <ScrollReveal key={section.id} delay={(i % 2) * 80}>
            <section
              className={styles.category}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
            >
              <div className={styles.categoryHeading}>
                <span className={styles.categoryNum} aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2
                    id={`${section.id}-title`}
                    className={styles.categoryTitle}
                  >
                    {section.title}
                  </h2>
                  <p className={styles.categoryIntro}>{section.intro}</p>
                </div>
              </div>
              <div className={styles.faqWrapper}>
                <FaqList items={section.items} />
              </div>
            </section>
          </ScrollReveal>
        ))}
      </div>

      <Link href="#faq-top" className={styles.toTop}>
        Back to topics &uarr;
      </Link>

      {/* ── CTA ───────────────────────────────────────── */}
      <section className={styles.ctaSection}>
        <ScrollReveal>
          <h2>Still have a question?</h2>
          <p>
            Contact LearnThrive directly or share a few practical details in a
            free consultation enquiry.
          </p>
          <Link href="/book" className={styles.btnPrimary}>
            Book a free consultation &rarr;
          </Link>
          <Link href="/contact" className={styles.ctaAlt}>
            Or contact us another way
          </Link>
        </ScrollReveal>
      </section>
    </div>
  );
}
