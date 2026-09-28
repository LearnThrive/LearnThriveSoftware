import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { Reveal, type RevealVariant } from "@/components/motion/primitives/Reveal";

export const metadata: Metadata = {
  title: "Motion Lab | LearnThrive",
  robots: { index: false, follow: false },
};

const VARIANTS: RevealVariant[] = ["soft", "mask", "scale", "side", "editorial", "static"];

/**
 * A development-only bench for the marketing motion primitives (plan11.md task 6). Real
 * pages come and go and reword themselves; a bench with fixed, known content lets tests assert on
 * one primitive at a time — "does every reveal variant end readable", "is pointer depth inert on
 * touch" — without depending on what any page happens to say this week. Same convention as
 * /dev/classroom: a 404 in production, never indexed.
 *
 * Each block starts 110vh into a 150vh section, so it is guaranteed to be below the fold — even
 * the first, after the heading — until the test scrolls to it.
 */
export default function DevMotionPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <MotionRuntime>
      <main
        id="main-content"
        style={{ maxWidth: 720, margin: "0 auto", padding: "24px 20px 160px", fontFamily: "system-ui, sans-serif" }}
      >
        <h1>Motion lab</h1>
        <p>Development only. Scroll to bring each block into view.</p>

        {VARIANTS.map((variant) => (
          <section key={variant} data-lab-section={variant} style={{ minHeight: "150vh", paddingTop: "110vh" }}>
            <Reveal variant={variant}>
              <h2 data-testid={`reveal-${variant}`}>{variant}</h2>
              <p>Readable final content for the {variant} variant.</p>
            </Reveal>
          </section>
        ))}
      </main>
    </MotionRuntime>
  );
}
