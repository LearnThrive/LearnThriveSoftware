"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import * as m from "framer-motion/m";
import { useReducedMotion, useTransform } from "framer-motion";
import { useScene } from "@/lib/motion/scroll";
import { useMotionCapabilities, useMotionTier } from "@/lib/motion/capabilities";
import { ParallaxLayer } from "@/components/motion/primitives/ParallaxLayer";
import styles from "@/app/(public)/home.module.css";

/**
 * plan12.md task 4: the raw-WebGL interactive gradient is dynamically imported, never part of the
 * hero's own bundle — `ssr: false` because it touches `window`/canvas/WebGL, and the dynamic
 * `import()` (not a static one) is what actually keeps `heroGradient.ts`'s shader source and GL
 * code out of the critical path; a static import would still tree-shake into the same chunk as
 * everything else here regardless of any runtime tier check. Nothing is rendered while it loads —
 * the existing static `.heroGlow` (below) already covers that moment on every tier.
 */
const HeroWebGLAtmosphere = dynamic(
  () => import("./HeroWebGLAtmosphere").then((mod) => mod.HeroWebGLAtmosphere),
  { ssr: false },
);

/**
 * plan10.md section 3 ("Hero becomes the flagship experience") and its "Hero scroll behaviour":
 * as the hero scrolls past, the headline moves up slightly, supporting copy fades toward ~0.6,
 * the product composition shifts on different depth planes, and the background grid moves more
 * slowly than the foreground. The CSS lt-rise entrance sequence (home.module.css) is untouched —
 * this scene only adds scroll-linked behaviour on top of the existing "assembled, not faded in"
 * load choreography, it doesn't replace it.
 *
 * The headline/copy/CTA transforms above are skipped outright on "reduced"/"light" tiers
 * (capabilities.ts): under prefers-reduced-motion nothing here should move, and on touch/narrow
 * devices plan10.md section 32 asks for smaller-scale movement rather than the full desktop depth
 * effect — "skip it" is the simplest way to satisfy that for a first pass, rather than a second,
 * smaller set of transform ranges to maintain.
 *
 * The background/product/chip layers below (plan11.md task 7) instead use the shared
 * `ParallaxLayer` primitive, which already scales its own distance by tier internally
 * (capabilities.ts's `parallaxScale`) — that's a second, independent gating mechanism from the
 * `active` boolean above, not a conflict: `active` still governs the older headline/copy/CTA
 * transforms exactly as before, ParallaxLayer governs only the layers built on it.
 */
export function HeroScene() {
  const { ref, smoothProgress } = useScene(["start start", "end start"]);
  const tier = useMotionTier();
  const { webgl } = useMotionCapabilities();
  const reduceMotion = useReducedMotion();
  const active = tier === "full" && !reduceMotion;

  const headlineY = useTransform(smoothProgress, [0, 1], active ? [0, -34] : [0, 0]);
  const copyOpacity = useTransform(smoothProgress, [0, 1], active ? [1, 0.6] : [1, 1]);
  const ctaOpacity = useTransform(smoothProgress, [0, 0.6], active ? [1, 0.85] : [1, 1]);

  return (
    <section ref={ref as React.RefObject<HTMLElement>} className={styles.hero} data-motion-scene="hero">
      {/* Background/detail layer: plan11.md task 7 asks for ~8-20px here (it was 40px, unbounded
          relative to the plan's own layering scheme). ParallaxLayer's internal tier scaling
          replaces the old manual `active ? [0, 40] : [0, 0]` branch. */}
      <ParallaxLayer progress={smoothProgress} from={0} to={16} className={styles.heroDots} aria-hidden />
      {/* plan12.md task 4: the interactive gradient replaces the static glow only on the one tier
          it's built for — every other tier (including reduced motion, already excluded from
          `webgl` by capabilities.ts) keeps the plain static glow it always had. */}
      {webgl ? <HeroWebGLAtmosphere /> : <div className={styles.heroGlow} aria-hidden="true" />}
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
        {/* Main product layer: ~10-24px (task 7). Previously also carried a scale (1 -> 1.04) —
            dropped, not rebalanced: `.heroFloatChip`/`.heroFloatChipSecondary` below are its DOM
            children, so scaling this element scaled the floating cards' size along with it on
            every scroll frame, an unintended side effect ("stop the photo's scale compounding onto
            its child chips") no design brief asked for. A translate-only offset moves the photo and
            its cards together as one rigid group with no distortion. */}
        <ParallaxLayer progress={smoothProgress} from={0} to={18} className={styles.heroPhoto}>
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
          {/* Foreground chip layer: ~18-34px, deeper than the product layer above — nesting a second
              ParallaxLayer inside the product one composes the two offsets (total chip movement =
              product's own offset + this chip's own additional offset), the standard way to build
              layered depth.
              This inner ParallaxLayer is also the actual fix for "the chip parallax has never run":
              `.heroFloatChip`'s own `animation: lt-rise ... both` (home.module.css) targets
              `transform`, and a CSS animation's value for an animated property wins over an inline
              style on the *same element* for as long as it holds (its "both" fill mode holds
              forever) — so putting Motion's own transform directly on `.heroFloatChip` never moved
              it. Keeping the entrance animation on the outer, unanimated-by-Motion `.heroFloatChip`
              and putting the scroll transform on a nested element sidesteps the collision entirely:
              two different elements, two different transforms, both apply. */}
          <div className={styles.heroFloatChip}>
            <ParallaxLayer progress={smoothProgress} from={0} to={-26} axis="x">
              <div className={styles.heroFloatChipTitle}>One-to-one, 60 min</div>
              <div className={styles.heroFloatChipSub}>TIMED AROUND SCHOOL</div>
            </ParallaxLayer>
          </div>
          <div className={styles.heroFloatChipSecondary}>
            <ParallaxLayer progress={smoothProgress} from={0} to={-30}>
              <div className={styles.heroFloatChipTitle}>Lesson report, every time</div>
              <div className={styles.heroFloatChipSub}>PROGRESS YOU CAN SEE</div>
            </ParallaxLayer>
          </div>
        </ParallaxLayer>
      </div>
    </section>
  );
}
