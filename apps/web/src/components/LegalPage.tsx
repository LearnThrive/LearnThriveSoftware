import type { ReactNode } from "react";
import { Container } from "@/components/Container";
import { PageHero } from "@/components/PageHero";
import { PhoneContacts } from "@/components/PhoneContacts";
import { siteConfig } from "@/lib/site";

export interface LegalPageProps {
  eyebrow: string;
  title: string;
  intro: string;
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
  scope,
  sections,
}: LegalPageProps) {
  return (
    <>
      <PageHero
        eyebrow={eyebrow}
        title={title}
        intro={intro}
        aside={
          <div className="document-card">
            <span>Last reviewed</span>
            <strong>10 September 2026</strong>
            <p>Written for the services and features available on this website.</p>
          </div>
        }
      />

      <section className="section">
        <Container className="legal-page-layout">
          <aside className="legal-contents">
            <nav aria-labelledby="legal-contents-title">
              <h2 id="legal-contents-title">On this page</h2>
              <ol>
                {sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.title}</a>
                  </li>
                ))}
              </ol>
            </nav>
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
          </article>
        </Container>
      </section>
    </>
  );
}
