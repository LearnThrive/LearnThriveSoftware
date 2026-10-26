import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "UI components | LearnThrive",
  robots: { index: false, follow: false },
};

/** One page per component, each at /dev/ui-components/<slug> (a page beside this one). */
const COMPONENTS = [
  { slug: "ai-input", name: "AiInput", note: "The LearnThrive AI's input: attachments, send, microphone and the voice overlay." },
  { slug: "hub-nav", name: "HubNav", note: "The signed-in Library area's icon menu." },
  { slug: "auth-card", name: "AuthCard", note: "Sign-in and sign-up." },
  { slug: "pricing-card", name: "PricingCard", note: "The Library's pricing card, coming-soon and live states." },
  { slug: "pencil-loader", name: "PencilLoader", note: "The loading and thinking indicator." },
  { slug: "activity-panel", name: "ActivityPanel", note: "What LearnThrive AI is doing for an answer: live, then folded into one row." },
] as const;

/**
 * A development-only bench for the components converted from the Uiverse.io files in `UI Components`
 * (plan19.md section 7). Same convention as /dev/motion and /dev/classroom: a 404 in production (the proxy
 * also refuses /dev/**), never indexed.
 */
export default function DevUiComponentsPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main id="main-content" style={{ maxWidth: 720, margin: "0 auto", padding: "24px 20px 80px", fontFamily: "system-ui, sans-serif" }}>
      <h1>UI components</h1>
      <p>Development only. Each component has its own page with every state on it.</p>
      <ul>
        {COMPONENTS.map((component) => (
          <li key={component.slug}>
            <Link href={`/dev/ui-components/${component.slug}`}>{component.name}</Link>: {component.note}
          </li>
        ))}
      </ul>
    </main>
  );
}
