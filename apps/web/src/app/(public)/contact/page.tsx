import type { Metadata } from "next";
import Link from "next/link";
import { BodyClass } from "@/components/BodyClass";
import { ScrollReveal } from "@/components/ScrollReveal";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";
import styles from "./contact.module.css";

export const metadata: Metadata = createMetadata({
  title: "Contact",
  description:
    "Contact LearnThrive Tuition by email or phone, or begin a free consultation enquiry for personalised online tuition.",
  path: "/contact",
});

const guidanceItems = [
  "The student’s current year group",
  "The subject or subjects they need help with",
  "Any current challenges or near-term goals",
  "Your preferred way to be contacted",
];

export default function ContactPage() {
  return (
    <div className={styles.page}>
      <BodyClass className="is-contact" />

      {/* ── Hero ──────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroDots} aria-hidden="true" />
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Contact LearnThrive</p>
          <h1 className={styles.heroTitle}>
            Start with a{" "}
            <span className={styles.heroMark}>
              <span className={styles.heroMarkBg} aria-hidden="true" />
              <span className={styles.heroMarkText}>conversation</span>
            </span>
          </h1>
          <p className={styles.heroLead}>
            Whether you know the subject support you need or are still working
            it out, get in touch using the details below.
          </p>
        </div>
      </section>

      {/* ── Contact Cards ─────────────────────────────── */}
      <section className={styles.cardsSection}>
        <div className={styles.cardsGrid}>
          <ScrollReveal>
            <article className={`${styles.card} ${styles.cardWhite}`}>
              <span className={styles.cardLabel}>Email</span>
              <h2>Write to LearnThrive</h2>
              <a
                className={styles.cardLink}
                href={`mailto:${siteConfig.email}`}
              >
                {siteConfig.email}
              </a>
              <p>
                Useful for sharing the student&apos;s year group, subject and a
                brief outline of the support required.
              </p>
            </article>
          </ScrollReveal>
          <ScrollReveal delay={110}>
            <article className={`${styles.card} ${styles.cardNavy}`}>
              <span className={styles.cardLabel}>Phone</span>
              <h2>Call LearnThrive</h2>
              <div className={styles.phoneList}>
                {siteConfig.phoneContacts.map((contact) => (
                  <div key={contact.phoneHref} className={styles.phoneItem}>
                    <span className={styles.phoneName}>{contact.name}</span>
                    <a
                      className={styles.phoneNumber}
                      href={`tel:${contact.phoneHref}`}
                    >
                      {contact.phoneDisplay}
                    </a>
                  </div>
                ))}
              </div>
              <p>
                Use either published number to discuss an initial enquiry
                directly.
              </p>
            </article>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Guidance ──────────────────────────────────── */}
      <section className={styles.guidanceSection}>
        <div className={styles.guidanceInner}>
          <ScrollReveal>
            <div>
              <p className={`${styles.eyebrow} ${styles.eyebrowDark}`}>
                Helpful information
              </p>
              <h2 className={styles.guidanceTitle}>
                What to include in an enquiry
              </h2>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={120}>
            <ul className={styles.checkList}>
              {guidanceItems.map((item) => (
                <li key={item} className={styles.checkItem}>
                  <svg
                    className={styles.checkIcon}
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 12l5 5 11-11"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
          </ScrollReveal>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────── */}
      <section className={styles.ctaSection}>
        <ScrollReveal>
          <h2>Prefer a guided enquiry?</h2>
          <p>
            Use the consultation form to share the key details in one place
            &mdash; we&apos;ll take it from there.
          </p>
          <Link href="/book" className={styles.btnPrimary}>
            Book a free consultation &rarr;
          </Link>
        </ScrollReveal>
      </section>
    </div>
  );
}
