import Link from "next/link";
import { ViewTransition } from "react";
import { Icon } from "@/components/Icon";
import type { SubjectLandingConfig } from "@/lib/site";
import styles from "./SubjectHeroCard.module.css";

/**
 * The card shown beside each subject landing page's hero (icon, label, stage and a short note), and now also
 * on /subjects, in each subject's section. There is ONE source for its words: `subjectLandingPages` in
 * lib/site.ts. Nothing is copied here.
 *
 * - `landing` is the original markup, unchanged: the landing pages look and behave exactly as before,
 *   including the icon's shared view-transition name.
 * - `subjects` is the same card in /subjects' own look, with a link to the subject's page (the existing
 *   `ctaLabel`). It carries no view-transition name: /subjects already names its own icon badge for the same
 *   transition, and a name may appear only once on a page.
 */
export interface SubjectHeroCardProps {
  subject: SubjectLandingConfig;
  variant?: "landing" | "subjects";
  /** `dark` for the card inside the navy 11+ panel. */
  tone?: "light" | "dark";
  className?: string;
}

export function SubjectHeroCard({ subject, variant = "landing", tone = "light", className }: SubjectHeroCardProps) {
  if (variant === "landing") {
    return (
      <div className="subject-landing-hero-card">
        {/* plan11.md task 14's prototype transition — the other half of the pair in (public)/page.tsx's subjectCards.
            subject.path (e.g. "/maths-tuition") is this config's own name for the same route the homepage card's
            slug field spells without the leading slash, so both sides always agree. */}
        <ViewTransition name={`subject-icon-${subject.path.slice(1)}`}>
          <span className="subject-landing-hero-card__icon">
            <Icon name={subject.icon} />
          </span>
        </ViewTransition>
        <span className="subject-landing-hero-card__label">{subject.hero.noteLabel}</span>
        <strong>{subject.stage}</strong>
        <p>{subject.hero.note}</p>
      </div>
    );
  }

  return (
    <article className={`${styles.card}${tone === "dark" ? ` ${styles.dark}` : ""}${className ? ` ${className}` : ""}`} data-subject={subject.slug} aria-label={`${subject.title} tuition at a glance`}>
      <span className={styles.icon}>
        <Icon name={subject.icon} />
      </span>
      <span className={styles.label}>{subject.hero.noteLabel}</span>
      <strong className={styles.stage}>{subject.stage}</strong>
      <p className={styles.note}>{subject.hero.note}</p>
      <Link className={styles.link} href={subject.path}>
        {subject.ctaLabel} <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
