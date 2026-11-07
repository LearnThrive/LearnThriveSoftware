/**
 * The backfill source checker (launch checklist 3.3, Phase 9.3). Real families are loaded once, and a wrong guardian link puts one
 * family's parent in front of another child's progress, so the source is read and checked before anything is written: no database, no
 * side effects, one report. The load itself stays with the operator scripts and the admin screens, so this cannot create a half-loaded
 * project.
 *
 * THE RULE: people are matched by `externalId` only. A name is never used to link, merge or find anyone — not as a fallback when an id
 * is missing, and not as a convenience when two rows look alike. A student with no family is an error even when exactly one family has
 * the same surname; the report says so rather than guessing.
 *
 * THE GUARDIAN MODEL, as the database has it (supabase/migrations/0001_core.sql):
 *   - every student belongs to exactly one owning family (`students.client_id`, not null). That is `familyExternalId`, and it is
 *     required. The owning family's `client_students` link is written by a trigger when the student is created, so it is never a
 *     separate row in the source: a `links` row naming the owning family is accepted and changes nothing.
 *   - `links` holds ADDITIONAL guardians only (a second parent with their own account). The schema supports them, so they are not an
 *     error, but each one puts a child in front of a second family, so each is a warning a person must confirm.
 *
 * Every limit below is the database's own (a CHECK constraint) or the admin screen's, so "LOADABLE" means the rows would go in as
 * written. The report never contains a name: every finding names a record by its kind and externalId (`students/S-31`), so the output
 * can be filed or pasted without carrying personal data — which is why an externalId that is an email address is refused.
 */
import { isPlainEmail } from "../forms-common";

export const BACKFILL_RULE = "People are matched by externalId only. A name never links, merges or finds anyone.";

/** The database's limits (0001_core.sql, 0011_tuition_domain.sql, 0017_username_accounts.sql), so a loadable row is an insertable row. */
export const LIMITS = {
  name: 80,
  yearGroup: 40,
  title: 200,
  subject: 80,
  email: 160,
  location: 300,
  durationMin: 5,
  durationMax: 600,
} as const;

export const LOCATION_TYPES = ["ONLINE", "IN_PERSON"] as const;

export type BackfillLevel = "error" | "warning";

export interface BackfillFinding {
  level: BackfillLevel;
  /** A stable code, so a re-run can be compared and a finding can be talked about without quoting a row. */
  code: string;
  /** The record, as `kind/externalId` (or `kind row N` when the id itself is the problem) — never a name. */
  subject: string;
  message: string;
}

export interface BackfillCounts {
  tutors: number;
  families: number;
  students: number;
  /** Distinct guardian links that would exist in `client_students`: one owning link per student, plus every second guardian. */
  links: number;
  /** Of `links`, those to a family other than the owning one. */
  secondGuardians: number;
  assignments: number;
  lessons: number;
}

export interface BackfillReport {
  /** False when any error is present: nothing should be loaded from this source. */
  ok: boolean;
  /** True when there is neither an error nor a warning. */
  clean: boolean;
  errors: number;
  warnings: number;
  counts: BackfillCounts;
  findings: BackfillFinding[];
}

const row = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const rows = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const words = (value: string): string[] => value.trim().toLowerCase().split(/\s+/).filter(Boolean);
/** How two names are compared for the "these look alike" warnings, and only for those. */
const nameKey = (value: string): string => words(value).join(" ");
/** An ISO 8601 date and time WITH an offset: a lesson time without one is ambiguous across the clock change. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

type Report = (code: string, subject: string, message: string) => void;

/**
 * Indexes one collection by externalId, reporting a row that has none, repeats one, or uses an email address as one. A row without an
 * externalId cannot be matched safely, so it is an error rather than something to work around.
 */
function index(kind: string, value: unknown, fail: Report): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  rows(value).forEach((entry, at) => {
    const subject = `${kind} row ${at + 1}`;
    const item = row(entry);
    if (!item) {
      fail("SHAPE", subject, "Every row must be an object.");
      return;
    }
    const id = text(item.externalId);
    if (!id) {
      fail("MISSING_ID", subject, "externalId is required: it is the only thing a row is matched by.");
      return;
    }
    if (id.includes("@")) {
      // Named by row, not by id: quoting this id would put the address in the report.
      fail("ID_NOT_OPAQUE", subject, "externalId looks like an email address. Use the export's own opaque id: the report quotes ids.");
      return;
    }
    if (byId.has(id)) {
      fail("DUPLICATE_ID", `${kind}/${id}`, "This externalId appears twice in the source.");
      return;
    }
    byId.set(id, item);
  });
  return byId;
}

/** A required single-line field with a maximum length, checked the way the database's CHECK constraint would. */
function requireText(item: Record<string, unknown>, field: string, max: number, subject: string, fail: Report): string {
  const value = text(item[field]);
  if (!value) fail("MISSING_FIELD", subject, `${field} is required.`);
  else if (value.length > max) fail("TOO_LONG", subject, `${field} is longer than ${max} characters.`);
  return value;
}

/** Tutors' and parents' email is required: it is the login's linked address, and a child's password resets go to the parent's. */
function requireEmail(item: Record<string, unknown>, subject: string, fail: Report): void {
  const email = text(item.email).toLowerCase();
  if (!email) fail("MISSING_EMAIL", subject, "email is required: password resets go to it (a child's go to the parent's).");
  else if (email.length > LIMITS.email || !isPlainEmail(email)) fail("BAD_EMAIL", subject, "email is not a valid email address.");
}

function finish(findings: BackfillFinding[], counts: BackfillCounts): BackfillReport {
  const errors = findings.filter((finding) => finding.level === "error").length;
  const warnings = findings.length - errors;
  return { ok: errors === 0, clean: errors === 0 && warnings === 0, errors, warnings, counts, findings };
}

/**
 * Checks a parsed source (the JSON the operator exported) and returns everything wrong with it. Pure: same input, same report.
 * `now` is a parameter so "this lesson is in the past" is testable without waiting for a clock.
 */
export function checkSource(raw: unknown, now: Date = new Date()): BackfillReport {
  const findings: BackfillFinding[] = [];
  const fail: Report = (code, subject, message) => findings.push({ level: "error", code, subject, message });
  const warn: Report = (code, subject, message) => findings.push({ level: "warning", code, subject, message });
  const counts: BackfillCounts = { tutors: 0, families: 0, students: 0, links: 0, secondGuardians: 0, assignments: 0, lessons: 0 };

  const source = row(raw);
  if (!source) {
    fail("SHAPE", "file", "The source must be a JSON object holding tutors, families, students and assignments arrays.");
    return finish(findings, counts);
  }

  for (const key of ["tutors", "families", "students", "assignments"] as const) {
    if (!Array.isArray(source[key])) fail("SHAPE", `file.${key}`, `${key} must be an array (an empty one is allowed).`);
  }
  for (const key of ["links", "lessons"] as const) {
    if (source[key] !== undefined && !Array.isArray(source[key])) fail("SHAPE", `file.${key}`, `${key}, when present, must be an array.`);
  }
  if (!text(source.source)) {
    warn("NO_SOURCE_NOTE", "file.source", "Say which export this is and when (file.source), so the loaded data has a provenance note.");
  }

  const tutors = index("tutors", source.tutors, fail);
  const families = index("families", source.families, fail);
  const students = index("students", source.students, fail);
  const assignments = index("assignments", source.assignments, fail);
  const lessons = index("lessons", source.lessons, fail);
  counts.tutors = tutors.size;
  counts.families = families.size;
  counts.students = students.size;
  counts.assignments = assignments.size;
  counts.lessons = lessons.size;

  for (const [id, item] of tutors) {
    requireText(item, "name", LIMITS.name, `tutors/${id}`, fail);
    requireEmail(item, `tutors/${id}`, fail);
    if (item.subjects !== undefined && !(Array.isArray(item.subjects) && item.subjects.every((value) => typeof value === "string"))) {
      fail("SHAPE", `tutors/${id}`, "subjects, when present, must be an array of strings.");
    }
  }
  // A family's name is the parent's display name on their login: there is no separate family-name column.
  for (const [id, item] of families) {
    requireText(item, "name", LIMITS.name, `families/${id}`, fail);
    requireEmail(item, `families/${id}`, fail);
  }

  /** student -> owning family, for students whose owning family is in the source. */
  const ownerOf = new Map<string, string>();
  for (const [id, item] of students) {
    const name = requireText(item, "name", LIMITS.name, `students/${id}`, fail);
    if (words(name).length > 1) {
      warn("FULL_NAME", `students/${id}`, "A student's name is loaded as a first name or nickname only (students.display_name): drop the surname.");
    }
    if (text(item.yearGroup).length > LIMITS.yearGroup) fail("TOO_LONG", `students/${id}`, `yearGroup is longer than ${LIMITS.yearGroup} characters.`);

    const owner = text(item.familyExternalId);
    if (!owner) {
      fail("MISSING_FAMILY", `students/${id}`, "familyExternalId is required: every student belongs to exactly one owning family.");
      // The one place a name is ever compared to a family, and it decides nothing: it points a person at a likely row and says it was
      // not linked. Only possible when the export carries a surname, which FULL_NAME then asks to drop before loading.
      const surname = words(name).length > 1 ? words(name).at(-1) ?? "" : "";
      if (surname.length >= 2) {
        for (const [familyId, family] of families) {
          if (words(text(family.name)).at(-1) === surname) {
            warn(
              "LOOKS_LIKE_FAMILY",
              `students/${id}`,
              `Shares a surname with families/${familyId}, but it was NOT linked: names are never used to match. Set familyExternalId.`,
            );
          }
        }
      }
    } else if (!families.has(owner)) {
      fail("UNKNOWN_FAMILY", `students/${id}`, `familyExternalId "${owner}" is not in families.`);
    } else {
      ownerOf.set(id, owner);
    }
  }

  // Additional guardians. The owning link is not read from here: the database writes it when the student is created.
  const seen = new Set<string>();
  const extra = new Set<string>();
  rows(source.links).forEach((entry, at) => {
    const subject = `links row ${at + 1}`;
    const item = row(entry);
    if (!item) {
      fail("SHAPE", subject, "Every row must be an object.");
      return;
    }
    const student = text(item.studentExternalId);
    const family = text(item.familyExternalId);
    if (!student || !family) {
      fail("MISSING_ID", subject, "studentExternalId and familyExternalId are both required.");
      return;
    }
    const known = students.has(student) && families.has(family);
    if (!students.has(student)) fail("ORPHAN_LINK", subject, `Names student "${student}", which is not in students.`);
    if (!families.has(family)) fail("ORPHAN_LINK", subject, `Names family "${family}", which is not in families.`);
    const key = `${student}\u0000${family}`;
    if (seen.has(key)) {
      fail("DUPLICATE_LINK", `students/${student}`, `The link to families/${family} appears twice.`);
      return;
    }
    seen.add(key);
    if (!known || ownerOf.get(student) === family || !ownerOf.has(student)) return;
    extra.add(key);
    warn(
      "SECOND_GUARDIAN",
      `students/${student}`,
      `families/${family} would see this child as a second guardian. Confirm it with families/${ownerOf.get(student)} before it is added; there is no admin screen for it yet.`,
    );
  });
  counts.secondGuardians = extra.size;
  counts.links = ownerOf.size + extra.size;

  const usedFamilies = new Set<string>(ownerOf.values());
  for (const key of extra) usedFamilies.add(key.split("\u0000")[1]);
  for (const [id] of families) {
    if (!usedFamilies.has(id)) warn("FAMILY_NO_CHILDREN", `families/${id}`, "No student belongs to this family: it will load with no children.");
  }

  const taught = new Set<string>();
  const enrolled = new Set<string>();
  for (const [id, item] of assignments) {
    const subject = `assignments/${id}`;
    const tutor = text(item.tutorExternalId);
    if (!tutor) fail("UNKNOWN_TUTOR", subject, "tutorExternalId is required.");
    else if (!tutors.has(tutor)) fail("UNKNOWN_TUTOR", subject, `tutorExternalId "${tutor}" is not in tutors.`);
    else taught.add(tutor);

    if (item.studentExternalIds !== undefined && !Array.isArray(item.studentExternalIds)) {
      fail("SHAPE", subject, "studentExternalIds must be an array.");
    }
    const studentIds = rows(item.studentExternalIds).map(text).filter((value) => value !== "");
    if (studentIds.length === 0) fail("ASSIGNMENT_EMPTY", subject, "An assignment needs at least one student.");
    const onThis = new Set<string>();
    for (const student of studentIds) {
      if (onThis.has(student)) fail("ASSIGNMENT_DUPLICATE_STUDENT", subject, `student "${student}" is listed twice.`);
      onThis.add(student);
      if (!students.has(student)) fail("ASSIGNMENT_UNKNOWN_STUDENT", subject, `student "${student}" is not in students.`);
      else enrolled.add(student);
    }
    requireText(item, "title", LIMITS.title, subject, fail);
    requireText(item, "subject", LIMITS.subject, subject, fail);
  }

  // A lesson's students are its assignment's students (that is how the scheduling screen creates one), so a lesson names no students.
  for (const [id, item] of lessons) {
    const subject = `lessons/${id}`;
    const assignment = text(item.assignmentExternalId);
    if (!assignment) fail("LESSON_UNKNOWN_ASSIGNMENT", subject, "assignmentExternalId is required.");
    else if (!assignments.has(assignment)) fail("LESSON_UNKNOWN_ASSIGNMENT", subject, `assignmentExternalId "${assignment}" is not in assignments.`);

    const when = text(item.startAt);
    const at = ISO_INSTANT.test(when) ? Date.parse(when) : Number.NaN;
    if (Number.isNaN(at)) {
      fail("BAD_DATE", subject, 'startAt must be an ISO date and time with its offset, for example "2026-11-20T16:00:00Z" or "2026-06-20T17:00:00+01:00".');
    } else if (at < now.getTime()) {
      warn("LESSON_IN_PAST", subject, "This lesson is in the past: only upcoming lessons are loaded as scheduling.");
    }
    const duration = item.durationMinutes;
    if (typeof duration !== "number" || !Number.isInteger(duration) || duration < LIMITS.durationMin || duration > LIMITS.durationMax) {
      fail("BAD_DURATION", subject, `durationMinutes must be a whole number from ${LIMITS.durationMin} to ${LIMITS.durationMax}.`);
    }
    if (!(LOCATION_TYPES as readonly string[]).includes(text(item.locationType))) {
      fail("BAD_LOCATION", subject, 'locationType must be "ONLINE" or "IN_PERSON": it decides whether the lesson gets an online classroom.');
    }
    if (text(item.location).length > LIMITS.location) fail("TOO_LONG", subject, `location is longer than ${LIMITS.location} characters.`);
  }

  for (const [id] of tutors) {
    if (!taught.has(id)) warn("TUTOR_NO_ASSIGNMENT", `tutors/${id}`, "No assignment names this tutor: they will see no students.");
  }
  for (const [id] of students) {
    if (!enrolled.has(id)) warn("STUDENT_NO_ASSIGNMENT", `students/${id}`, "No assignment names this student: their family will see no lessons.");
  }

  // Two people with the same name are two people: a warning for a human to read, never a merge and never a link. Students carry a
  // first name only, so theirs are compared within one family, where two of the same name usually means one child entered twice.
  const sameName = (kind: string, collection: Iterable<[string, Record<string, unknown>]>, scope: (id: string) => string) => {
    const firstSeen = new Map<string, string>();
    for (const [id, item] of collection) {
      const key = nameKey(text(item.name));
      if (!key) continue;
      const scoped = `${scope(id)}\u0000${key}`;
      const first = firstSeen.get(scoped);
      if (first) warn("DUPLICATE_NAME", `${kind}/${id}`, `Shares a name with ${kind}/${first}. They are kept separate: confirm they are different people.`);
      else firstSeen.set(scoped, id);
    }
  };
  sameName("tutors", tutors, () => "");
  sameName("families", families, () => "");
  sameName("students", students, (id) => ownerOf.get(id) ?? "");

  return finish(findings, counts);
}

/** The report as the operator reads it: counts, then errors, then warnings, then one verdict line. */
export function renderReport(report: BackfillReport): string {
  const { counts } = report;
  const lines = [
    BACKFILL_RULE,
    "",
    `Tutors ${counts.tutors}, families ${counts.families}, students ${counts.students}, guardian links ${counts.links} (${counts.secondGuardians} second guardian(s)), assignments ${counts.assignments}, lessons ${counts.lessons}.`,
  ];
  for (const level of ["error", "warning"] as const) {
    const list = report.findings.filter((finding) => finding.level === level);
    if (list.length === 0) continue;
    lines.push("", level === "error" ? `${list.length} problem(s) that stop the load:` : `${list.length} thing(s) for a person to check:`);
    for (const finding of list) lines.push(`  ${finding.code.padEnd(28)} ${finding.subject}: ${finding.message}`);
  }
  lines.push(
    "",
    report.ok
      ? report.clean
        ? "LOADABLE: no problems found."
        : "LOADABLE, once the warnings above have been read by a person."
      : "NOT LOADABLE: fix the problems above and run this again.",
  );
  return lines.join("\n");
}

/**
 * A complete, fictional, valid source: what `--write-template` writes, and what the tests start from. The lesson is two weeks after
 * `now`, so the template stays valid whenever it is made.
 */
export function exampleSource(now: Date = new Date()): Record<string, unknown> {
  const lesson = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  lesson.setUTCHours(16, 0, 0, 0);
  return {
    source: "example, replace with the real export and the date it was taken",
    tutors: [{ externalId: "T-1", name: "Tutor One", subjects: ["Maths"], email: "tutor.one@example.com" }],
    families: [{ externalId: "F-1", name: "Parent One", email: "parent.one@example.com" }],
    students: [{ externalId: "S-1", name: "Child", yearGroup: "Year 9", familyExternalId: "F-1" }],
    links: [],
    assignments: [{ externalId: "A-1", title: "Maths", subject: "Maths", tutorExternalId: "T-1", studentExternalIds: ["S-1"] }],
    lessons: [
      { externalId: "L-1", assignmentExternalId: "A-1", startAt: lesson.toISOString(), durationMinutes: 60, locationType: "ONLINE" },
    ],
  };
}
