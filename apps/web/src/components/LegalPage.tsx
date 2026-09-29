import type { ReactNode } from "react";
import { Container } from "@/components/Container";
import { PageHero } from "@/components/PageHero";
import { PhoneContacts } from "@/components/PhoneContacts";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { CinematicBackdrop } from "@/components/motion/primitives/CinematicBackdrop";
import { LegalContentsNav } from "@/components/motion/scenes/LegalPageMotion";
import { siteConfig } from "@/lib/site";

export interface LegalPageProps {
  eyebrow: string;
  title: string;
  intro: string;
  /** Every LegalPage usage passes its own real date — previously this was one date hardcoded
      inside this component and shown, incorrectly, as the "last reviewed" date on every legal
      page regardless of when that page's own content last actually changed. */
  reviewedOn: string;
  scope: ReactNode;
  sections: Array<{
    id: string;
    title: string;
    content: ReactNode;
  }>;
}

export function LegalPage({
  eyebrow,
  title,
  intro,
  reviewedOn,
  scope,
  sections,
}: LegalPageProps) {
  return (
    <>
      <PageHero
        eyebrow={eyebrow}
        title={title}
        intro={intro}
        className="page-hero--legal"
        backdrop={
          <CinematicBackdrop
            lightChildren={<div className="legal-hero-atmosphere" aria-hidden="true" />}
          >
            <div className="legal-hero-atmosphere" aria-hidden="true" />
          </CinematicBackdrop>
        }
        aside={
          <div className="document-card">
            <span>Last reviewed</span>
            <strong>{reviewedOn}</strong>
            <p>Written for the services and features available on this website.</p>
          </div>
        }
      />

      <section className="section">
        <Container className="legal-page-layout">
          <aside className="legal-contents">
            <LegalContentsNav sections={sections.map(({ id, title }) => ({ id, title }))} />
          </aside>

          <article className="legal-prose">
            <div className="legal-scope">
              <h2>Scope</h2>
              {scope}
            </div>

            {sections.map((section) => (
              <section id={section.id} key={section.id}>
                <h2>{section.title}</h2>
                {section.content}
              </section>
            ))}

            <Reveal variant="soft">
              <div className="legal-contact-box">
                <h2>Contact LearnThrive Tuition</h2>
                <p>
                  If you have a question about this page, email{" "}
                  <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a> or
                  call{" "}
                  <PhoneContacts />
                  .
                </p>
              </div>
            </Reveal>
          </article>
        </Container>
      </section>
    </>
  );
}
