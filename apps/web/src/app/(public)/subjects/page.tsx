import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BodyClass } from "@/components/BodyClass";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { Marquee } from "@/components/Marquee";
import { createMetadata } from "@/lib/metadata";
import styles from "./subjects.module.css";

export const metadata: Metadata = createMetadata({
  title: "Subjects We Cover",
  description:
    "Maths, English, Science and 11+ preparation — supported from Key Stage 2 through to A-Level. See what LearnThrive Tuition covers at each stage.",
  path: "/subjects",
});

const marqueeItems = [
  "MATHS",
  "ENGLISH",
  "SCIENCE",
  "11+ PREPARATION",
  "KEY STAGE 2 → A-LEVEL",
];

const jumpLinks = [
  { href: "#maths", label: "Maths" },
  { href: "#english", label: "English" },
  { href: "#science", label: "Science" },
  { href: "#eleven-plus", label: "11+ Preparation" },
];

type LevelCard = {
  name: string;
  text: string;
  dark?: boolean;
};

type SubjectSection = {
  id: string;
  title: string;
  range: string;
  description: string;
  image: string;
  imageAlt: string;
  reverse?: boolean;
  icon: "calculator" | "book" | "flask";
  levels: LevelCard[];
};

const subjects: SubjectSection[] = [
  {
    id: "maths",
    title: "Maths",
    range: "Key Stage 2 → A-Level",
    description:
      "We help students build strong mathematical understanding from an early age — turning confusion into confidence, and confidence into results.",
    image: "/images/subject-maths.jpg",
    imageAlt: "Maths equations being worked through on a whiteboard",
    icon: "calculator",
    levels: [
      { name: "Key Stage 2", text: "Strengthening number skills and problem-solving confidence through creativity and clarity." },
      { name: "Key Stage 3", text: "Making maths logical and engaging, building confidence in algebra, geometry and reasoning." },
      { name: "GCSE", text: "Simplifying complex topics, approaching every question strategically, and building lasting exam confidence." },
      { name: "A-Level", text: "Mastering calculus, statistics and mechanics, with the analytical precision needed for STEM and university.", dark: true },
    ],
  },
  {
    id: "english",
    title: "English",
    range: "Key Stage 2 → A-Level",
    description:
      "Our English tutoring develops clear, confident communicators and thoughtful readers — at every stage of the journey.",
    image: "/images/subject-english.jpg",
    imageAlt: "Student reading and taking notes on a text",
    reverse: true,
    icon: "book",
    levels: [
      { name: "Key Stage 2", text: "Building imagination, grammar and vocabulary through fun, creative writing and comprehension." },
      { name: "Key Stage 3", text: "Shifting the focus to structure, analysis and fluent expression, ready for GCSE." },
      { name: "GCSE", text: "Refining language analysis and essay writing to approach exams with clarity and confidence." },
      { name: "A-Level", text: "Exploring complex literary texts and themes, crafting sophisticated, nuanced essays for university-level study.", dark: true },
    ],
  },
  {
    id: "science",
    title: "Science",
    range: "Key Stage 2 → A-Level",
    description:
      "We bring science to life through curiosity, clarity and hands-on learning — then go deep where it counts.",
    image: "/images/subject-science.jpg",
    imageAlt: "Children carrying out a science experiment in class",
    icon: "flask",
    levels: [
      { name: "Key Stage 2", text: "Exploring the world around them and discovering how things work." },
      { name: "Key Stage 3", text: "Building understanding across biology, chemistry and physics through structured, enjoyable lessons." },
      {
        name: "GCSE",
        text: "",
        // Special GCSE card with breakdown — handled in render
      },
      { name: "A-Level", text: "Mastering advanced principles across all three sciences — the reasoning for medicine, engineering and research.", dark: true },
    ],
  },
];

const elevenPlusComponents = [
  { title: "Maths", sub: "Core number & problem-solving" },
  { title: "English", sub: "Comprehension & writing" },
  { title: "Verbal reasoning", sub: "Words & logic" },
  { title: "Non-verbal reasoning", sub: "Patterns & shapes" },
];

function SubjectSvg({ icon }: { icon: string }) {
  if (icon === "calculator") {
    return (
      <svg viewBox="0 0 24 24" fill="none" width={30} height={30} aria-hidden="true">
        <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 7h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (icon === "book") {
    return (
      <svg viewBox="0 0 24 24" fill="none" width={30} height={30} aria-hidden="true">
        <path d="M12 6c-2-1.3-4.5-1.3-7 0v12c2.5-1.3 5-1.3 7 0 2-1.3 4.5-1.3 7 0V6c-2.5-1.3-5-1.3-7 0z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 6v12" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" width={30} height={30} aria-hidden="true">
      <path d="M9 3h6M10 3v6l-5 8a2 2 0 001.7 3h10.6a2 2 0 001.7-3l-5-8V3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7.5 15h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function SubjectsPage() {
  return (
    <div className={styles.page}>
      <BodyClass className="is-subjects" />

      {/* ── Hero ──────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroDots} aria-hidden="true" />
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>What we teach</p>
          <h1 className={styles.heroTitle}>
            Subjects we{" "}
            <span className={styles.heroMark}>
              <span className={styles.heroMarkBg} aria-hidden="true" />
              <span className={styles.heroMarkText}>cover</span>
            </span>
          </h1>
          <p className={styles.heroLead}>
            Maths, English and Science from Key Stage 2 through to A-Level,
            plus dedicated 11+ preparation. Here&apos;s how the support grows
            with your child at each stage.
          </p>
          <nav aria-label="Jump to a subject">
            <ul className={styles.heroJump}>
              {jumpLinks.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className={styles.heroJumpLink}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>

      {/* ── Marquee ───────────────────────────────────── */}
      <Marquee items={marqueeItems} />

      {/* ── Early years callout ────────────────────────── */}
      <div className={styles.calloutWrap}>
        <Reveal variant="soft">
          <div className={styles.callout}>
            <svg viewBox="0 0 24 24" fill="none" width={22} height={22} style={{ color: "#075f52", flexShrink: 0, marginTop: 2 }} aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p>
              Just starting out? We also support{" "}
              <strong style={{ color: "#143152" }}>early years and Key Stage 1 (Year 1&ndash;2)</strong>.
              The stages below begin at Key Stage 2 &mdash; for younger learners,{" "}
              <Link href="/#enquire">get in touch</Link> and we&apos;ll tailor
              sessions to where your child is.
            </p>
          </div>
        </Reveal>
      </div>

      {/* ── Subject Sections ──────────────────────────── */}
      {subjects.map((subject) => (
        <section key={subject.id} id={subject.id} className={styles.subjectSection}>
          <Reveal variant="soft">
            <div className={`${styles.subjectHeader} ${subject.reverse ? styles.subjectHeaderReverse : ""}`}>
              {subject.reverse ? (
                <>
                  <div className={styles.subjectImage}>
                    <Image
                      src={subject.image}
                      alt={subject.imageAlt}
                      fill
                      sizes="(max-width: 1100px) 100vw, 40vw"
                      style={{ objectFit: "cover" }}
                    />
                  </div>
                  <div>
                    <div className={styles.subjectTitleRow}>
                      <div className={styles.subjectIcon}>
                        <SubjectSvg icon={subject.icon} />
                      </div>
                      <div>
                        <h2 className={styles.subjectTitle}>{subject.title}</h2>
                        <div className={styles.subjectRange}>{subject.range}</div>
                      </div>
                    </div>
                    <p className={styles.subjectDesc}>{subject.description}</p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <div className={styles.subjectTitleRow}>
                      <div className={styles.subjectIcon}>
                        <SubjectSvg icon={subject.icon} />
                      </div>
                      <div>
                        <h2 className={styles.subjectTitle}>{subject.title}</h2>
                        <div className={styles.subjectRange}>{subject.range}</div>
                      </div>
                    </div>
                    <p className={styles.subjectDesc}>{subject.description}</p>
                  </div>
                  <div className={styles.subjectImage}>
                    <Image
                      src={subject.image}
                      alt={subject.imageAlt}
                      fill
                      sizes="(max-width: 1100px) 100vw, 40vw"
                      style={{ objectFit: "cover" }}
                    />
                  </div>
                </>
              )}
            </div>
          </Reveal>

          <div className={styles.levelCards}>
            {subject.levels.map((level, i) => {
              const isScience = subject.id === "science";
              const isGcse = level.name === "GCSE" && isScience;

              return (
                <Reveal variant="scale" key={level.name} delay={i * 0.09}>
                  <div className={`${styles.levelCard} ${level.dark ? styles.levelCardDark : ""}`}>
                    <div className={styles.levelCardHeader}>
                      <span className={styles.levelCardNumber}>{i + 1}</span>
                      <b className={styles.levelCardName}>{level.name}</b>
                    </div>
                    {isGcse ? (
                      <div className={styles.scienceBreakdown}>
                        <p><b>Biology</b> &mdash; cells, genetics and ecosystems, understood clearly and confidently.</p>
                        <p><b>Chemistry</b> &mdash; atoms, bonding and reactions, taught through simulations and visuals.</p>
                        <p><b>Physics</b> &mdash; forces, energy and electricity, connected to real-world ideas.</p>
                      </div>
                    ) : (
                      <p className={styles.levelCardText}>{level.text}</p>
                    )}
                  </div>
                </Reveal>
              );
            })}
          </div>
        </section>
      ))}

      {/* ── 11+ Preparation ───────────────────────────── */}
      <section id="eleven-plus" className={styles.elevenPlusSection}>
        <Reveal variant="scale">
          <div className={styles.elevenPlusCard}>
            <div className={styles.elevenPlusDots} aria-hidden="true" />
            <div className={styles.elevenPlusInner}>
              <p className={styles.eyebrow}>Entrance exams</p>
              <h2 className={styles.elevenPlusTitle}>11+ Preparation</h2>
              <p className={styles.elevenPlusDesc}>
                Tailored preparation across the four areas of the 11+, building
                the confidence, accuracy, speed and exam technique that make the
                difference on the day.
              </p>
              <div className={styles.elevenPlusGrid}>
                {elevenPlusComponents.map((comp) => (
                  <div key={comp.title} className={styles.elevenPlusItem}>
                    <b>{comp.title}</b>
                    <span>{comp.sub}</span>
                  </div>
                ))}
              </div>
              <p className={styles.elevenPlusFooter}>
                Every learner is supported to reach their full potential &mdash;
                one step at a time.
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── CTA ───────────────────────────────────────── */}
      <section className={styles.ctaSection}>
        <Reveal variant="soft">
          <h2>Found the right fit for your child?</h2>
          <p>
            Tell us what they need and we&apos;ll match them with the right
            support &mdash; from first steps to final exams.
          </p>
          <Link href="/#enquire" className={styles.btnPrimary}>
            Send an enquiry &rarr;
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
