import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbData } from "@/lib/structuredData";
import Link from "next/link";
import { BodyClass } from "@/components/BodyClass";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { PointerDepth } from "@/components/motion/primitives/PointerDepth";
import { MaskedText } from "@/components/motion/primitives/MaskedText";
import { SectionHandoff } from "@/components/motion/primitives/SectionHandoff";
import { createMetadata } from "@/lib/metadata";
import { enquiryGuidanceItems, siteConfig } from "@/lib/site";
import styles from "./contact.module.css";

export const metadata: Metadata = createMetadata({
  title: "Contact",
  description:
    "Contact LearnThrive Tuition by email or phone, or begin a free consultation enquiry for personalised online tuition.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <div className={styles.page}>
      <BodyClass className="is-contact" />
      <JsonLd data={breadcrumbData([{ name: "Contact", path: "/contact" }])} />

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

      <SectionHandoff from="navy" to="cream" />

      {/* ── Contact Cards ─────────────────────────────── */}
      <section className={styles.cardsSection}>
        <div className={styles.cardsGrid}>
          {/* Both cards are on the first screen at desktop widths and hold the page's largest text
              paint; revealing them delayed LCP to ~880 ms in the profile, so they are static. */}
          <Reveal variant="static">
            <PointerDepth>
              <article className={`${styles.card} ${styles.cardWhite}`}>
                <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13Z" stroke="currentColor" strokeWidth="1.8" />
                  <path d="m5 6 7 6 7-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
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
            </PointerDepth>
          </Reveal>
          <Reveal variant="static">
            <PointerDepth>
              <article className={`${styles.card} ${styles.cardNavy}`}>
                <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6.6 10.5c1.3 2.6 3.4 4.7 6 6l2-2a1.5 1.5 0 0 1 1.5-.4c1.1.35 2.3.55 3.5.55a1.4 1.4 0 0 1 1.4 1.4V19.5a1.4 1.4 0 0 1-1.4 1.4C10.8 20.9 3.1 13.2 3.1 4.4A1.4 1.4 0 0 1 4.5 3H8c.77 0 1.4.63 1.4 1.4 0 1.2.2 2.4.55 3.5.13.5.02 1.05-.35 1.45l-2 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
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
            </PointerDepth>
          </Reveal>
        </div>
      </section>

      {/* ── Guidance ──────────────────────────────────── */}
      <section className={styles.guidanceSection}>
        <div className={styles.guidanceInner}>
          <Reveal variant="editorial">
            <div>
              <p className={`${styles.eyebrow} ${styles.eyebrowDark}`}>
                Helpful information
              </p>
              <h2 className={styles.guidanceTitle}>
                <MaskedText>What to include in an enquiry</MaskedText>
              </h2>
            </div>
          </Reveal>
          <Reveal variant="soft" delay={0.12}>
            <ul className={styles.checkList}>
              {enquiryGuidanceItems.map((item) => (
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
          </Reveal>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────── */}
      <section className={styles.ctaSection}>
        <Reveal variant="soft">
          <h2>Prefer a guided enquiry?</h2>
          <p>
            Use the consultation form to share the key details in one place
            &mdash; we&apos;ll take it from there.
          </p>
          <Link href="/book" className={styles.btnPrimary}>
            Book a free consultation &rarr;
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
