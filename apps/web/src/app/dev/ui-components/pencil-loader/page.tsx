import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { PencilLoader, ThinkingIndicator } from "@/components/ui/PencilLoader";

export const metadata: Metadata = {
  title: "PencilLoader | LearnThrive",
  robots: { index: false, follow: false },
};

/**
 * Development-only bench for PencilLoader (plan19.md section 7). 404 in production, never indexed.
 * Each block has a stable `data-case` so tests can address one state at a time.
 */
export default function DevPencilLoaderPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <MotionRuntime>
      <main id="main-content" style={{ maxWidth: 720, margin: "0 auto", padding: "24px 20px 80px", fontFamily: "system-ui, sans-serif" }}>
        <h1>PencilLoader</h1>
        <p>Development only. Every state of the loading and thinking indicator.</p>

        <section data-case="default" aria-labelledby="case-default">
          <h2 id="case-default">Default</h2>
          <PencilLoader />
        </section>

        <section data-case="sizes" aria-labelledby="case-sizes">
          <h2 id="case-sizes">Sizes</h2>
          <div style={{ display: "flex", gap: "2rem", alignItems: "center", flexWrap: "wrap" }}>
            <PencilLoader size="sm" label="Loading small" />
            <PencilLoader size="md" label="Loading medium" />
            <PencilLoader size="lg" label="Loading large" />
          </div>
        </section>

        <section data-case="label" aria-labelledby="case-label">
          <h2 id="case-label">With a label</h2>
          <PencilLoader label="Loading your library" />
        </section>

        <section data-case="thinking" aria-labelledby="case-thinking">
          <h2 id="case-thinking">Thinking</h2>
          <ThinkingIndicator />
        </section>

        <section data-case="many" aria-labelledby="case-many">
          <h2 id="case-many">Three on one page</h2>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            <PencilLoader size="sm" label="Loading one" />
            <PencilLoader size="sm" label="Loading two" />
            <ThinkingIndicator />
          </div>
        </section>

        <section data-case="below-fold" aria-labelledby="case-below" style={{ paddingTop: "120vh" }}>
          <h2 id="case-below">Below the fold</h2>
          <PencilLoader label="Loading below the fold" />
        </section>
      </main>
    </MotionRuntime>
  );
}
