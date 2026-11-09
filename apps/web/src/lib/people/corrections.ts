import type { Student, Tutor } from "@learnthrive/data/domain";

/**
 * Putting a person's record right (docs/improvement/PLAN.md item 5). Pure: it works out what would change and refuses what the database
 * would refuse, so the action can update and write an audit entry that names the fields changed and nothing else.
 */
export type Correction<T> = { ok: true; patch: Partial<T>; fields: string[] } | { ok: false; message: string };

const NAME_MAX = 80; // students.display_name and tutors.display_name (migration 0001, 0011)
const YEAR_GROUP_MAX = 40;
const EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
const SUBJECTS_MAX = 20;
const SUBJECT_MAX = 60;

const clean = (value: string): string => value.trim().replace(/\s+/g, " ");

export function studentCorrection(current: Pick<Student, "name" | "yearGroup">, input: { name: string; yearGroup: string }): Correction<Student> {
  const name = clean(input.name);
  const yearGroup = clean(input.yearGroup);
  if (!name) return { ok: false, message: "A name is required." };
  if (name.length > NAME_MAX) return { ok: false, message: `The name is too long (${NAME_MAX} characters at most).` };
  if (yearGroup.length > YEAR_GROUP_MAX) return { ok: false, message: `The year group is too long (${YEAR_GROUP_MAX} characters at most).` };
  const patch: Partial<Student> = {};
  const fields: string[] = [];
  if (name !== current.name) { patch.name = name; fields.push("name"); }
  if (yearGroup !== (current.yearGroup ?? "")) { patch.yearGroup = yearGroup; fields.push("yearGroup"); }
  return { ok: true, patch, fields };
}

export function tutorCorrection(current: Pick<Tutor, "name" | "email" | "subjects">, input: { name: string; email: string; subjects: string }): Correction<Tutor> {
  const name = clean(input.name);
  const email = input.email.trim().toLowerCase();
  const subjects = [...new Set(input.subjects.split(",").map(clean).filter(Boolean))];
  if (!name) return { ok: false, message: "A name is required." };
  if (name.length > NAME_MAX) return { ok: false, message: `The name is too long (${NAME_MAX} characters at most).` };
  if (!EMAIL.test(email)) return { ok: false, message: "Enter one contact email address." };
  if (subjects.length > SUBJECTS_MAX || subjects.some((s) => s.length > SUBJECT_MAX)) return { ok: false, message: "List the subjects separated by commas (20 at most)." };
  const patch: Partial<Tutor> = {};
  const fields: string[] = [];
  if (name !== current.name) { patch.name = name; fields.push("name"); }
  if (email !== current.email.trim().toLowerCase()) { patch.email = email; fields.push("email"); }
  if (subjects.join("|") !== current.subjects.join("|")) { patch.subjects = subjects; fields.push("subjects"); }
  return { ok: true, patch, fields };
}
