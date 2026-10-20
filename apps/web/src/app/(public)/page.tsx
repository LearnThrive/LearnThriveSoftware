import type { Metadata } from "next";
import { ViewTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { BodyClass } from "@/components/BodyClass";
import { MaskedText } from "@/components/motion/primitives/MaskedText";
import { imageBlur } from "@/lib/imageBlur.generated";
import { imageFocus } from "@/lib/imageFocus";
import { ScrubStatement } from "@/components/motion/primitives/ScrubStatement";
import { PointerDepth } from "@/components/motion/primitives/PointerDepth";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { SceneShell } from "@/components/motion/primitives/SceneShell";
import { CinematicBackdrop } from "@/components/motion/primitives/CinematicBackdrop";
import { SectionHandoff } from "@/components/motion/primitives/SectionHandoff";
import { Marquee } from "@/components/Marquee";
import { StatCounter } from "@/components/StatCounter";
import { EnquiryForm } from "@/components/EnquiryForm";
import { ProductTabs } from "@/components/ProductTabs";
import { HeroScene } from "@/components/motion/scenes/HeroScene";
import { LearningPathScene } from "@/components/motion/scenes/LearningPathScene";
import { ProductStoryScene } from "@/components/motion/scenes/ProductStoryScene";
import { SafeguardingScene } from "@/components/motion/scenes/SafeguardingScene";
import { SubjectIcon, SubjectMotif, SUBJECT_ACCENT, type SubjectKey } from "@/components/SubjectIcon";
import { openVacancies } from "@/lib/careers";
import { applicationsOpen } from "@/lib/careers-config";
import { createMetadata } from "@/lib/metadata";
import { siteConfig, testimonials } from "@/lib/site";
import styles from "./home.module.css";
import { motionStagger, staggerDelay } from "@/lib/motion/tokens";

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
  // The tutor-recruitment band shows only while applications are on and at least one real vacancy is open.
  const showCareersBand = applicationsOpen() && openVacancies().length > 0;
  return (
    <div className={styles.page}>
      <BodyClass className="is-homepage" />
      {/* ── Hero ──────────────────────────────────────── */}
      {/* plan15 Wave 5 section 9.4: the hero, the level marquee and the stats strip are one stack. On
          the full tier the hero is pinned (position: sticky, only inside this stack) while the
          marquee and the navy stats strip slide over it, and the hero copy eases up, scales to ~0.96
          and fades as they arrive. Every other tier: the three simply scroll one after another. */}
      <div className={styles.heroStack} data-hero-stack="">
      <HeroScene />
      <div className={styles.heroCover}>

      {/* ── Level Marquee ─────────────────────────────── */}
      <Marquee items={marqueeItems} direction="right" />

      {/* ── Trust / proof (plan12.md task 3: moved up from the bottom of the page — the
          narrative's second beat, right after the hero, not an afterthought at the end) ──
          Reveal variant="static" throughout, not "soft": on mobile the hero holds to its
          existing 470px height (see .heroGrid's mobile override above), so this block now
          sits inside the initial viewport on a typical phone — exactly the "reveal hides an
          LCP candidate" defect docs/MOTION_PERFORMANCE_AUDIT.md's M-05 addendum documents.
          It's also a natural fit here regardless: content this close to the hero reads as part
          of the first-arrival moment, not a scroll-triggered reveal. */}
      <SceneShell tone="navy" intensity="quiet">
        <div className={styles.statsStrip}>
          <Reveal variant="static">
            <div className={`${styles.stat} ${styles.statFirst}`}>
              <StatCounter target={40} suffix="+" className={styles.statValue} />
              <span className={styles.statLabel}>students supported</span>
            </div>
          </Reveal>
          <Reveal variant="static">
            <div className={`${styles.stat} ${styles.statOther}`}>
              <b className={styles.statValue}>1</b>
              <span className={styles.statLabel}>full academic year</span>
            </div>
          </Reveal>
          <Reveal variant="static">
            <div className={`${styles.stat} ${styles.statOther}`}>
              <b className={styles.statValue}>Y1&ndash;A2</b>
              <span className={styles.statLabel}>every stage covered</span>
            </div>
          </Reveal>
          <Reveal variant="static">
            <div className={`${styles.stat} ${styles.statOther}`}>
              <b className={`${styles.statValue} ${styles.statValueGreen}`}>1:1</b>
              <span className={styles.statLabel}>always, never groups</span>
            </div>
          </Reveal>
        </div>
      </SceneShell>
      </div>
      </div>

      <SectionHandoff from="navy" to="cream" />

      {/* ── Why Us ────────────────────────────────────── */}
      <section id="why" className={styles.whySection}>
        {/* plan15 Wave 6: read into focus. The words shift from muted to strong as the statement
            scrolls through the viewport (native CSS scroll-driven animation, full/standard tier,
            no JavaScript); everywhere else this is simply the finished, full-contrast sentence. */}
        <ScrubStatement
          className={styles.homeStatement}
          text="Every child learns differently. We build the tuition around them — not the other way round."
        />
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
                  <svg viewBox="0 0 24 24" fill="none" width={22} height={22} style={{ color: "var(--fg-accent-on-inverse)" }} aria-hidden="true">
                    <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M5 19c0-3.5 3.1-6 7-6s7 2.5 7 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
                {/* rgba(8,115,99,.9) only cleared 2.09:1 against this card's navy background —
                    well under AA's 4.5:1. Matches the brighter green used elsewhere on navy
                    (home.module.css's .levelRowDark .levelYears / .statValueGreen). */}
                <span className={styles.whyCardNumber} style={{ color: "var(--fg-accent-bright)" }}>01</span>
              </div>
              <h3 className={styles.whyCardTitle}>Truly one-to-one</h3>
              <p className={styles.whyCardText}>No groups, no shared screens. The whole session belongs to your child.</p>
            </div>
          </Reveal>
          <Reveal variant="scale" delay={0.11}>
            <div className={`${styles.whyCard} ${styles.whyCardWhite}`}>
              <div className={styles.whyCardHeader}>
                <div className={`${styles.whyCardIcon} ${styles.whyCardIconWhite}`}>
                  <svg viewBox="0 0 24 24" fill="none" width={22} height={22} style={{ color: "var(--fg-accent)" }} aria-hidden="true">
                    <path d="M4 12l5 5 11-11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className={styles.whyCardNumber} style={{ color: "var(--fg-accent)" }}>02</span>
              </div>
              <h3 className={styles.whyCardTitle}>Built around your child</h3>
              <p className={styles.whyCardText}>We start from where they are now and what they feel stuck on, then plan from there.</p>
            </div>
          </Reveal>
          <Reveal variant="scale" delay={0.22}>
            <div className={`${styles.whyCard} ${styles.whyCardGreen}`}>
              <div className={styles.whyCardHeader}>
                <div className={`${styles.whyCardIcon} ${styles.whyCardIconGreen}`}>
                  <svg viewBox="0 0 24 24" fill="none" width={22} height={22} style={{ color: "var(--fg-on-inverse)" }} aria-hidden="true">
                    <path d="M4 20V10M10 20V6M16 20v-5M22 20V4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                  </svg>
                </div>
                <span className={styles.whyCardNumber} style={{ color: "var(--fg-on-inverse-soft)" }}>03</span>
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
              placeholder="blur"
              blurDataURL={imageBlur["/images/parent-child-homework.jpg"]}
              style={{ objectFit: "cover" }}
            />
          </div>
        </Reveal>
        <Reveal variant="soft" delay={0.12}>
          <p className={styles.eyebrow}>How it works</p>
          <h2 className={styles.howTitle}>Four steps, no obligation</h2>
          <LearningPathScene steps={howSteps} />
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
            <Reveal variant="scale" key={subject.slug} delay={staggerDelay(i, motionStagger.cards)}>
              <Link href={`/${subject.slug}`} className={styles.subjectCard} data-spotlight="">
                <div className={styles.subjectCardImage}>
                  <Image
                    src={subject.image}
                    alt={subject.imageAlt}
                    width={600}
                    height={260}
                    sizes="(max-width: 700px) 100vw, (max-width: 1280px) 50vw, 640px"
                    placeholder="blur"
                    blurDataURL={imageBlur[subject.image]}
                    style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: imageFocus[subject.image] }}
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
                      style={{ color: SUBJECT_ACCENT[subject.subject], background: `color-mix(in srgb, ${SUBJECT_ACCENT[subject.subject]} 8%, transparent)` }}
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
        <p className={styles.sectionSubtitle} style={{ margin: "28px 0 0", textAlign: "center" }}>
          Study material is on its way too:{" "}
          <Link href="/library" className="text-link">
            the LearnThrive Library is coming soon
          </Link>
          .
        </p>
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

      <SectionHandoff from="cream" to="navy" />

      {/* ── Inside a LearnThrive lesson (sticky story) ── */}
      <ProductStoryScene />

      <SectionHandoff from="navy" to="cream" />

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
            <Reveal variant="side" key={level.name} delay={staggerDelay(i, motionStagger.list)}>
              <div className={`${styles.levelRow} ${level.dark ? styles.levelRowDark : ""}`}>
                <div>
                  <div className={styles.levelName}>{level.name}</div>
                  <div className={styles.levelYears}>{level.years}</div>
                </div>
                <p className={styles.levelDesc}>{level.desc}</p>
                <div className={styles.levelBar}>
                  <div className={styles.levelBarFill} style={{ "--fill": `${level.fill}%` } as React.CSSProperties} />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Tutor standards / safeguarding trust ───────── */}
      <section className={styles.trustSection}>
        <Reveal variant="scale">
          <div className={styles.trustCard}>
            <div>
              <p className={styles.eyebrow}>Tutor standards</p>
              <h2 className={styles.sectionTitle}>No tutor teaches until every check is complete</h2>
              <p className={styles.trustText}>
                Every tutor must pass identity and right-to-work checks, agree
                to an Enhanced DBS check including the Children’s Barred List,
                and agree to our safeguarding agreement. No tutor teaches any
                student, or has any contact with one, until every check is
                complete.
              </p>
              <Link href="/safeguarding" className={styles.trustLink}>
                Read our full safeguarding commitment <span aria-hidden="true">&rarr;</span>
              </Link>
            </div>
            <SafeguardingScene />
          </div>
        </Reveal>
      </section>

      {/* ── Testimonials / parent stories ──────────────── */}
      <section className={styles.testimonialsSection}>
        <Reveal variant="editorial">
          <p className={styles.eyebrow}>What families say</p>
          <h2 className={styles.sectionTitle}>
            Real progress, in their words
          </h2>
        </Reveal>
        <div className={styles.testimonialsGrid}>
          {testimonials.slice(0, 3).map((testimonial, i) => {
            const featured = i === 1;
            const figure = (
              <figure
                className={`${styles.testimonialCard} ${featured ? styles.testimonialCardFeatured : styles.testimonialCardSide}`}
              >
                <blockquote className={styles.testimonialQuote}>{testimonial.quote}</blockquote>
                <figcaption className={styles.testimonialAttribution}>{testimonial.attribution}</figcaption>
              </figure>
            );
            return (
              <Reveal variant="soft" key={testimonial.attribution} delay={staggerDelay(i, motionStagger.cards)}>
                {featured ? <PointerDepth>{figure}</PointerDepth> : figure}
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ── Enquiry ───────────────────────────────────── */}
      <section id="enquire" className={styles.enquirySection}>
        {/* plan13.md task 6: sticky positioning (home.module.css's .enquiryCopy) only works when
            applied to this element itself — a transform on an *ancestor* (which Reveal's own m.div
            carries once its animate-in finishes) establishes a new containing block that breaks
            sticky on any descendant. Passing the class through Reveal's own className, rather than
            nesting another div inside it, keeps the sticky element and the transformed element the
            same element, where the two are fine together. */}
        <Reveal variant="soft" className={styles.enquiryCopy}>
          <p className={styles.eyebrow}>Get in touch today</p>
          <h2>Let&apos;s help your child thrive</h2>
          <p className={styles.enquiryCopyLead}>
            Tell us a little about your child and what they need.
            We&apos;ll reply within 24 hours &mdash; no pressure, no obligation.
          </p>
          <div className={styles.enquiryContact}>
            <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
          </div>
        </Reveal>
        <Reveal variant="soft" delay={0.12}>
          <div className={styles.enquiryFormWrapper}>
            <EnquiryForm />
          </div>
        </Reveal>
      </section>

      <SectionHandoff from="cream" to="navy" />

      {/* ── Closing CTA ───────────────────────────────────
          plan12.md task 3's narrative closer, built out in task 10: a large cinematic closing
          scene, the learning-path motif converging toward the primary action. */}
      <SceneShell tone="navy" intensity="flagship" id="closing-cta">
        <CinematicBackdrop lightChildren={<div className={styles.closingCtaGlow} aria-hidden="true" />}>
          <div className={styles.closingCtaGlow} aria-hidden="true" />
        </CinematicBackdrop>
        <div className={styles.closingCta}>
          {/* plan12.md task 5: the site's recurring "sequential stages, spatially connected"
              language, converging here — the same dot-and-line device as the homepage's How It
              Works path and the safeguarding trust path, echoed once more as the story closes.
              Static rather than scroll-linked: a closing summary, not another scene to scroll
              through. */}
          <ol className={styles.closingSpine} aria-hidden="true">
            {["Match", "Learn", "Understand", "Progress"].map((stage) => (
              <li key={stage} className={styles.closingSpineItem}>
                <span className={styles.closingSpineDot} />
                {stage}
              </li>
            ))}
          </ol>
          <span className={styles.closingSpineConverge} aria-hidden="true" />
          <p className={styles.closingCtaEyebrow}>Ready when you are</p>
          <MaskedText>
            <h2 className={styles.closingCtaTitle}>Let&apos;s find the right tutor for your child.</h2>
          </MaskedText>
          <p className={styles.sectionSubtitle} style={{ color: "var(--fg-on-inverse-soft)" }}>
            One conversation is all it takes to get started &mdash; no pressure, no obligation.
          </p>
          <div className={styles.closingCtaActions}>
            <a href="#enquire" className={styles.btnPrimary}>
              Send an enquiry &rarr;
            </a>
            <a href={`mailto:${siteConfig.email}`} className={styles.btnSecondary}>
              Email us directly
            </a>
          </div>
        </div>
      </SceneShell>

      {showCareersBand ? (
        <section className={styles.careersBand} aria-labelledby="careers-band-title">
          <p className={styles.careersBandText}>
            <strong id="careers-band-title">Tutor? Teach with LearnThrive.</strong> We are recruiting self-employed online tutors.
          </p>
          <Link href="/careers" className={styles.careersBandLink}>
            See open roles <span aria-hidden="true">&rarr;</span>
          </Link>
        </section>
      ) : null}
    </div>
  );
}
