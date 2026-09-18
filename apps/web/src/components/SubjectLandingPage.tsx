import Link from "next/link";
import { ButtonLink } from "@/components/ButtonLink";
import { Container } from "@/components/Container";
import { CtaSection } from "@/components/CtaSection";
import { FeatureCard } from "@/components/FeatureCard";
import { Icon } from "@/components/Icon";
import { PageHero } from "@/components/PageHero";
import { SectionHeading } from "@/components/SectionHeading";
import type { SubjectLandingConfig } from "@/lib/site";

type SubjectLandingPageProps = {
  subject: SubjectLandingConfig;
};

export function SubjectLandingPage({ subject }: SubjectLandingPageProps) {
  return (
    <div className={`subject-landing subject-landing--${subject.slug}`}>
      <PageHero
        eyebrow={subject.hero.eyebrow}
        title={subject.hero.title}
        intro={subject.hero.intro}
        actions={
          <div className="button-group">
            <ButtonLink href="/book" variant="light">
              Book a free consultation
            </ButtonLink>
            <ButtonLink href="/contact" variant="text">
              Contact LearnThrive
            </ButtonLink>
          </div>
        }
        aside={
          <div className="subject-landing-hero-card">
            <span className="subject-landing-hero-card__icon">
              <Icon name={subject.icon} />
            </span>
            <span className="subject-landing-hero-card__label">
              {subject.hero.noteLabel}
            </span>
            <strong>{subject.stage}</strong>
            <p>{subject.hero.note}</p>
          </div>
        }
      />

      <section className="section subject-landing-support">
        <Container>
          <SectionHeading
            eyebrow={subject.support.eyebrow}
            title={subject.support.title}
            intro={subject.support.intro}
          />
          <div className="subject-benefit-grid">
            {subject.support.items.map((item, index) => (
              <FeatureCard key={item.title} {...item} index={index + 1} />
            ))}
          </div>
        </Container>
      </section>

      <section className="section subject-coverage-section">
        <Container>
          <SectionHeading
            eyebrow={subject.coverage.eyebrow}
            title={subject.coverage.title}
            intro={subject.coverage.intro}
          />
          <ol
            className="subject-pathway-grid"
            aria-label={`${subject.title} ${
              subject.coverage.itemLabel === "Priority" ? "priorities" : "stages"
            }`}
          >
            {subject.coverage.items.map((item, index) => (
              <li className="subject-pathway-card" key={item.title}>
                <span>
                  {subject.coverage.itemLabel} {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="section subject-personalised-section">
        <Container className="editorial-split">
          <div className="subject-personalised__heading">
            <p className="eyebrow">{subject.spotlight.eyebrow}</p>
            <h2>{subject.spotlight.title}</h2>
          </div>
          <div className="subject-personalised__body">
            <p>{subject.spotlight.text}</p>
            <ul className="subject-personalised__points">
              {subject.spotlight.points.map((point) => (
                <li key={point.title}>
                  <span>{point.title}</span>
                  <p>{point.text}</p>
                </li>
              ))}
            </ul>
            <div className="subject-personalised__actions">
              <ButtonLink href="/book" variant="secondary">
                Discuss the right support
              </ButtonLink>
              <Link className="text-link" href="/subjects">
                View all subjects <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </Container>
      </section>

      <CtaSection title={subject.cta.title} text={subject.cta.text} />
    </div>
  );
}
