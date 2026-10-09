import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ReconfirmForm } from "@/components/careers/ReconfirmForm";
import styles from "@/components/careers/careers.module.css";
import { Container } from "@/components/Container";
import { PageHero } from "@/components/PageHero";
import { PhoneContacts } from "@/components/PhoneContacts";
import { agreementOpen } from "@/lib/careers-config";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

/**
 * The yearly reconfirmation page for existing tutors. Not indexed, not in the sitemap, and linked only from
 * the safeguarding agreement page and the tutor-facing text. While the agreement is a draft it shows a notice
 * instead of the form (the route refuses submissions too). There is no login: the owners match each
 * submission against their list of tutors (docs/AGREEMENT_RECONFIRMATION.md).
 */
export const metadata: Metadata = {
  ...createMetadata({
    title: "Reconfirm the safeguarding agreement",
    description: "For LearnThrive tutors: reconfirm the safeguarding agreement every year, and whenever a new version is issued.",
    path: "/safeguarding/reconfirm",
  }),
  robots: { index: false, follow: false },
};

export default function ReconfirmPage() {
  const open = agreementOpen();
  return (
    <>
      <PageHero
        eyebrow="Safeguarding"
        title="Reconfirm the safeguarding agreement"
        intro="For LearnThrive tutors. Tutors reconfirm the safeguarding agreement every year, and whenever a new version is issued."
        className="page-hero--legal"
        breadcrumb={
          <Breadcrumbs
            trail={[
              { name: "Safeguarding", path: "/safeguarding" },
              { name: "Reconfirm", path: "/safeguarding/reconfirm" },
            ]}
          />
        }
      />
      <section className="section">
        <Container>
          {open ? (
            <ReconfirmForm />
          ) : (
            <div className={styles.prose}>
              <div className={styles.notice} role="note">
                <strong>Online reconfirmation is not open yet.</strong>
                <p>The safeguarding agreement is a draft until it has been approved. You can read it now.</p>
              </div>
              <p>
                If you need to tell us about a change, or have a question, contact the safeguarding lead directly: <PhoneContacts /> or{" "}
                <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
              </p>
              <p>
                <Link className="text-link" href="/careers/safeguarding-agreement">
                  Read the safeguarding agreement <span aria-hidden="true">→</span>
                </Link>
              </p>
            </div>
          )}
        </Container>
      </section>
    </>
  );
}
