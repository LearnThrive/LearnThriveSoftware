import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { ActivityPanelBench } from "./ActivityPanelBench";

export const metadata: Metadata = {
  title: "ActivityPanel | LearnThrive UI components",
  robots: { index: false, follow: false },
};

/** Every state of the activity panel on one page, with stable ids for tests-e2e/ui-activity-panel.spec.ts. Development only: a 404 in production. */
export default function DevActivityPanelPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <MotionRuntime>
      <main id="main-content" style={{ maxInlineSize: "42rem", marginInline: "auto", padding: "1.5rem 1rem 5rem" }}>
        <h1>ActivityPanel</h1>
        <p>Development only. Each section is one state of the panel that sits inside an assistant message.</p>
        <ActivityPanelBench />
      </main>
    </MotionRuntime>
  );
}
