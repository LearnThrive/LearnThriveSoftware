"use client";

import Image from "next/image";
import * as m from "framer-motion/m";
import { LazyMotion, domAnimation, useReducedMotion, useTransform } from "framer-motion";
import { useScene } from "@/lib/motion/scroll";
import { useMotionTier } from "@/lib/motion/capabilities";
import styles from "@/app/(public)/home.module.css";

/**
 * plan10.md section 3 ("Hero becomes the flagship experience") and its "Hero scroll behaviour":
 * as the hero scrolls past, the headline moves up slightly, supporting copy fades toward ~0.6,
 * the product composition shifts on different depth planes, and the background grid moves more
 * slowly than the foreground. The CSS lt-rise entrance sequence (home.module.css) is untouched —
 * this scene only adds scroll-linked behaviour on top of the existing "assembled, not faded in"
 * load choreography, it doesn't replace it.
 *
 * All scroll-linked transforms are skipped outright on "reduced"/"light" tiers (capabilities.ts):
 * under prefers-reduced-motion nothing here should move, and on touch/narrow devices plan10.md
 * section 32 asks for smaller-scale movement rather than the full desktop depth effect — "skip
 * it" is the simplest way to satisfy that for a first pass, rather than a second, smaller set of
 * transform ranges to maintain.
 */
export function HeroScene() {
  const { ref, smoothProgress } = useScene(["start start", "end start"]);
  const tier = useMotionTier();
  const reduceMotion = useReducedMotion();
  const active = tier === "full" && !reduceMotion;

  const headlineY = useTransform(smoothProgress, [0, 1], active ? [0, -34] : [0, 0]);
  const copyOpacity = useTransform(smoothProgress, [0, 1], active ? [1, 0.6] : [1, 1]);
  const ctaOpacity = useTransform(smoothProgress, [0, 0.6], active ? [1, 0.85] : [1, 1]);
  const productScale = useTransform(smoothProgress, [0, 1], active ? [1, 1.04] : [1, 1]);
  const productY = useTransform(smoothProgress, [0, 1], active ? [0, 18] : [0, 0]);
  const chipPrimaryX = useTransform(smoothProgress, [0, 1], active ? [0, -14] : [0, 0]);
  const chipSecondaryY = useTransform(smoothProgress, [0, 1], active ? [0, -22] : [0, 0]);
  const gridY = useTransform(smoothProgress, [0, 1], active ? [0, 40] : [0, 0]);

  return (
    <LazyMotion features={domAnimation}>
      <section ref={ref as React.RefObject<HTMLElement>} className={styles.hero} data-motion-scene="hero">
        <m.div className={styles.heroDots} style={{ y: gridY }} aria-hidden="true" />
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroGrid}>
          <m.div style={{ y: headlineY }}>
            <div className={styles.heroCopy}>
              <div className={styles.heroChip}>
                <span className={styles.heroChipDot} aria-hidden="true" />
                Online &middot; one-to-one &middot; Y1 to A-Level
              </div>
              <h1 className={styles.heroTitle}>
                Strong foundations.
                <br />
                <span className={styles.heroMark}>
                  <span className={styles.heroMarkBg} aria-hidden="true" />
                  <span className={styles.heroMarkText}>Brighter futures.</span>
                </span>
              </h1>
              <m.p className={styles.heroLead} style={{ opacity: copyOpacity }}>
                Tailored tuition that helps your child learn, grow and thrive
                &mdash; from the early years right through to their A-Level exams.
              </m.p>
              <m.div className={styles.heroButtons} style={{ opacity: ctaOpacity }}>
                <a href="#enquire" className={styles.btnPrimary}>
                  Send an enquiry &rarr;
                </a>
                <a href="#how" className={styles.btnSecondary}>
                  How it works
                </a>
              </m.div>
              <m.ul
                className={styles.heroAssurances}
                aria-label="Tuition overview"
                style={{ opacity: copyOpacity }}
              >
                <li>40+ students supported</li>
                <li>Through our first academic year</li>
                <li>Never in groups</li>
              </m.ul>
            </div>
          </m.div>
          <m.div className={styles.heroPhoto} style={{ scale: productScale, y: productY }}>
            <div className={styles.heroPhotoImg}>
              <Image
                src="/images/hero-tutor-student.jpg"
                alt="Tutor and student working together during an online one-to-one lesson"
                fill
                sizes="(max-width: 1100px) 100vw, 50vw"
                priority
                style={{ objectFit: "cover" }}
              />
            </div>
            <m.div className={styles.heroFloatChip} style={{ x: chipPrimaryX }}>
              <div className={styles.heroFloatChipTitle}>One-to-one, 60 min</div>
              <div className={styles.heroFloatChipSub}>TIMED AROUND SCHOOL</div>
            </m.div>
            <m.div className={styles.heroFloatChipSecondary} style={{ y: chipSecondaryY }}>
              <div className={styles.heroFloatChipTitle}>Lesson report, every time</div>
              <div className={styles.heroFloatChipSub}>PROGRESS YOU CAN SEE</div>
            </m.div>
          </m.div>
        </div>
      </section>
    </LazyMotion>
  );
}
