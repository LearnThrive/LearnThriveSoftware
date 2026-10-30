import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OpenUiPreview } from "./OpenUiPreview";

export const metadata: Metadata = {
  title: "Interactive answer preview | LearnThrive UI components",
  robots: { index: false, follow: false },
};

/**
 * Draws one interactive answer from a program in the address (`#program=<base64url>`) or one pasted into the box, with the same renderer and component library
 * as the chat. It exists so a program a model wrote can be SEEN and used (docs/OPENUI.md, `npm run assistant:openui-bench` renders every program it
 * measures here). Development only: a 404 in production.
 */
export default function DevOpenUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main id="main-content" style={{ maxInlineSize: "46rem", marginInline: "auto", padding: "1.5rem 1rem 5rem" }}>
      <h1>Interactive answer preview</h1>
      <p>Development only. Paste an openui-lang program, or open this page with <code>#program=</code> and a base64url program.</p>
      <OpenUiPreview />
    </main>
  );
}
