export type SubjectKey = "maths" | "english" | "science" | "eleven-plus";

export const SUBJECT_ACCENT: Record<SubjectKey, string> = {
  maths: "#075f52",
  english: "#8a5a2b",
  science: "#1c6ea4",
  "eleven-plus": "#7a4fb5",
};

/**
 * Same icon language subjects/page.tsx already established (calculator/book/flask), extracted
 * here so the homepage's subject cards can reuse it instead of drawing a second set of icons —
 * plus an eleven-plus glyph that page's SubjectSvg didn't need (it renders 11+ as a separate,
 * icon-less section there).
 */
export function SubjectIcon({ subject }: { subject: SubjectKey }) {
  if (subject === "maths") {
    return (
      <svg viewBox="0 0 24 24" fill="none" width={26} height={26} aria-hidden="true">
        <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 7h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (subject === "english") {
    return (
      <svg viewBox="0 0 24 24" fill="none" width={26} height={26} aria-hidden="true">
        <path d="M12 6c-2-1.3-4.5-1.3-7 0v12c2.5-1.3 5-1.3 7 0 2-1.3 4.5-1.3 7 0V6c-2.5-1.3-5-1.3-7 0z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 6v12" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (subject === "science") {
    return (
      <svg viewBox="0 0 24 24" fill="none" width={26} height={26} aria-hidden="true">
        <path d="M9 3h6M10 3v6l-5 8a2 2 0 001.7 3h10.6a2 2 0 001.7-3l-5-8V3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M7.5 15h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" width={26} height={26} aria-hidden="true">
      <circle cx="6" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11l8-4M8 13l8 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A restrained, abstract per-subject corner motif — plan9.md section 13's "subtle educational
 * personality" (coordinate/grid for maths, editorial linework for English, structured diagram for
 * science, pathway for 11+) rendered as decorative linework, not a cartoon illustration. Sits
 * behind card content at low opacity.
 */
export function SubjectMotif({ subject }: { subject: SubjectKey }) {
  const stroke = SUBJECT_ACCENT[subject];
  if (subject === "maths") {
    return (
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        {[0, 24, 48, 72, 96].map((v) => (
          <line key={`h${v}`} x1="0" y1={v} x2="120" y2={v} stroke={stroke} strokeWidth="1" />
        ))}
        {[0, 24, 48, 72, 96].map((v) => (
          <line key={`v${v}`} x1={v} y1="0" x2={v} y2="120" stroke={stroke} strokeWidth="1" />
        ))}
      </svg>
    );
  }
  if (subject === "english") {
    return (
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <path d="M20 30c14-10 28-10 40 0M20 55c14-10 28-10 40 0M20 80c14-10 28-10 40 0" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (subject === "science") {
    return (
      <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="30" cy="30" r="5" stroke={stroke} strokeWidth="1.4" />
        <circle cx="85" cy="45" r="5" stroke={stroke} strokeWidth="1.4" />
        <circle cx="55" cy="90" r="5" stroke={stroke} strokeWidth="1.4" />
        <path d="M34 33l17 8M80 49l-22 34" stroke={stroke} strokeWidth="1.4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <path d="M10 100c20 0 20-70 40-70s20 70 40 70" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeDasharray="1 7" />
      <circle cx="10" cy="100" r="3" fill={stroke} />
      <circle cx="90" cy="100" r="3" fill={stroke} />
    </svg>
  );
}
