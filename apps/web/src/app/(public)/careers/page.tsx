import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ButtonLink } from "@/components/ButtonLink";
import { ApplicationsClosedNotice, CareersCta, HiringSteps, RoleCard } from "@/components/careers/CareersBlocks";
import styles from "@/components/careers/careers.module.css";
import { Container } from "@/components/Container";
import { FaqList } from "@/components/FaqList";
import { PageHero } from "@/components/PageHero";
import { PhoneContacts } from "@/components/PhoneContacts";
import { TestimonialCard } from "@/components/TestimonialCard";
import { CinematicBackdrop } from "@/components/motion/primitives/CinematicBackdrop";
import { Reveal } from "@/components/motion/primitives/Reveal";
import {
  adjustmentsText,
  agreementCommitmentSummary,
  applyByEmailHref,
  applyHref,
  assessmentText,
  confirmedSafeguardingFacts,
  expectations,
  openRoles,
  quickFacts,
  requirements,
  safeguardingTeam,
} from "@/lib/careers";
import { agreementOpen, applicationsOpen, careersConfig } from "@/lib/careers-config";
import { careersFaqs } from "@/lib/careers-faqs";
import { createMetadata } from "@/lib/metadata";
import { siteConfig, testimonials } from "@/lib/site";

export const metadata: Metadata = createMetadata({
  title: "Careers: tutor with LearnThrive",
  description:
    "Tutor online with LearnThrive Tuition. Self-employed, £10 an hour per student. See the open roles, how hiring works and how to apply.",
  path: "/careers",
});

export default function CareersPage() {
  const open = applicationsOpen();
  const roles = openRoles();
  // The subject roles are a group of their own; "Register your interest" is the open invitation after them.
  const subjectRoles = roles.filter((role) => role.kind === "vacancy");
  const interestRole = roles.find((role) => role.kind === "general");

  return (
    <>
      <PageHero
        eyebrow="Careers"
        title="Tutor with LearnThrive"
        intro="LearnThrive Tuition offers online, one-to-one tutoring in Maths, English, Science and 11+ preparation. We are looking for tutors who are confident in their subject and who will follow our safeguarding agreement in full."
        breadcrumb={<Breadcrumbs trail={[{ name: "Careers", path: "/careers" }]} />}
        className="page-hero--legal"
        backdrop={
          <CinematicBackdrop lightChildren={<div className="legal-hero-atmosphere" aria-hidden="true" />}>
            <div className="legal-hero-atmosphere" aria-hidden="true" />
          </CinematicBackdrop>
        }
        actions={
          <div className="button-group">
            <ButtonLink href="#open-roles" variant="light">
              See open roles
            </ButtonLink>
            {open ? (
              <ButtonLink href={applyHref()} variant="text">
                Apply online
              </ButtonLink>
            ) : (
              <a className="button button--text" href={applyByEmailHref()}>
                <span>Apply by email</span>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M4 10h11M11 6l4 4-4 4" />
                </svg>
              </a>
            )}
          </div>
        }
        aside={
          <div className="document-card">
            <span>At a glance</span>
            <dl className={styles.facts}>
              {quickFacts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        }
      />

      {!open ? <ApplicationsClosedNotice /> : null}

      <section className="section" aria-labelledby="work-heading">
        <Container className={styles.split}>
          {/* The first block after the hero is the explicit opt-out: a reveal would hold it back until the script runs. */}
          <Reveal variant="static" className={styles.prose}>
            <p className="eyebrow">The work</p>
            <h2 id="work-heading">Online, one to one</h2>
            <p>
              Lessons are online and one to one. You would teach learners from Year 3 to A Level in Maths, English or Science, or help pupils
              prepare for the 11+, in the subject you are confident in.
            </p>
          </Reveal>
          <Reveal variant="soft">
            <div className={styles.expectPanel}>
              <h3>What to expect</h3>
              <p>This is what the work is. We would rather you knew now.</p>
              <dl className={styles.expectList}>
                {expectations.map((item) => (
                  <div key={item.title}>
                    <dt>{item.title}</dt>
                    <dd>{item.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="section" id="open-roles" aria-labelledby="roles-heading">
        <Container>
          <Reveal variant="soft">
            <div className="section-heading section-heading--left section-heading--default">
              <p className="eyebrow">Open roles</p>
              <h2 id="roles-heading">Where you could teach</h2>
            </div>
          </Reveal>
          {roles.length > 0 ? (
            <div className={styles.roles}>
              {subjectRoles.length > 0 ? (
                <div className={styles.roleGrid}>
                  {subjectRoles.map((role) => (
                    <RoleCard key={role.slug} role={role} open={open} />
                  ))}
                </div>
              ) : null}
              {interestRole ? <RoleCard role={interestRole} open={open} wide /> : null}
            </div>
          ) : (
            <div className={styles.emptyRoles}>
              <h3>No roles are open right now</h3>
              <p>
                You can still register your interest: email <a href={applyByEmailHref("Register my interest")}>{siteConfig.email}</a> with
                your CV and the subjects you could teach.
              </p>
            </div>
          )}
        </Container>
      </section>

      <section className="section section--tint" aria-labelledby="looking-heading">
        <Container className={styles.split}>
          <Reveal variant="soft" className={styles.prose}>
            <p className="eyebrow">Who we are looking for</p>
            <h2 id="looking-heading">Confident in your subject</h2>
            <p>{assessmentText}</p>
          </Reveal>
          <Reveal variant="soft">
            <h3>What every applicant needs</h3>
            <ul className={styles.checkList}>
              {requirements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Reveal>
        </Container>
      </section>

      <section className="section" aria-labelledby="hiring-heading">
        <Container>
          <Reveal variant="soft">
            <div className="section-heading section-heading--left section-heading--default">
              <p className="eyebrow">How hiring works</p>
              <h2 id="hiring-heading">From application to first lesson</h2>
              <div className="section-heading__intro">
                <p>
                  Hiring is run by {safeguardingTeam.lead} together with {safeguardingTeam.deputy}. {careersConfig.responseTime}
                </p>
              </div>
            </div>
          </Reveal>
          <HiringSteps />
        </Container>
      </section>

      <section className="section section--tint" aria-labelledby="safeguarding-heading">
        <Container>
          <Reveal variant="soft">
            <div className={styles.safeguardPanel}>
              <div>
                <p className="eyebrow">Safeguarding</p>
                <h2 id="safeguarding-heading">Children’s safety comes first</h2>
                <ul className={styles.checkList}>
                  {confirmedSafeguardingFacts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              </div>
              {agreementOpen() ? (
                <div>
                  <h3>The main commitments in the agreement</h3>
                  <ul className={styles.checkList}>
                    {agreementCommitmentSummary.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className={styles.safeguardLinks}>
                <Link className="text-link" href="/careers/safeguarding-agreement">
                  Read the safeguarding agreement <span aria-hidden="true">→</span>
                </Link>
                <Link className="text-link" href="/safeguarding">
                  Our safeguarding information <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="section" aria-labelledby="adjustments-heading">
        <Container className={styles.split}>
          <Reveal variant="soft" className={styles.prose}>
            <p className="eyebrow">Equal opportunities and adjustments</p>
            <h2 id="adjustments-heading">Everyone should be able to apply</h2>
            <p>{adjustmentsText}</p>
          </Reveal>
          <Reveal variant="soft" className={styles.prose}>
            <h3>Ask us</h3>
            <p>
              Email <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a> or call <PhoneContacts />. {careersConfig.responseTime}
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="section section--tint" aria-labelledby="families-heading">
        <Container>
          <Reveal variant="soft">
            <div className="section-heading section-heading--left section-heading--default">
              <p className="eyebrow">What families say</p>
              <h2 id="families-heading">The families you would be teaching</h2>
            </div>
          </Reveal>
          <div className="testimonial-grid">
            {testimonials.slice(0, 3).map((testimonial, index) => (
              <Reveal variant="soft" key={testimonial.attribution} className={index === 1 ? "testimonial-grid__featured" : undefined}>
                <TestimonialCard {...testimonial} featured={index === 1} />
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="section" aria-labelledby="faq-heading">
        <Container>
          <Reveal variant="soft">
            <div className="section-heading section-heading--left section-heading--default">
              <p className="eyebrow">Questions</p>
              <h2 id="faq-heading">Applicant questions</h2>
            </div>
          </Reveal>
          <FaqList items={careersFaqs} />
        </Container>
      </section>

      <Reveal variant="soft">
        <CareersCta />
      </Reveal>
    </>
  );
}
