import Link from "next/link";
import { ButtonLink } from "@/components/ButtonLink";
import { Container } from "@/components/Container";
import { PublicShell } from "@/components/shell/PublicShell";

/**
 * The public 404. It sits at the app root rather than inside the (public) route group, because
 * Next only applies the root layout to a root not-found — so the marketing chrome has to be
 * added explicitly here (plan6 section 71: public 404 uses PublicShell, authenticated 404 uses
 * AppShell, and the two never mix).
 */
export default function NotFound() {
  return (
    <PublicShell>
      <section className="not-found">
        <Container className="not-found__inner">
          <p className="eyebrow">Page not found</p>
          <h1>That page is not here</h1>
          <p>
            The address may have changed, or the page may no longer be available.
            Use the links below to continue.
          </p>
          <div className="button-group">
            <ButtonLink href="/">Return home</ButtonLink>
            <Link className="text-link" href="/contact">
              Contact LearnThrive <span aria-hidden="true">→</span>
            </Link>
          </div>
        </Container>
      </section>
    </PublicShell>
  );
}
