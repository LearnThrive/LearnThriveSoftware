import type { ReactNode } from "react";
import { Container } from "@/components/Container";

type PageHeroProps = {
  eyebrow: string;
  title: string;
  intro: string;
  aside?: ReactNode;
  actions?: ReactNode;
};

export function PageHero({
  eyebrow,
  title,
  intro,
  aside,
  actions,
}: PageHeroProps) {
  return (
    <section className="page-hero">
      <Container className="page-hero__inner">
        <div className="page-hero__copy">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="page-hero__intro">{intro}</p>
          {actions ? <div className="page-hero__actions">{actions}</div> : null}
        </div>
        {aside ? <div className="page-hero__aside">{aside}</div> : null}
      </Container>
    </section>
  );
}
