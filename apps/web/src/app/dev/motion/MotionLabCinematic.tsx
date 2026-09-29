"use client";

import type { RefObject } from "react";
import { CinematicBackdrop } from "@/components/motion/primitives/CinematicBackdrop";
import { MaskedText } from "@/components/motion/primitives/MaskedText";
import { ProductLayer } from "@/components/motion/primitives/ProductLayer";
import { SceneShell } from "@/components/motion/primitives/SceneShell";
import { SectionHandoff } from "@/components/motion/primitives/SectionHandoff";
import { useScene } from "@/lib/motion/scroll";

/**
 * The client half of /dev/motion's plan12.md task 2 bench: one instance of each cinematic
 * composition primitive, with stable test ids — same convention as MotionLabPrimitives.tsx.
 */
export function MotionLabCinematic() {
  const { ref, smoothProgress } = useScene(["start end", "end start"]);

  return (
    <>
      <section data-lab-section="scene-shell" style={{ padding: "40px 0" }}>
        <h2>SceneShell tones</h2>
        <div style={{ display: "grid", gap: 16 }}>
          <SceneShell tone="navy" intensity="quiet" id="lab-scene-navy">
            <p data-testid="scene-navy">navy, quiet</p>
          </SceneShell>
          <SceneShell tone="cream" intensity="quiet" id="lab-scene-cream">
            <p data-testid="scene-cream">cream, quiet</p>
          </SceneShell>
          <SceneShell tone="mint" intensity="quiet" id="lab-scene-mint">
            <p data-testid="scene-mint">mint, quiet</p>
          </SceneShell>
        </div>
      </section>

      <SceneShell tone="navy" intensity="medium">
        <section data-lab-section="cinematic-backdrop" style={{ position: "relative" }}>
          <h2>CinematicBackdrop</h2>
          <CinematicBackdrop
            lightChildren={<div data-testid="backdrop-light" style={{ position: "absolute", inset: 0, background: "#163a5f" }} />}
          >
            <div data-testid="backdrop-full" style={{ position: "absolute", inset: 0, background: "#163a5f" }} />
          </CinematicBackdrop>
          <p style={{ position: "relative" }}>Backdrop content sits behind this text.</p>
        </section>
      </SceneShell>

      <section data-lab-section="masked-text" style={{ padding: "80px 0" }}>
        <h2>MaskedText</h2>
        <MaskedText>
          <span data-testid="masked-text" style={{ fontSize: 40, fontWeight: 800 }}>
            An oversized statement
          </span>
        </MaskedText>
      </section>

      <div data-lab-section="section-handoff">
        <SectionHandoff from="cream" to="navy" />
      </div>

      <section
        ref={ref as RefObject<HTMLElement>}
        data-lab-section="product-layer"
        style={{ minHeight: "150vh", paddingTop: "60vh" }}
      >
        <h2>ProductLayer</h2>
        <ProductLayer progress={smoothProgress} from={-10} to={10}>
          <div data-testid="product-layer" style={{ width: 320, height: 180, padding: 24 }}>
            Product surface
          </div>
        </ProductLayer>
      </section>
    </>
  );
}
