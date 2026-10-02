/**
 * The one illustration language for the site's quiet pages (plan15 Wave 10 section 14.5): the 404,
 * the error page and the "portal opening soon" page. It is built from the same motifs the subject
 * pages already use — an open book (the mark), a path with milestone dots (11+, maths), a drawn
 * curve — so a visitor who lands on a dead end is still plainly on the same site.
 *
 * Pure SVG, no animation, colours entirely from semantic tokens (so it is correct in both themes),
 * decorative (`aria-hidden`): the heading beside it says everything.
 */
type Variant = "lost" | "error" | "soon";

export function BrandIllustration({ variant = "lost", className }: { variant?: Variant; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 360 240" fill="none" aria-hidden="true" focusable="false">
      {/* a faint ground line */}
      <path d="M20 205h320" stroke="var(--border-subtle)" strokeWidth="2" strokeLinecap="round" />

      {/* the open book */}
      <g stroke="var(--fg-strong)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M180 92v108" />
        <path d="M180 92C158 76 120 74 96 86v102c24-12 62-10 84 12" />
        <path d="M180 92c22-16 60-18 84-6v102c-24-12-62-10-84 12" />
      </g>

      {variant === "lost" && (
        <>
          {/* a path that wanders off the edge of the page, with milestone dots */}
          <path d="M264 86c28-6 44-30 58-52" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 12" />
          <circle cx="322" cy="34" r="8" fill="var(--surface-1)" stroke="var(--accent)" strokeWidth="5" />
          <circle cx="288" cy="76" r="5" fill="var(--accent)" />
          <path d="M60 60c14-10 28-10 42 0" stroke="var(--border-strong)" strokeWidth="4" strokeLinecap="round" />
          <path d="M48 84c10-7 22-7 32 0" stroke="var(--border-strong)" strokeWidth="4" strokeLinecap="round" />
        </>
      )}

      {variant === "error" && (
        <>
          {/* the same path, interrupted */}
          <path d="M264 86c18-4 32-16 42-32" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" />
          <path d="M318 40l16-16M334 40l-16-16" stroke="var(--fg-error)" strokeWidth="5" strokeLinecap="round" />
          <circle cx="288" cy="76" r="5" fill="var(--accent)" />
        </>
      )}

      {variant === "soon" && (
        <>
          {/* the rising line from the brand mark, still being drawn */}
          <path d="M214 76l26-28 22 18 40-46" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M290 28l14-2-4 14" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}
