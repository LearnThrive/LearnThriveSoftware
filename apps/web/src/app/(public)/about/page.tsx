import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BodyClass } from "@/components/BodyClass";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { Marquee } from "@/components/Marquee";
import { createMetadata } from "@/lib/metadata";
import styles from "./about.module.css";

export const metadata: Metadata = createMetadata({
  title: "About Us",
  description:
    "Meet the founders of LearnThrive Tuition and the mission behind it: giving every student support that fits them, whatever their ability or background.",
  path: "/about",
});

const marqueeItems = [
  "CHILDHOOD FRIENDS",
  "TUTORING SINCE 16",
  "ONE-TO-ONE, ONLINE",
  "EVERY STUDENT UNDERSTOOD",
];

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <BodyClass className="is-about" />

      {/* ── Hero ──────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroDots} aria-hidden="true" />
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>About us</p>
          <h1 className={styles.heroTitle}>
            Built for every
            <br />
            kind of{" "}
            <span className={styles.heroMark}>
              <span className={styles.heroMarkBg} aria-hidden="true" />
              <span className={styles.heroMarkText}>learner</span>
            </span>
          </h1>
          <p className={styles.heroLead}>
            LearnThrive Tuition exists to give every student the support that
            fits them &mdash; whatever their ability or background.
          </p>
        </div>
      </section>

      {/* ── Marquee ───────────────────────────────────── */}
      <Marquee items={marqueeItems} />

      {/* ── Story ─────────────────────────────────────── */}
      <section id="story" className={styles.storySection}>
        <Reveal variant="editorial">
          <p className={`${styles.eyebrow} ${styles.eyebrowDark}`}>Our story</p>
          <h2 className={styles.storyTitle}>Why we started LearnThrive</h2>
          <p className={styles.storyText}>
            LearnThrive Tuition began with a simple belief: every student
            deserves support that fits them &mdash; whatever their starting
            point, their learning ability, or their background.
          </p>
          <p className={styles.storyText}>
            Founders &mdash; and childhood friends &mdash;{" "}
            <strong style={{ color: "#143152" }}>Abdurrahman Mustafa</strong> and{" "}
            <strong style={{ color: "#143152" }}>Tahasin Hasan</strong> set out
            to make great tuition genuinely accessible: the kind that adapts to
            how each student learns, rather than expecting every child to learn
            the same way. That belief still drives everything we do.
          </p>
        </Reveal>
      </section>

      {/* ── Founders ──────────────────────────────────── */}
      <section className={styles.foundersSection}>
        <Reveal variant="editorial">
          <p className={`${styles.eyebrow} ${styles.eyebrowDark}`}>Meet the founders</p>
          <h2 className={styles.foundersTitle}>The people behind LearnThrive</h2>
        </Reveal>
        <div className={styles.foundersGrid}>
          <Reveal variant="scale">
            <article className={styles.founderCard}>
              <div className={styles.founderCardInner}>
                <Image
                  className={styles.founderPortrait}
                  src="/images/abdurrahman-mustafa.jpg"
                  alt="Abdurrahman Mustafa, co-founder"
                  width={190}
                  height={253}
                  sizes="(max-width: 560px) 100vw, 190px"
                />
                <div>
                  <div>
                    <h3 className={styles.founderName}>Abdurrahman Mustafa</h3>
                    <div className={styles.founderRole}>Co-founder</div>
                  </div>
                  <div className={styles.founderBio}>
                    <p>
                      I&apos;m Abdurrahman Mustafa, co-founder of LearnThrive
                      Tuition. Ever since I was young, I despised the idea of
                      tutoring and dreaded attending sessions every Sunday. Then,
                      at 17, I became the very thing I&apos;d dreaded &mdash;
                      and realised that teaching and helping people who are
                      struggling to progress is one of the most beautiful things
                      in life.
                    </p>
                    <p>
                      Over the years, as I questioned what I wanted to do and
                      how I wanted to build my future, my childhood friend
                      Tahasin and I decided to start our own tutoring service. At
                      LearnThrive, you&apos;ll do more than raise your grades
                      &mdash; you&apos;ll grow, and learn to love the very
                      subject you&apos;re studying.
                    </p>
                  </div>
                </div>
              </div>
            </article>
          </Reveal>
          <Reveal variant="scale" delay={0.11}>
            <article className={styles.founderCard}>
              <div className={styles.founderCardInner}>
                <Image
                  className={`${styles.founderPortrait} ${styles.founderPortraitTahasin}`}
                  src="/images/tahasin-hasan.jpg"
                  alt="Tahasin Hasan, co-founder"
                  width={190}
                  height={253}
                  sizes="(max-width: 560px) 100vw, 190px"
                />
                <div>
                  <div>
                    <h3 className={styles.founderName}>Tahasin Hasan</h3>
                    <div className={styles.founderRole}>Co-founder</div>
                  </div>
                  <div className={styles.founderBio}>
                    <p>
                      Hi, I&apos;m Tahasin Hasan &mdash; and yes, Hasan is
                      actually my surname, not me introducing myself twice 😂. I
                      started tutoring at 16, carried it through A-levels,
                      survived university while still tutoring, and somehow ended
                      up making mock exams for students while stressing over my
                      own exams too.
                    </p>
                    <p>
                      Over the years, I realised that most students don&apos;t
                      struggle because they &quot;can&apos;t do it&quot;
                      &mdash; sometimes they just need it explained in a way
                      that actually makes sense to them. Now, as co-founder of
                      LearnThrive Tuition, I get to take everything I&apos;ve
                      learned from tutoring, studying and many questionable sleep
                      schedules, and use it to make education more personal,
                      enjoyable and effective.
                    </p>
                  </div>
                </div>
              </div>
            </article>
          </Reveal>
        </div>
      </section>

      {/* ── Mission ───────────────────────────────────── */}
      <section className={styles.missionSection}>
        <div className={styles.missionDots} aria-hidden="true" />
        <Reveal variant="soft">
          <div className={styles.missionInner}>
            <p className={styles.eyebrow}>Our mission</p>
            <h2 className={styles.missionTitle}>
              A global platform where every student is understood
            </h2>
            <p className={styles.missionText}>
              We&apos;re building a platform that matches students with tutors
              who truly understand them &mdash; tutors who shape every lesson
              around how that student learns best. Wherever a child is, and
              whatever they need, we want the right support to be within reach.
            </p>
          </div>
        </Reveal>
      </section>

      {/* ── CTA ───────────────────────────────────────── */}
      <section className={styles.ctaSection}>
        <Reveal variant="soft">
          <h2>Want to be part of it?</h2>
          <p>
            Tell us about your child and we&apos;ll help them learn, grow and
            thrive &mdash; one step at a time.
          </p>
          <Link href="/#enquire" className={styles.btnPrimary}>
            Get in touch &rarr;
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
