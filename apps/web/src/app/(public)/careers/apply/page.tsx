import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ApplicationForm } from "@/components/careers/apply/ApplicationForm";
import styles from "@/components/careers/careers.module.css";
import { Container } from "@/components/Container";
import { PageHero } from "@/components/PageHero";
import { applyByEmailHref, openRoles } from "@/lib/careers";
import { applicationsOpen, careersConfig } from "@/lib/careers-config";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

/**
 * The application page. It is never indexed (the form is not a landing page) and is not in the sitemap. While
 * online applications are closed (switched off, or the safeguarding agreement not yet approved by the owner)
 * it shows how to apply by email instead of the form, so unapproved wording can never be agreed to by accident.
 * `?role=maths-tutor` preselects a role. It reads the request, so it is rendered fresh each time.
 */
export const metadata: Metadata = {
  ...createMetadata({
    title: "Apply to tutor with LearnThrive",
    description: "Apply to tutor online with LearnThrive Tuition.",
    path: "/careers/apply",
  }),
  robots: { index: false, follow: false },
};

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ role?: string | string[] }> }) {
  const open = applicationsOpen();
  const roles = openRoles().map((role) => ({ slug: role.slug, title: role.title }));
  const requested = (await searchParams).role;
  const roleParam = Array.isArray(requested) ? requested[0] : requested;
  const initialRole = roles.some((role) => role.slug === roleParam) ? (roleParam as string) : roles.length === 1 ? roles[0].slug : "";

  return (
    <>
      <PageHero
        eyebrow="Careers"
        title="Apply to tutor"
        intro={
          open
            ? "One page, in eight sections. Have your CV and your results to hand. Nothing you type is saved, so send it in one go."
            : "Online applications open soon. You can apply by email in the meantime."
        }
        className="page-hero--legal"
        breadcrumb={
          <Breadcrumbs
            trail={[
              { name: "Careers", path: "/careers" },
              { name: "Apply", path: "/careers/apply" },
            ]}
          />
        }
      />

      <section className="section">
        <Container>
          {open ? (
            <>
              <noscript>
                <div className={styles.notice} role="note">
                  <strong>The online application needs JavaScript.</strong>
                  <p>
                    It is turned off in your browser. You can apply by email instead: write to{" "}
                    <a href={applyByEmailHref()}>{siteConfig.email}</a> with your CV and the subjects you could teach, and we will send you the
                    safeguarding agreement to read and confirm before anything else happens.
                  </p>
                </div>
              </noscript>
              <ApplicationForm roles={roles} initialRole={initialRole} today={new Date().toISOString().slice(0, 10)} />
              <p className={styles.applyAlt}>
                Prefer email, or need another way to apply? Write to <a href={applyByEmailHref()}>{siteConfig.email}</a> or call us. We will send you the
                safeguarding agreement to read and confirm before anything else happens.
              </p>
            </>
          ) : (
            <div className={styles.prose}>
              <div className={styles.notice} role="note">
                <strong>Online applications open soon.</strong>
                <p>
                  We are finalising the safeguarding agreement every applicant reads and agrees to as part of applying. You can{" "}
                  <Link href="/careers/safeguarding-agreement">read the draft</Link> now.
                </p>
              </div>
              <p>
                To apply in the meantime, email <a href={applyByEmailHref()}>{siteConfig.email}</a> with your CV and the subjects and year groups you could
                teach. We will send you the safeguarding agreement to read and confirm before anything else happens. {careersConfig.responseTime}
              </p>
              <p>
                Prefer to talk? Call us on the numbers on our <Link href="/contact">contact page</Link>.
              </p>
              <p>
                <Link className="text-link" href="/careers">
                  Back to careers <span aria-hidden="true">→</span>
                </Link>
              </p>
            </div>
          )}
        </Container>
      </section>
    </>
  );
}
