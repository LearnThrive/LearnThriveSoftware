import { ViewTransition } from "react";
import { Icon } from "@/components/Icon";
import type { SubjectLandingConfig } from "@/lib/site";

/**
 * The card shown beside each subject landing page's hero (icon, label, stage and a short note). There is ONE
 * source for its words: `subjectLandingPages` in lib/site.ts.
 *
 * It used to appear in every subject section of /subjects too, with a link to the same page the section's own
 * "Explore ... in depth" link already led to. With that link gone it only repeated the section's heading, stage
 * range and description, so /subjects no longer shows it (docs/UI_UX_COMPLETION_REPORT.md).
 */
export function SubjectHeroCard({ subject }: { subject: SubjectLandingConfig }) {
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
