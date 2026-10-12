import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ButtonLink } from "@/components/ButtonLink";
import { ApplicationsClosedNotice, ApplyLink, CareersCta, HiringSteps, RoleCard } from "@/components/careers/CareersBlocks";
import styles from "@/components/careers/careers.module.css";
import { Container } from "@/components/Container";
import { PageHero } from "@/components/PageHero";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { JsonLd } from "@/components/seo/JsonLd";
import { applyByEmailHref, applyHref, careerRoles, getRole, openRoles } from "@/lib/careers";
import { applicationsOpen, careersConfig } from "@/lib/careers-config";
import { jobPostingData } from "@/lib/careers-jobposting";
import { createMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site";

/**
 * One page per role, generated from the roles file. An unknown address is the site's not-found page; a role
 * that has closed (or has not opened) says so plainly and offers the register-your-interest route. Open
 * vacancies carry JobPosting markup (lib/careers-jobposting.ts) when, and only when, it is accurate.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return careerRoles.map((role) => ({ slug: role.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const role = getRole(slug);
  if (!role) return {};
  const base = createMetadata({
    title: `${role.title}: careers`,
    description: `${role.summary} Self-employed, ${role.pay.replace(/\.$/, "")}. ${role.hours}`,
    path: `/careers/${role.slug}`,
  });
  // A role that is not open is not a search result.
  return role.status === "open" ? base : { ...base, robots: { index: false, follow: true } };
}

const STATUS_NOTICE = {
  closed: { title: "This role is no longer accepting applications.", text: "You can still register your interest, and we will be in touch if a role opens that fits." },
  "coming-soon": { title: "This role is not open yet.", text: "You can register your interest now, and we will be in touch when it opens." },
} as const;

export default async function RolePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const role = getRole(slug);
  if (!role) return null; // unreachable: dynamicParams is false, so an unknown slug is a 404 before this renders
  const open = applicationsOpen();
  const isOpen = role.status === "open";
  const posting = jobPostingData(role, { applicationsOpen: open, today: new Date().toISOString().slice(0, 10) });
  const others = openRoles().filter((entry) => entry.slug !== role.slug);

  return (
    <>
      {posting ? <JsonLd data={posting} /> : null}
      <PageHero
        eyebrow={role.kind === "general" ? "Careers" : `Careers · ${role.subject}`}
        title={role.title}
        intro={role.summary}
        className="page-hero--legal"
        breadcrumb={
          <Breadcrumbs
            trail={[
              { name: "Careers", path: "/careers" },
              { name: role.title, path: `/careers/${role.slug}` },
            ]}
          />
        }
        actions={
          isOpen ? (
            <div className="button-group">
              {open ? (
                <ButtonLink href={applyHref(role.slug)} variant="light">
                  Apply for this role
                </ButtonLink>
              ) : (
                <a className="button button--light" href={applyByEmailHref(`Tutor application: ${role.title}`)}>
                  <span>Apply by email</span>
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4 10h11M11 6l4 4-4 4" />
                  </svg>
                </a>
              )}
            </div>
          ) : undefined
        }
      />

      {isOpen ? (open ? null : <ApplicationsClosedNotice />) : (
        <Container className={styles.noticeWrap}>
          <div className={styles.notice} role="note">
            <strong>{STATUS_NOTICE[role.status as keyof typeof STATUS_NOTICE].title}</strong>
            <p>
              {STATUS_NOTICE[role.status as keyof typeof STATUS_NOTICE].text}{" "}
              <Link href={`/careers/register-interest`}>Register your interest</Link>.
            </p>
          </div>
        </Container>
      )}

      <section className="section">
        <Container className={styles.roleLayout}>
          <div>
            <Reveal variant="static">
              <div className={styles.roleBlock}>
                <h2>What you will do</h2>
                <ul className={styles.checkList}>
                  {role.doing.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <div className={styles.roleBlock}>
              <h2>What we are looking for</h2>
              <ul className={styles.checkList}>
                {role.looking.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            {role.niceToHave.length > 0 ? (
              <div className={styles.roleBlock}>
                <h2>Nice to have</h2>
                <ul className={styles.checkList}>
                  {role.niceToHave.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className={styles.roleBlock}>
              <h2>How hiring works</h2>
              <p>
                We look at your CV and experience and at your results across GCSE, A Level and any degree, all together. {careersConfig.responseTime}
              </p>
              <HiringSteps />
              <p style={{ marginTop: "1.25rem" }}>
                More in the <Link href="/careers#faq-heading">applicant questions</Link>, and in our{" "}
                <Link href="/careers/safeguarding-agreement">safeguarding agreement</Link>.
              </p>
            </div>
          </div>

          <aside className={styles.roleSide} aria-label="Key facts about this role">
            <h2 style={{ fontSize: "1.1rem" }}>Key facts</h2>
            <dl className={styles.roleMeta}>
              <div>
                <dt>Type</dt>
                <dd>{role.employmentType}</dd>
              </div>
              <div>
                <dt>Where</dt>
                <dd>{role.location}</dd>
              </div>
              <div>
                <dt>Subject</dt>
                <dd>{role.subject}</dd>
              </div>
              <div>
                <dt>Levels</dt>
                <dd>{role.yearGroups}</dd>
              </div>
              <div>
                <dt>Pay</dt>
                <dd>{role.pay}</dd>
              </div>
              <div>
                <dt>Hours</dt>
                <dd>{role.hours}</dd>
              </div>
              {role.postedDate ? (
                <div>
                  <dt>Posted</dt>
                  <dd>
                    <time dateTime={role.postedDate}>{formatDate(role.postedDate)}</time>
                  </dd>
                </div>
              ) : null}
              {role.closingDate ? (
                <div>
                  <dt>Closes</dt>
                  <dd>
                    <time dateTime={role.closingDate}>{formatDate(role.closingDate)}</time>
                  </dd>
                </div>
              ) : null}
            </dl>
            <p style={{ fontSize: "0.9rem" }}>No formal training is currently provided. You need the right to work in the UK, including for self-employed work.</p>
            {isOpen ? <ApplyLink slug={role.slug} open={open} label={open ? "Apply for this role" : "Apply by email"} /> : null}
            <p style={{ fontSize: "0.9rem" }}>
              Questions? <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
            </p>
          </aside>
        </Container>
      </section>

      {others.length > 0 ? (
        <section className="section section--tint" aria-labelledby="related-heading">
          <Container>
            <div className="section-heading section-heading--left section-heading--default">
              <p className="eyebrow">Other roles</p>
              <h2 id="related-heading">Also open</h2>
            </div>
            <div className={`${styles.roleGrid} ${styles.roleGridRelated}`} style={{ "--related-columns": Math.min(others.length, 3) } as CSSProperties}>
              {others.slice(0, 3).map((entry) => (
                <RoleCard key={entry.slug} role={entry} open={open} />
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      <Reveal variant="soft">
        <CareersCta />
      </Reveal>
    </>
  );
}

function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
}
