import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// A tutor picks their subjects, an administrator assigns by subject, and a parent sees both. One rule decides whether a tutor teaches a
// subject, so the three cannot disagree (src/lib/subjects.ts).

const { TEACHING_SUBJECTS, canonicalSubject, tutorTeaches, withTickedSubjects } = loadTsFrom(import.meta.url, "../src/lib/subjects.ts");

test("the subjects we teach, and the older spellings that mean the same", () => {
  assert.deepEqual([...TEACHING_SUBJECTS], ["Maths", "English", "Science", "11+ Preparation"]);
  for (const text of ["Maths", "maths", " Mathematics ", "Further Maths"]) assert.equal(canonicalSubject(text), "Maths", text);
  for (const text of ["Biology", "Chemistry", "physics", "Combined  Science"]) assert.equal(canonicalSubject(text), "Science", text);
  for (const text of ["English", "English Literature"]) assert.equal(canonicalSubject(text), "English", text);
  for (const text of ["11+", "11 Plus", "Verbal Reasoning"]) assert.equal(canonicalSubject(text), "11+ Preparation", text);
  for (const text of ["Computer Science", "History", ""]) assert.equal(canonicalSubject(text), null, text);
});

test("a tutor who lists several subjects can be assigned any of them, and nothing else", () => {
  const tutor = ["Mathematics", "English"];
  assert.equal(tutorTeaches(tutor, "Maths"), true);
  assert.equal(tutorTeaches(tutor, "English"), true);
  assert.equal(tutorTeaches(tutor, "Science"), false);
  assert.equal(tutorTeaches(tutor, "History"), false, "a subject we do not offer is never assignable");
  assert.equal(tutorTeaches(["Biology"], "Science"), true, "Biology is Science");
});

test("a tutor with no subjects listed yet is not locked out", () => {
  assert.equal(tutorTeaches([], "Maths"), true);
});

test("ticking subjects keeps the tutor's own wording and anything we do not teach", () => {
  assert.deepEqual(withTickedSubjects(["Mathematics", "Computer Science"], ["Maths", "English"]), ["Mathematics", "Computer Science", "English"]);
  assert.deepEqual(withTickedSubjects(["Mathematics", "English"], ["English"]), ["English"], "an unticked subject is removed");
  assert.deepEqual(withTickedSubjects(["Biology"], ["Science"]), ["Biology"], "Biology already counts as Science");
  assert.deepEqual(withTickedSubjects([], ["Maths", "Science"]), ["Maths", "Science"]);
  assert.deepEqual(withTickedSubjects(["Maths"], ["Maths", "Maths"]), ["Maths"], "no duplicates");
});
