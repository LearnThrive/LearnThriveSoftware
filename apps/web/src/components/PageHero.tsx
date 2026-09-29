import type { ReactNode } from "react";
import { Container } from "@/components/Container";

type PageHeroProps = {
  eyebrow: string;
  title: string;
  intro: string;
  aside?: ReactNode;
  actions?: ReactNode;
  /** Extra class on the root <section>, e.g. "page-hero--legal" for a page-type-scoped CSS hook
      (plan11.md task 12) without touching every other page that renders this shared component. */
  className?: string;
  /** plan12.md task 7: an optional decorative layer behind the hero copy — a per-route motif via
      CinematicBackdrop, or anything else. Sits behind .page-hero__inner (that element's own
      z-index: 1 inside this component's position: relative/overflow: clip root already handles
      the layering); every existing caller that omits it is completely unaffected. */
  backdrop?: ReactNode;
};

export function PageHero({
  eyebrow,
  title,
  intro,
  aside,
  actions,
  className,
  backdrop,
}: PageHeroProps) {
  return (
    <section className={className ? `page-hero ${className}` : "page-hero"}>
      {backdrop}
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
