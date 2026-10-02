"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import * as m from "framer-motion/m";
import { useReducedMotion, useTransform } from "framer-motion";
import { usePinnedProgress, useScene } from "@/lib/motion/scroll";
import { useMotionCapabilities, useMotionTier } from "@/lib/motion/capabilities";
import { MagneticLink } from "@/components/motion/MagneticLink";
import { ParallaxLayer } from "@/components/motion/primitives/ParallaxLayer";
import { imageBlur } from "@/lib/imageBlur.generated";
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
  const scene = useScene(["start start", "end start"]);
  const { ref } = scene;
  const tier = useMotionTier();
  const pinned = usePinnedProgress(ref, tier === "full");
  const { webgl } = useMotionCapabilities();
  const reduceMotion = useReducedMotion();
  const active = tier === "full" && !reduceMotion;
  // On the full tier the hero is pinned while the stats strip slides over it (home.module.css), so
  // its own position no longer changes and its scroll progress has to come from the page scroll
  // through the pin range instead. Every other tier scrolls the hero away exactly as it always did.
  const smoothProgress = tier === "full" ? pinned.smoothProgress : scene.smoothProgress;

  // The handoff (plan15 section 9.4): the copy eases up, scales to ~0.96 and fades while the
  // strip arrives. It replaces the old 34px headline drift. Final state = today's state on every
  // other tier and under reduced motion (all three stay at their rest values).
  const copyY = useTransform(smoothProgress, [0, 1], active ? [0, -44] : [0, 0]);
  const copyScale = useTransform(smoothProgress, [0, 1], active ? [1, 0.96] : [1, 1]);
  const copyOpacity = useTransform(smoothProgress, [0, 0.9], active ? [1, 0.15] : [1, 1]);

  return (
    <section ref={ref as React.RefObject<HTMLElement>} className={styles.hero} data-motion-scene="hero">
      {/* Background/detail layer: plan11.md task 7 asks for ~8-20px here (it was 40px, unbounded
          relative to the plan's own layering scheme). ParallaxLayer's internal tier scaling
          replaces the old manual `active ? [0, 40] : [0, 0]` branch. */}
      <ParallaxLayer progress={smoothProgress} from={0} to={16} className={styles.heroDots} aria-hidden />
      {/* The static glow is always mounted. plan12.md task 4 originally swapped it out for the
          WebGL gradient, so the hero's whole left half jumped from flat navy to a teal wash a
          fraction of a second after load (plan15 audit F2). Now the gradient is mounted *above* the
          glow and fades itself in once its first frame is drawn (HeroWebGLAtmosphere), and nothing
          is ever unmounted. Full tier only: every other tier (reduced motion included, already
          excluded from `webgl` by capabilities.ts) just has the static glow. */}
      <div className={styles.heroGlow} aria-hidden="true" />
      {webgl ? <HeroWebGLAtmosphere /> : null}
      <div className={styles.heroGrid}>
        <m.div style={{ y: copyY, scale: copyScale, opacity: copyOpacity, transformOrigin: "left top" }}>
          <div className={styles.heroCopy}>
            <div className={styles.heroChip}>
              <span className={styles.heroChipDot} aria-hidden="true" />
              Online &middot; one-to-one &middot; Y1 to A-Level
            </div>
            {/* The headline arrives line by line: each line rises out of its own mask (plan15 Wave 5
                section 9.1). CSS keyframes that start on first paint, never a JS-gated reveal — the
                h1 is the LCP-adjacent text and must not wait for hydration. The space between the
                two lines is real, so a screen reader hears two words, not "foundations.Brighter". */}
            <h1 className={styles.heroTitle}>
              <span className={styles.heroLine}>
                <span className={styles.heroLineInner} style={{ "--i": 0 } as React.CSSProperties}>
                  Strong foundations.
                </span>
              </span>{" "}
              <span className={styles.heroLine}>
                <span className={styles.heroLineInner} style={{ "--i": 1 } as React.CSSProperties}>
                  <span className={styles.heroMark}>
                    <span className={styles.heroMarkBg} aria-hidden="true" />
                    <span className={styles.heroMarkText}>Brighter futures.</span>
                  </span>
                </span>
              </span>
            </h1>
            <p className={styles.heroLead}>
              Tailored tuition that helps your child learn, grow and thrive
              &mdash; from the early years right through to their A-Level exams.
            </p>
            <div className={styles.heroButtons}>
              {/* Leans a few px toward the pointer on the full tier (plan15 Wave 7): a plain anchor elsewhere. */}
              <MagneticLink href="#enquire" className={styles.btnPrimary}>
                Send an enquiry &rarr;
              </MagneticLink>
              <a href="#how" className={styles.btnSecondary}>
                How it works
              </a>
            </div>
            <ul className={styles.heroAssurances} aria-label="Tuition overview">
              <li>40+ students supported</li>
              <li>Through our first academic year</li>
              <li>Never in groups</li>
            </ul>
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
              placeholder="blur"
              blurDataURL={imageBlur["/images/hero-tutor-student.jpg"]}
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
