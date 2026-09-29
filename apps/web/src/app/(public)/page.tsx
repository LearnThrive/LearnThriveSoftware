import type { Metadata } from "next";
import { ViewTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { BodyClass } from "@/components/BodyClass";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { Marquee } from "@/components/Marquee";
import { StatCounter } from "@/components/StatCounter";
import { EnquiryForm } from "@/components/EnquiryForm";
import { ProductTabs } from "@/components/ProductTabs";
import { HeroScene } from "@/components/motion/scenes/HeroScene";
import { LearningPathScene } from "@/components/motion/scenes/LearningPathScene";
import { ProductStoryScene } from "@/components/motion/scenes/ProductStoryScene";
import { SafeguardingScene } from "@/components/motion/scenes/SafeguardingScene";
import { SubjectIcon, SubjectMotif, SUBJECT_ACCENT, type SubjectKey } from "@/components/SubjectIcon";
import { createMetadata } from "@/lib/metadata";
import { siteConfig, testimonials } from "@/lib/site";
import styles from "./home.module.css";

export const metadata: Metadata = createMetadata({
  title: "Strong foundations. Brighter futures.",
  description:
    "One-to-one online tuition from Year 1 to A-Level. Tailored tuition that helps your child learn, grow and thrive.",
  path: "/",
});

const marqueeItems = [
  "PRIMARY · YEAR 1–6",
  "KEY STAGE 3 · YEAR 7–9",
  "GCSE",
  "A-LEVEL",
  "11+ PREPARATION",
  "SATS",
];

const howSteps = [
  { title: "You get in touch", text: "Their year, the subject, and what they’re working towards.", last: false },
  { title: "We match the support", text: "A plan built for their level and their goals.", last: false },
  { title: "Sessions begin", text: "Online, one-to-one, timed around school.", last: false },
  { title: "You see progress", text: "In confidence first, then in results.", last: true },
];

const subjectCards: {
  title: string;
  subject: SubjectKey;
  slug: string;
  description: string;
  image: string;
  imageAlt: string;
  range: string;
}[] = [
  {
    title: "Maths",
    subject: "maths",
    slug: "maths-tuition",
    description: "From number confidence at KS2 to calculus, statistics and mechanics at A-Level.",
    image: "/images/subject-maths.jpg",
    imageAlt: "Maths equations being worked through on a whiteboard",
    range: "KS2 – A-LEVEL",
  },
  {
    title: "English",
    subject: "english",
    slug: "english-tuition",
    description: "Reading, writing and analysis that build clear, confident communicators.",
    image: "/images/subject-english.jpg",
    imageAlt: "Student reading and taking notes on a text",
    range: "KS2 – A-LEVEL",
  },
  {
    title: "Science",
    subject: "science",
    slug: "science-tuition",
    description: "Biology, chemistry and physics — curious, hands-on and clearly explained.",
    image: "/images/subject-science.jpg",
    imageAlt: "Children carrying out a science experiment in class",
    range: "KS2 – A-LEVEL",
  },
  {
    title: "11+ Preparation",
    subject: "eleven-plus",
    slug: "11-plus-tuition",
    description: "Maths, English and reasoning, with the exam technique that counts.",
    image: "/images/subject-elevenplus.jpg",
    imageAlt: "Student making notes while preparing for an exam",
    range: "ENTRANCE EXAMS",
  },
];

const levels = [
  { name: "Primary", years: "YEAR 1–6", desc: "Reading, writing and maths foundations — plus 11+ and SATs preparation.", fill: 25 },
  { name: "Key Stage 3", years: "YEAR 7–9", desc: "Settling into secondary school and staying on track across core subjects.", fill: 50 },
  { name: "GCSE", years: "YEAR 10–11", desc: "Structured revision and exam technique to lift grades where it counts.", fill: 75 },
  { name: "A-Level", years: "YEAR 12–13", desc: "Deeper subject mastery and confident preparation for university.", fill: 100, dark: true },
];

export default function HomePage() {
  return (
    <div className={styles.page}>
      <BodyClass className="is-homepage" />
      {/* ── Hero ──────────────────────────────────────── */}
      <HeroScene />

      {/* ── Level Marquee ─────────────────────────────── */}
      <Marquee items={marqueeItems} />

      {/* ── Why Us ────────────────────────────────────── */}
      <section id="why" className={styles.whySection}>
        <Reveal variant="editorial">
          <p className={styles.eyebrow}>Why families choose us</p>
          <h2 className={styles.sectionTitle}>Three things we won&apos;t compromise on</h2>
          <p className={styles.sectionSubtitle}>Every session, every student.</p>
        </Reveal>
        <div className={styles.whyGrid}>
          <Reveal variant="scale">
            <div className={`${styles.whyCard} ${styles.whyCardNavy}`}>
              <div className={styles.whyCardHeader}>
                <div className={`${styles.whyCardIcon} ${styles.whyCardIconNavy}`}>
                  <svg viewBox="0 0 24 24" fill="none" width={22} height={22} style={{ color: "#087363" }}>
                    <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M5 19c0-3.5 3.1-6 7-6s7 2.5 7 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
                {/* rgba(8,115,99,.9) only cleared 2.09:1 against this card's navy background —
                    well under AA's 4.5:1. Matches the brighter green used elsewhere on navy
                    (home.module.css's .levelRowDark .levelYears / .statValueGreen). */}
                <span className={styles.whyCardNumber} style={{ color: "#13c2a0" }}>01</span>
              </div>
              <h3 className={styles.whyCardTitle}>Truly one-to-one</h3>
              <p className={styles.whyCardText}>No groups, no shared screens. The whole session belongs to your child.</p>
            </div>
          </Reveal>
          <Reveal variant="scale" delay={0.11}>
            <div className={`${styles.whyCard} ${styles.whyCardWhite}`}>
              <div className={styles.whyCardHeader}>
                <div className={`${styles.whyCardIcon} ${styles.whyCardIconWhite}`}>
                  <svg viewBox="0 0 24 24" fill="none" width={22} height={22} style={{ color: "#075f52" }}>
                    <path d="M4 12l5 5 11-11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className={styles.whyCardNumber} style={{ color: "#075f52" }}>02</span>
              </div>
              <h3 className={styles.whyCardTitle}>Built around your child</h3>
              <p className={styles.whyCardText}>We start from where they are now and what they feel stuck on, then plan from there.</p>
            </div>
          </Reveal>
          <Reveal variant="scale" delay={0.22}>
            <div className={`${styles.whyCard} ${styles.whyCardGreen}`}>
              <div className={styles.whyCardHeader}>
                <div className={`${styles.whyCardIcon} ${styles.whyCardIconGreen}`}>
                  <svg viewBox="0 0 24 24" fill="none" width={22} height={22} style={{ color: "#fff" }}>
                    <path d="M4 20V10M10 20V6M16 20v-5M22 20V4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                  </svg>
                </div>
                <span className={styles.whyCardNumber} style={{ color: "rgba(255,255,255,.85)" }}>03</span>
              </div>
              <h3 className={styles.whyCardTitle}>Progress you can see</h3>
              <p className={styles.whyCardText}>Confidence first, then the results that follow it.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── How It Works ──────────────────────────────── */}
      <section id="how" className={styles.howSection}>
        <Reveal variant="side">
          <div className={styles.howImage}>
            <Image
              src="/images/parent-child-homework.jpg"
              alt="Parent and child going through homework together at the kitchen table"
              fill
              sizes="(max-width: 1100px) 100vw, 40vw"
              style={{ objectFit: "cover" }}
            />
          </div>
        </Reveal>
        <Reveal variant="soft" delay={0.12}>
          <p className={styles.eyebrow}>How it works</p>
          <h2 className={styles.howTitle}>Four steps, no obligation</h2>
          <LearningPathScene>
            <div className={styles.howSteps}>
              {howSteps.map((step, i) => (
                <div key={step.title} className={styles.howStep}>
                  <span className={`${styles.howStepNumber} ${step.last ? styles.howStepNumberNavy : styles.howStepNumberGreen}`}>
                    {i + 1}
                  </span>
                  <div className={styles.howStepContent}>
                    <h4 className={styles.howStepTitle}>{step.title}</h4>
                    <p className={styles.howStepText}>{step.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </LearningPathScene>
        </Reveal>
      </section>

      {/* ── Subjects ──────────────────────────────────── */}
      <section id="subjects" className={styles.subjectsSection}>
        <Reveal variant="mask">
          <div className={styles.subjectsSectionHeader}>
            <h2>Four subjects, every stage</h2>
            <span className={styles.subjectsSectionRange}>KS2 &rarr; A-LEVEL</span>
          </div>
        </Reveal>
        <div className={styles.subjectsGrid}>
          {subjectCards.map((subject, i) => (
            <Reveal variant="scale" key={subject.slug} delay={i * 0.09}>
              <Link href={`/${subject.slug}`} className={styles.subjectCard}>
                <div className={styles.subjectCardImage}>
                  <Image
                    src={subject.image}
                    alt={subject.imageAlt}
                    width={600}
                    height={300}
                    sizes="(max-width: 1100px) 100vw, 50vw"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                  <div className={styles.subjectCardMotif}>
                    <SubjectMotif subject={subject.subject} />
                  </div>
                </div>
                <div className={styles.subjectCardBody}>
                  {/* plan11.md task 14's prototype subject-card -> subject-page transition: the
                      icon badge is the one element with a real counterpart on the destination
                      page (SubjectLandingPage.tsx's .subject-landing-hero-card__icon) — the card's
                      own photo has no equivalent there (that page's hero uses an icon, not a
                      photo), so naming the photo would never form a pair. Matched by slug (the
                      same "maths-tuition" string both sides derive their name from) so the browser
                      morphs this one badge across the navigation; everything else does its normal
                      enter animation. No extra props needed — the guide's own Step 1 is explicit
                      that the morph works without any. */}
                  <ViewTransition name={`subject-icon-${subject.slug}`}>
                    <div
                      className={styles.subjectCardIcon}
                      style={{ color: SUBJECT_ACCENT[subject.subject], background: `${SUBJECT_ACCENT[subject.subject]}14` }}
                    >
                      <SubjectIcon subject={subject.subject} />
                    </div>
                  </ViewTransition>
                  <h3>{subject.title}</h3>
                  <p>{subject.description}</p>
                  <span className={styles.subjectCardLink}>{subject.range} <span className={styles.subjectCardArrow} aria-hidden="true">&rarr;</span></span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Product demonstration ────────────────────── */}
      <section id="platform" className={styles.productSection}>
        <Reveal variant="editorial">
          <div className={styles.productSectionHeader}>
            <p className={styles.eyebrow}>See it in action</p>
            <h2 className={styles.sectionTitle} style={{ marginInline: "auto" }}>
              One platform, built around every lesson
            </h2>
            <p className={styles.sectionSubtitle}>
              A live lesson, a report your family can see, progress that carries through to the next one.
            </p>
          </div>
        </Reveal>
        <Reveal variant="soft" delay={0.1}>
          <ProductTabs />
        </Reveal>
      </section>

      {/* ── Inside a LearnThrive lesson (sticky story) ── */}
      <ProductStoryScene />

      {/* ── Levels ────────────────────────────────────── */}
      <section id="levels" className={styles.levelsSection}>
        <Reveal variant="editorial">
          <p className={styles.eyebrow}>Levels we cover</p>
          <h2 className={styles.sectionTitle} style={{ marginBottom: 28 }}>
            From first steps to final exams
          </h2>
        </Reveal>
        <div className={styles.levelsGrid}>
          {levels.map((level, i) => (
            <Reveal variant="side" key={level.name} delay={i * 0.08}>
              <div className={`${styles.levelRow} ${level.dark ? styles.levelRowDark : ""}`}>
                <div>
                  <div className={styles.levelName}>{level.name}</div>
                  <div className={styles.levelYears}>{level.years}</div>
                </div>
                <p className={styles.levelDesc}>{level.desc}</p>
                <div className={styles.levelBar}>
                  <div className={styles.levelBarFill} style={{ width: `${level.fill}%` }} />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Stats ─────────────────────────────────────── */}
      <div className={styles.statsStrip}>
        <Reveal variant="soft">
          <div className={`${styles.stat} ${styles.statFirst}`}>
            <StatCounter target={40} suffix="+" className={styles.statValue} />
            <span className={styles.statLabel}>students supported</span>
          </div>
        </Reveal>
        <Reveal variant="soft" delay={0.08}>
          <div className={`${styles.stat} ${styles.statOther}`}>
            <b className={styles.statValue}>1</b>
            <span className={styles.statLabel}>full academic year</span>
          </div>
        </Reveal>
        <Reveal variant="soft" delay={0.16}>
          <div className={`${styles.stat} ${styles.statOther}`}>
            <b className={styles.statValue}>Y1&ndash;A2</b>
            <span className={styles.statLabel}>every stage covered</span>
          </div>
        </Reveal>
        <Reveal variant="soft" delay={0.24}>
          <div className={`${styles.stat} ${styles.statOther}`}>
            <b className={`${styles.statValue} ${styles.statValueGreen}`}>1:1</b>
            <span className={styles.statLabel}>always, never groups</span>
          </div>
        </Reveal>
      </div>

      {/* ── Tutor standards ───────────────────────────── */}
      <section className={styles.trustSection}>
        <Reveal variant="scale">
          <div className={styles.trustCard}>
            <div>
              <p className={styles.eyebrow}>Tutor standards</p>
              <h2 className={styles.sectionTitle}>Every tutor is DBS-checked</h2>
              <p className={styles.trustText}>
                Every tutor goes through a thorough hiring process before
                teaching a LearnThrive student, including a Disclosure and
                Barring Service (DBS) check. No tutor begins teaching until
                this process is complete.
              </p>
              <Link href="/safeguarding" className={styles.trustLink}>
                Read our full safeguarding commitment <span aria-hidden="true">&rarr;</span>
              </Link>
            </div>
            <SafeguardingScene />
          </div>
        </Reveal>
      </section>

      {/* ── Testimonials ──────────────────────────────── */}
      <section className={styles.testimonialsSection}>
        <Reveal variant="editorial">
          <p className={styles.eyebrow}>What families say</p>
          <h2 className={styles.sectionTitle} style={{ marginBottom: 28 }}>
            Real progress, in their words
          </h2>
        </Reveal>
        <div className={styles.testimonialsGrid}>
          {testimonials.slice(0, 3).map((testimonial, i) => (
            <Reveal variant="soft" key={testimonial.attribution} delay={i * 0.09}>
              <figure className={styles.testimonialCard}>
                <blockquote className={styles.testimonialQuote}>{testimonial.quote}</blockquote>
                <figcaption className={styles.testimonialAttribution}>{testimonial.attribution}</figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Enquiry ───────────────────────────────────── */}
      <section id="enquire" className={styles.enquirySection}>
        <Reveal variant="soft">
          <div className={styles.enquiryCopy}>
            <p className={styles.eyebrow}>Get in touch today</p>
            <h2>Let&apos;s help your child thrive</h2>
            <p className={styles.enquiryCopyLead}>
              Tell us a little about your child and what they need.
              We&apos;ll reply within 24 hours &mdash; no pressure, no obligation.
            </p>
            <div className={styles.enquiryContact}>
              <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
            </div>
          </div>
        </Reveal>
        <Reveal variant="soft" delay={0.12}>
          <div className={styles.enquiryFormWrapper}>
            <EnquiryForm />
          </div>
        </Reveal>
      </section>
    </div>
  );
}
