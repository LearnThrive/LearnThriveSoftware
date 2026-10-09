import type { ReactNode } from "react";
import type { AgreementPart, SafeguardingAgreement } from "@/lib/safeguarding-agreement";
import styles from "./careers.module.css";

/**
 * The safeguarding agreement laid out for reading: its definitions and every clause of every part, taken
 * from the one source (lib/safeguarding-agreement.ts). Used on the public agreement page and, with a
 * footer under each part, inside the application form and the reconfirmation form, so a person agrees to
 * exactly the text the page shows. No behaviour of its own: it renders on the server and in the browser.
 */
export function AgreementDefinitions({ agreement }: { agreement: SafeguardingAgreement }) {
  return (
    <dl className={styles.definitions}>
      {agreement.definitions.map((definition) => (
        <div key={definition.term}>
          <dt>{definition.term}</dt>
          <dd>{definition.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The numbered clauses of one part, with no heading of its own (a page that supplies its own uses this). */
export function ClauseList({ part, idPrefix = "part" }: { part: AgreementPart; idPrefix?: string }) {
  return (
    <ol className={styles.clauses}>
      {part.clauses.map((clause) => (
        <li className={styles.clause} key={clause.id} id={`${idPrefix}-clause-${clause.id}`}>
          <span className={styles.clauseId}>{clause.id}</span>
          <div>
            <p>{clause.text}</p>
            {clause.items ? (
              <ul>
                {clause.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AgreementPartView({ part, idPrefix = "part", footer }: { part: AgreementPart; idPrefix?: string; footer?: ReactNode }) {
  const headingId = `${idPrefix}-${part.id}-heading`;
  return (
    <section className={styles.part} id={`${idPrefix}-${part.id}`} aria-labelledby={headingId}>
      <h3 id={headingId}>
        Part {part.id}: {part.heading}
      </h3>
      <ClauseList part={part} idPrefix={idPrefix} />
      {footer}
    </section>
  );
}

export function AgreementIntro({ agreement }: { agreement: SafeguardingAgreement }) {
  return (
    <>
      {agreement.intro.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <h3>Definitions</h3>
      <AgreementDefinitions agreement={agreement} />
    </>
  );
}

/** The whole agreement with no form controls: definitions, then Part A to Part G. */
export function AgreementDocument({ agreement, idPrefix = "part" }: { agreement: SafeguardingAgreement; idPrefix?: string }) {
  return (
    <>
      <AgreementIntro agreement={agreement} />
      {agreement.parts.map((part) => (
        <AgreementPartView key={part.id} part={part} idPrefix={idPrefix} />
      ))}
    </>
  );
}
