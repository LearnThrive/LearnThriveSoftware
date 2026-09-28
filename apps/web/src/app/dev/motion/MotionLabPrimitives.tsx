"use client";

import { useState, type RefObject } from "react";
import { AnimatedUnderline } from "@/components/motion/primitives/AnimatedUnderline";
import { ParallaxLayer } from "@/components/motion/primitives/ParallaxLayer";
import { PointerDepth } from "@/components/motion/primitives/PointerDepth";
import { ScrollProgressPath } from "@/components/motion/primitives/ScrollProgressPath";
import { useScene } from "@/lib/motion/scroll";

/**
 * The client half of the /dev/motion bench: one instance of each scroll/pointer primitive, with
 * stable test ids. Kept out of page.tsx so the page itself stays a Server Component.
 */
export function MotionLabPrimitives() {
  const { ref, smoothProgress } = useScene(["start end", "end start"]);
  const [presses, setPresses] = useState(0);

  return (
    <>
      <section
        ref={ref as RefObject<HTMLElement>}
        data-lab-section="parallax"
        style={{ minHeight: "150vh", paddingTop: "40vh" }}
      >
        <h2>Parallax and scroll path</h2>
        <ParallaxLayer progress={smoothProgress} from={-20} to={20}>
          <div data-testid="parallax-layer" style={{ padding: 24, background: "#e8eefc", width: 320 }}>
            Parallax layer (-20px to +20px)
          </div>
        </ParallaxLayer>
        <div style={{ height: 40 }} />
        <ParallaxLayer progress={smoothProgress} from={0} to={24} promote>
          <div data-testid="parallax-promoted" style={{ padding: 24, background: "#e6f4ec", width: 320 }}>
            Promoted layer (only while near the screen)
          </div>
        </ParallaxLayer>
        <div data-testid="scroll-path" style={{ width: 320, height: 60, color: "#075f52", marginTop: 40 }}>
          <ScrollProgressPath
            progress={smoothProgress}
            viewBox="0 0 200 40"
            d="M2 20 C 40 2, 80 38, 120 20 S 180 20, 198 20"
            range={[0.15, 0.85]}
            trackStroke="#d7e2dc"
          />
        </div>
      </section>

      <section data-lab-section="pointer-depth" style={{ padding: "80px 0" }}>
        <h2>Pointer depth</h2>
        <PointerDepth>
          <div data-testid="depth-card" style={{ padding: 32, background: "#f4efe3", width: 360 }}>
            <p>Lean toward the pointer.</p>
            <button type="button" data-testid="depth-button" onClick={() => setPresses((count) => count + 1)}>
              Press me
            </button>{" "}
            <span data-testid="depth-presses">{presses}</span>
          </div>
        </PointerDepth>
      </section>

      <section data-lab-section="underline" style={{ padding: "80px 0 240px" }}>
        <h2>Underline</h2>
        <p>
          <AnimatedUnderline>
            <a href="#underline" data-testid="underline-hover">
              Hover or focus me
            </a>
          </AnimatedUnderline>
        </p>
        <p>
          <AnimatedUnderline active>
            <span data-testid="underline-active">The current item</span>
          </AnimatedUnderline>
        </p>
        <div style={{ height: "80vh" }} />
        <h3>
          <AnimatedUnderline drawOnView>
            <span data-testid="underline-view">Drawn when it scrolls into view</span>
          </AnimatedUnderline>
        </h3>
      </section>
    </>
  );
}
