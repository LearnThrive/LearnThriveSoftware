"use client";

import Link from "next/link";
import { useEffect } from "react";
import { BrandIllustration } from "@/components/brand/BrandIllustration";
import { Container } from "@/components/Container";
import { PublicShell } from "@/components/shell/PublicShell";

/**
 * The public error boundary (plan15 Wave 10 section 14.5): what a visitor sees if a page throws.
 * Branded, calm, and honest: it says something went wrong on our side, offers a retry and a way
 * forward, and shows nothing technical. The error itself goes to the console for whoever is looking
 * (and to the structured server log), never to the visitor. The authenticated app has its own
 * boundary in (app)/error.tsx, which takes precedence inside /dashboard.
 */
export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PublicShell>
      <section className="not-found">
        <Container className="not-found__inner">
          <div>
            <p className="eyebrow">Something went wrong</p>
            <h1>That did not load</h1>
            <p>
              Sorry — something went wrong on our side. Trying again usually fixes it. If it does
              not, you can still reach us directly.
            </p>
            <div className="button-group">
              <button type="button" className="button button--primary" onClick={reset}>
                <span>Try again</span>
              </button>
              <Link className="text-link" href="/contact">
                Contact LearnThrive <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
          <BrandIllustration variant="error" className="not-found__art" />
        </Container>
      </section>
    </PublicShell>
  );
}
