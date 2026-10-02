import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ViewTransition } from "react";
import { ButtonLink } from "@/components/ButtonLink";
import { Container } from "@/components/Container";
import { CtaSection } from "@/components/CtaSection";
import { FeatureCard } from "@/components/FeatureCard";
import { Icon } from "@/components/Icon";
import { PageHero } from "@/components/PageHero";
import { SectionHeading } from "@/components/SectionHeading";
import { MaskedText } from "@/components/motion/primitives/MaskedText";
import { Reveal, type RevealVariant } from "@/components/motion/primitives/Reveal";
import { CinematicBackdrop } from "@/components/motion/primitives/CinematicBackdrop";
import { SubjectHeroMotif } from "@/components/motion/scenes/SubjectHeroMotif";
import { SubjectWorld } from "@/components/motion/scenes/SubjectWorld";
import type { SubjectLandingConfig, SubjectLandingSlug } from "@/lib/site";
import { motionStagger, staggerDelay } from "@/lib/motion/tokens";

type SubjectLandingPageProps = {
  subject: SubjectLandingConfig;
};

/**
 * plan11.md task 10's "non-repetitive" motion across the support/spotlight sections: a different
 * Reveal variant per subject rather than the same one four times over. The coverage section's own
 * distinct treatment lives in SubjectWorld.tsx; SubjectLandingSlug and SubjectWorldKind are the
 * same four strings (checked by tests/site.test.mjs), so subject.slug is passed straight through.
 */
const SUPPORT_VARIANT: Record<SubjectLandingSlug, RevealVariant> = {
  maths: "scale",
  english: "soft",
  science: "side",
  "11-plus": "scale",
};

const SPOTLIGHT_VARIANT: Record<SubjectLandingSlug, RevealVariant> = {
  maths: "editorial",
  english: "mask",
  science: "editorial",
  "11-plus": "side",
};

export function SubjectLandingPage({ subject }: SubjectLandingPageProps) {
  return (
    <div className={`subject-landing subject-landing--${subject.slug}`}>
      <PageHero
        eyebrow={subject.hero.eyebrow}
        title={subject.hero.title}
        intro={subject.hero.intro}
        breadcrumb={
          <Breadcrumbs
            trail={[
              { name: "Subjects", path: "/subjects" },
              { name: `${subject.title} tuition`, path: subject.path },
            ]}
          />
        }
        backdrop={
          <CinematicBackdrop>
            <SubjectHeroMotif slug={subject.slug} />
          </CinematicBackdrop>
        }
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
            {/* plan11.md task 14's prototype transition — the other half of the pair in
                (public)/page.tsx's subjectCards; see that file's comment. subject.path (e.g.
                "/maths-tuition") is this config's own name for the same route the homepage card's
                slug field spells without the leading slash, so both sides always agree. */}
            <ViewTransition name={`subject-icon-${subject.path.slice(1)}`}>
              <span className="subject-landing-hero-card__icon">
                <Icon name={subject.icon} />
              </span>
            </ViewTransition>
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
              // The first card is the first block below the hero, so it stays static (LCP) —
              // matching the same "first reveal is the explicit opt-out" convention marketing-
              // motion.spec.ts already enforces for /subjects, /about, /contact and /faq.
              <Reveal key={item.title} variant={index === 0 ? "static" : SUPPORT_VARIANT[subject.slug]} delay={staggerDelay(index, motionStagger.list)}>
                <FeatureCard {...item} index={index + 1} />
              </Reveal>
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
          <SubjectWorld subject={subject} kind={subject.slug} />
        </Container>
      </section>

      <section className="section subject-personalised-section">
        <Container className="editorial-split">
          <Reveal variant={SPOTLIGHT_VARIANT[subject.slug]} className="subject-personalised__heading">
            <p className="eyebrow">{subject.spotlight.eyebrow}</p>
            {/* plan12.md task 7: "use large type sparingly" — one oversized editorial moment per
                page, not one per section; existing, already-approved copy (subject.spotlight.title),
                never new text invented for the effect. */}
            <h2>
              <MaskedText>{subject.spotlight.title}</MaskedText>
            </h2>
          </Reveal>
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

      <Reveal variant="soft">
        <CtaSection title={subject.cta.title} text={subject.cta.text} />
      </Reveal>
    </div>
  );
}
