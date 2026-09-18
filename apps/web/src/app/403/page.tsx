import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ButtonLink";
import { Container } from "@/components/Container";
import { createMetadata } from "@/lib/metadata";

export const metadata: Metadata = createMetadata({
  title: "Permission denied",
  description: "You do not have permission to view this page.",
  path: "/403",
});

export default function ForbiddenPage() {
  return (
    <section className="not-found">
      <Container className="not-found__inner">
        <p className="eyebrow">Permission denied</p>
        <h1>You don&apos;t have access to this page</h1>
        <p>
          Your account doesn&apos;t have permission to view this page. If you think this is
          wrong, contact LearnThrive.
        </p>
        <div className="button-group">
          <ButtonLink href="/dashboard">Back to dashboard</ButtonLink>
          <Link className="text-link" href="/contact">
            Contact LearnThrive <span aria-hidden="true">→</span>
          </Link>
        </div>
      </Container>
    </section>
  );
}
