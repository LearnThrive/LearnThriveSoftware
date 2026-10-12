import Link from "next/link";
import { ButtonLink } from "@/components/ButtonLink";
import { Container } from "@/components/Container";
import { applicationsOpen, careersConfig } from "@/lib/careers-config";
import { applyByEmailHref, applyHref, type CareerRole } from "@/lib/careers";
import { siteConfig } from "@/lib/site";
import styles from "./careers.module.css";

/**
 * Small server-rendered pieces the careers hub and role pages share: the "applications are not open yet"
 * notice, a role card, the numbered hiring steps and the careers call to action.
 */

/** Shown while applications are closed (switched off, or the agreement not yet approved). */
export function ApplicationsClosedNotice() {
  return (
    <Container className={styles.noticeWrap}>
      <div className={styles.notice} role="note">
        <strong>Online applications open soon.</strong>
        <p>
          You can apply now by email: write to <a href={applyByEmailHref()}>{siteConfig.email}</a> with your CV and the subjects you could teach.
          Before anything else happens, we will send you our safeguarding agreement to read and confirm. {careersConfig.responseTime}
        </p>
      </div>
    </Container>
  );
}

const SUBJECT_KEY: Record<string, string> = {
  Maths: "maths",
  English: "english",
  Science: "science",
  "11+ Preparation": "eleven-plus",
};

export function subjectKey(role: CareerRole): string {
  return role.kind === "general" ? "general" : (SUBJECT_KEY[role.subject] ?? "general");
}

/**
 * One role. `wide` lays the same content out across the full width (intro, facts, actions in a row): used for
 * "Register your interest", which is an open invitation and not one more subject vacancy, so it is set apart
 * from the four subject cards instead of sitting alone on a second row.
 */
export function RoleCard({ role, open, wide = false }: { role: CareerRole; open: boolean; wide?: boolean }) {
  return (
    <article className={`${styles.roleCard}${wide ? ` ${styles.roleCardWide}` : ""}`} data-subject={subjectKey(role)}>
      <span className={styles.roleTag}>{role.kind === "general" ? "Any subject" : role.subject}</span>
      <h3>{role.title}</h3>
      <p>{role.summary}</p>
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
      </dl>
      <div className={styles.roleActions}>
        <ButtonLink href={`/careers/${role.slug}`} variant="secondary">
          View role<span className="sr-only">: {role.title}</span>
        </ButtonLink>
        <ApplyLink slug={role.slug} open={open} label={`Apply${open ? "" : " by email"}`} srLabel={role.title} />
      </div>
    </article>
  );
}

/** A text link that applies online when applications are open, and opens an email when they are not. */
export function ApplyLink({ slug, open, label, srLabel }: { slug?: string; open: boolean; label: string; srLabel?: string }) {
  const content = (
    <>
      {label}
      {srLabel ? <span className="sr-only">: {srLabel}</span> : null}
      <span aria-hidden="true"> →</span>
    </>
  );
  return open ? (
    <Link className="text-link" href={applyHref(slug)}>
      {content}
    </Link>
  ) : (
    <a className="text-link" href={applyByEmailHref(slug ? `Tutor application: ${slug}` : undefined)}>
      {content}
    </a>
  );
}

export function HiringSteps() {
  return (
    <ol className={styles.steps}>
      {careersConfig.hiringSteps.map((step, index) => (
        <li className={styles.step} key={step.title}>
          <span className={styles.stepNumber} aria-hidden="true">
            {index + 1}
          </span>
          <div>
            <h3>
              <span className="sr-only">Step {index + 1}: </span>
              {step.title}
            </h3>
            <p>{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The careers version of the closing call to action (the shared one is fixed to the booking buttons). */
export function CareersCta({ title = "Ready to tutor with LearnThrive?", text }: { title?: string; text?: string }) {
  const open = applicationsOpen();
  return (
    <section className="cta-section">
      <Container className="cta-section__inner">
        <div>
          <p className="eyebrow">Careers</p>
          <h2>{title}</h2>
          <p>{text ?? (open ? `Apply online in your own time. ${careersConfig.responseTime}` : `Email your CV and the subjects you could teach. ${careersConfig.responseTime}`)}</p>
        </div>
        <div className="button-group">
          {open ? (
            <ButtonLink href={applyHref()} variant="light">
              Apply online
            </ButtonLink>
          ) : (
            <a className="button button--light" href={applyByEmailHref()}>
              <span>Email us to apply</span>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 10h11M11 6l4 4-4 4" />
              </svg>
            </a>
          )}
          <ButtonLink href="/careers#open-roles" variant="text">
            See open roles
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}
