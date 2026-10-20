import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { AiInputBench } from "./AiInputBench";

export const metadata: Metadata = {
  title: "AiInput | LearnThrive UI components",
  robots: { index: false, follow: false },
};

/**
 * Every state of AiInput on one page, with stable ids for tests/ui-ai-input.spec.ts. Development only,
 * the same convention as /dev/ui-components and /dev/motion: a 404 in production, never indexed.
 */
export default function DevAiInputPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <MotionRuntime>
      <main id="main-content" style={{ maxInlineSize: "45rem", marginInline: "auto", padding: "1.5rem 1rem 5rem" }}>
        <h1>AiInput</h1>
        <p>Development only. The first box is wired to a pretend voice pipeline; the rest show one state each.</p>
        <AiInputBench />
      </main>
    </MotionRuntime>
  );
}
