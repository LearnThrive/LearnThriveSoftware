import type { SubjectLandingSlug } from "@/lib/site";

/**
 * plan12.md task 7: a per-subject hero backdrop, composition not just animation — the same idea
 * SubjectWorld.tsx already established for the coverage section (a drawn path for maths/11+,
 * connected nodes for science, restrained everywhere, no cliché neon atom), echoed once more at
 * the top of the page so the subject's visual language is set from the very first screen, not only
 * introduced partway down. Purely static SVG (no scroll progress, no MotionValue): a hero backdrop
 * is on screen before any scroll happens, so there is nothing here for a scroll source to drive —
 * the coverage section is where the motif actually animates.
 */
export function SubjectHeroMotif({ slug }: { slug: SubjectLandingSlug }) {
  if (slug === "maths") return <MathsGrid />;
  if (slug === "english") return <EnglishLines />;
  if (slug === "science") return <ScienceField />;
  return <RouteMilestones />;
}

function MathsGrid() {
  const lines = [0, 20, 40, 60, 80, 100];
  return (
    <svg className="subject-hero-motif" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
      {lines.map((x) => (
        <line key={`v${x}`} x1={x} y1="0" x2={x} y2="100" stroke="var(--subject-accent)" strokeWidth="0.3" opacity="0.18" />
      ))}
      {lines.map((y) => (
        <line key={`h${y}`} x1="0" y1={y} x2="200" y2={y} stroke="var(--subject-accent)" strokeWidth="0.3" opacity="0.18" />
      ))}
      <path
        d="M0 90 C 40 20, 100 95, 140 30 S 190 10, 200 5"
        fill="none"
        stroke="var(--subject-accent)"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

function EnglishLines() {
  const rules = [18, 34, 50, 66, 82];
  return (
    <svg className="subject-hero-motif" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
      {rules.map((y) => (
        <line key={y} x1="10" y1={y} x2="190" y2={y} stroke="var(--subject-accent)" strokeWidth="0.4" opacity="0.16" />
      ))}
      <text x="150" y="78" fontSize="60" fontFamily="serif" fill="var(--subject-accent)" opacity="0.14">
        &rdquo;
      </text>
    </svg>
  );
}

function ScienceField() {
  const nodes = [
    [20, 30],
    [55, 15],
    [90, 40],
    [70, 70],
    [30, 65],
    [110, 20],
  ] as const;
  return (
    <svg className="subject-hero-motif" viewBox="0 0 200 100" aria-hidden="true">
      <line x1="20" y1="30" x2="55" y2="15" stroke="var(--subject-accent)" strokeWidth="0.4" opacity="0.22" />
      <line x1="55" y1="15" x2="90" y2="40" stroke="var(--subject-accent)" strokeWidth="0.4" opacity="0.22" />
      <line x1="90" y1="40" x2="70" y2="70" stroke="var(--subject-accent)" strokeWidth="0.4" opacity="0.22" />
      <line x1="70" y1="70" x2="30" y2="65" stroke="var(--subject-accent)" strokeWidth="0.4" opacity="0.22" />
      <line x1="90" y1="40" x2="110" y2="20" stroke="var(--subject-accent)" strokeWidth="0.4" opacity="0.22" />
      {nodes.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={i % 2 === 0 ? 3 : 2} fill="var(--subject-accent)" opacity="0.4" />
      ))}
    </svg>
  );
}

function RouteMilestones() {
  const stops = [0, 25, 50, 75, 100];
  return (
    <svg className="subject-hero-motif" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M5 90 L60 65 L110 55 L155 30 L195 12"
        fill="none"
        stroke="var(--subject-accent)"
        strokeWidth="0.8"
        strokeDasharray="3 4"
        opacity="0.3"
      />
      {stops.map((t) => {
        const x = 5 + (t / 100) * 190;
        const y = 90 - (t / 100) * 78;
        return <circle key={t} cx={x} cy={y} r="2.6" fill="var(--subject-accent)" opacity="0.4" />;
      })}
    </svg>
  );
}
