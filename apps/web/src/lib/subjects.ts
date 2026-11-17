/**
 * The subjects LearnThrive teaches, and one rule for matching a tutor's subjects to an assignment's subject. Pure: the admin form, the
 * server action that creates an assignment and the tutor's own "My subjects" page all use it, so they cannot disagree.
 *
 * A tutor's subjects were free text (an administrator typed "Mathematics" or "Maths"), so matching is by meaning, not by spelling:
 * Mathematics and Maths are one subject, and Biology, Chemistry and Physics are Science.
 */
export const TEACHING_SUBJECTS = ["Maths", "English", "Science", "11+ Preparation"] as const;
export type TeachingSubject = (typeof TEACHING_SUBJECTS)[number];

const ALIASES: ReadonlyArray<readonly [RegExp, TeachingSubject]> = [
  [/^(maths?|mathematics|further maths|further mathematics)$/, "Maths"],
  [/^english( language| literature| language and literature)?$/, "English"],
  [/^(science|combined science|triple science|biology|chemistry|physics)$/, "Science"],
  [/^(11\+|11 plus|eleven plus|11\+ prep|11\+ preparation|verbal reasoning|non-verbal reasoning)$/, "11+ Preparation"],
];

/** The one of our subjects this text means, or null when it is something else (Computer Science, History...). */
export function canonicalSubject(text: string): TeachingSubject | null {
  const key = text.trim().toLowerCase().replace(/\s+/g, " ");
  return ALIASES.find(([pattern]) => pattern.test(key))?.[1] ?? null;
}

/**
 * May this tutor be assigned this subject? Yes if one of their subjects means the same thing. A tutor with NO subjects listed yet (an older
 * record, or one an administrator has not filled in) is not blocked: nothing says they cannot teach it, and refusing would strand them.
 */
export function tutorTeaches(tutorSubjects: readonly string[], subject: string): boolean {
  if (tutorSubjects.length === 0) return true;
  const wanted = canonicalSubject(subject);
  if (!wanted) return false;
  return tutorSubjects.some((s) => canonicalSubject(s) === wanted);
}

/**
 * A tutor's subjects after they tick their own: what they ticked, with the wording they already had kept (so "Mathematics" stays
 * "Mathematics" while Maths is ticked) and anything we do not teach from the list (their "Computer Science") left alone.
 */
export function withTickedSubjects(current: readonly string[], ticked: readonly TeachingSubject[]): string[] {
  const keep = current.filter((s) => {
    const canonical = canonicalSubject(s);
    return canonical === null || ticked.includes(canonical);
  });
  const have = new Set(keep.map(canonicalSubject).filter(Boolean));
  const added = ticked.filter((subject) => !have.has(subject));
  return [...new Set([...keep, ...added])];
}
