import type { Metadata } from "next";
import Link from "next/link";
import { AgreementDefinitions, ClauseList } from "@/components/careers/AgreementDocument";
import styles from "@/components/careers/careers.module.css";
import { LegalPage } from "@/components/LegalPage";
import { agreementOpen } from "@/lib/careers-config";
import { createMetadata } from "@/lib/metadata";
import { agreementVersions, currentAgreement } from "@/lib/safeguarding-agreement";
import { siteConfig } from "@/lib/site";

/**
 * The full text of the safeguarding agreement every applicant must read and agree to, and every tutor
 * reconfirms. It is read from the one source (lib/safeguarding-agreement.ts), so this page, the application
 * form, the reconfirmation form, the emails and the server checks can never differ.
 *
 * While the owner has not approved the wording (careersConfig.agreementApprovedByOwner is false) the page says
 * so plainly, and search engines are asked to leave it alone: unapproved wording is for the owners to read,
 * not a published commitment.
 */
export function generateMetadata(): Metadata {
  const base = createMetadata({
    title: "Safeguarding agreement for tutors",
    description:
      "The safeguarding agreement every LearnThrive tutor must read and agree to when applying, and reconfirm every year.",
    path: "/careers/safeguarding-agreement",
  });
  return agreementOpen() ? base : { ...base, robots: { index: false, follow: true } };
}

export default function SafeguardingAgreementPage() {
  const agreement = currentAgreement;
  const approved = agreementOpen();

  return (
    <LegalPage
      path="/careers/safeguarding-agreement"
      eyebrow="Safeguarding"
      title="Safeguarding agreement for tutors"
      intro="What every LearnThrive tutor must do, and must never do, when working with children and young people. Every applicant reads and agrees to it as part of applying."
      reviewedOn={agreement.dateLabel}
      scope={
        <>
          {!approved ? (
            <div className={styles.notice} role="note">
              <strong>This agreement is a draft.</strong>
              <p>
                It has not yet been approved, so online applications and reconfirmation are not open. You can read it now. To apply in the
                meantime, email <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
              </p>
            </div>
          ) : null}
          <p className={styles.agreementMeta}>
            <span>
              Version <strong>{agreement.version}</strong>
            </span>
            <span>
              Dated <strong>{agreement.dateLabel}</strong>
            </span>
          </p>
          {agreement.intro.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </>
      }
      sections={[
        { id: "definitions", title: "Definitions", content: <AgreementDefinitions agreement={agreement} /> },
        ...agreement.parts.map((part) => ({
          id: `part-${part.id}`,
          title: `Part ${part.id}: ${part.heading}`,
          content: <ClauseList part={part} idPrefix="agreement" />,
        })),
        {
          id: "how-you-agree",
          title: "How you agree, and how often",
          content: (
            <>
              <p>
                You agree to this agreement as part of your application: you tick each part, answer six short questions about it (this is not
                training), and type your full name. The same expectations then form part of the tutor agreement you sign if you are offered
                work.
              </p>
              <p>
                Tutors reconfirm the agreement every year, and whenever a new version is issued, on the{" "}
                <Link href="/safeguarding/reconfirm">reconfirmation page</Link>.
              </p>
              <p>
                <Link href="/careers">Back to careers</Link>
                {" · "}
                <Link href="/safeguarding">Safeguarding information</Link>
              </p>
            </>
          ),
        },
        {
          id: "versions",
          title: "Versions",
          content: (
            <>
              <p>A published version is never edited. A change is a new version, and every tutor then reconfirms.</p>
              <table className={styles.versionTable}>
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">Dated</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(agreementVersions).map((entry) => (
                    <tr key={entry.version}>
                      <td>{entry.version}</td>
                      <td>{entry.dateLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ),
        },
      ]}
    />
  );
}
