import Link from "next/link";
import { ButtonLink } from "@/components/ButtonLink";
import { Container } from "@/components/Container";

export default function NotFound() {
  return (
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
  );
}
