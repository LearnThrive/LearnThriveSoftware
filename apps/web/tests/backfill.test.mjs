import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadTsFrom } from "./_tsLoader.mjs";

/**
 * Launch checklist 3.3: the backfill source checker. Pure, so every rule can be proved without a database — which is the point, because
 * the load it guards is a one-shot operation against real families.
 *
 * The property that matters most here is the negative one: a name NEVER links anyone. Several tests are written to fail if someone ever
 * "improves" the checker by matching on names.
 */
const { BACKFILL_RULE, LIMITS, checkSource, exampleSource, renderReport } = loadTsFrom(import.meta.url, "../src/lib/backfill/source.ts");
const NOW = new Date("2026-11-05T09:00:00.000Z");
const codes = (report) => report.findings.map((finding) => finding.code);
const has = (report, code) => codes(report).includes(code);

/** Fictional, tiny, and complete: one tutor, one family, one child, one assignment, one upcoming lesson. */
const valid = () => exampleSource(NOW);
const check = (source) => checkSource(source, NOW);

describe("backfill source checker", () => {
  test("the template is loadable and clean, and the counts are what would be written", () => {
    const report = check(valid());
    assert.deepEqual(codes(report), []);
    assert.equal(report.ok, true);
    assert.equal(report.clean, true);
    assert.deepEqual(report.counts, { tutors: 1, families: 1, students: 1, links: 1, secondGuardians: 0, assignments: 1, lessons: 1 });
  });

  test("the template stays valid whenever it is made: its lesson is always upcoming", () => {
    const later = new Date("2031-03-30T23:30:00.000Z");
    assert.deepEqual(codes(checkSource(exampleSource(later), later)), []);
  });

  describe("guardians, as the database has them", () => {
    test("the owning family is the link: no links row is needed, because the database writes it", () => {
      const source = valid();
      delete source.links;
      const report = check(source);
      assert.equal(report.clean, true);
      assert.equal(report.counts.links, 1);
    });

    test("a links row naming the owning family is accepted and changes nothing", () => {
      const source = valid();
      source.links = [{ studentExternalId: "S-1", familyExternalId: "F-1" }];
      const report = check(source);
      assert.equal(report.clean, true);
      assert.equal(report.counts.links, 1);
      assert.equal(report.counts.secondGuardians, 0);
    });

    test("a student with no owning family stops the load", () => {
      const source = valid();
      source.students[0].familyExternalId = "";
      const report = check(source);
      assert.ok(has(report, "MISSING_FAMILY"));
      assert.equal(report.ok, false);
      assert.equal(report.counts.links, 0);
    });

    test("an owning family that is not in the source stops the load", () => {
      const source = valid();
      source.students[0].familyExternalId = "F-9";
      const report = check(source);
      assert.ok(has(report, "UNKNOWN_FAMILY"));
      assert.equal(report.ok, false);
    });

    test("a surname shared with a family is reported and NOT linked", () => {
      const source = valid();
      source.families[0].name = "Jane Okafor";
      source.students[0].name = "Ada Okafor";
      source.students[0].familyExternalId = "";
      const report = check(source);
      // Both: an error (no family), and a warning pointing at the likely family, without linking it.
      assert.ok(has(report, "MISSING_FAMILY"));
      assert.ok(has(report, "LOOKS_LIKE_FAMILY"));
      assert.equal(report.ok, false);
      assert.equal(report.counts.links, 0, "nothing was linked by name");
    });

    test("a second guardian is allowed, counted, and flagged for a person to confirm", () => {
      const source = valid();
      source.families.push({ externalId: "F-2", name: "Parent Two", email: "parent.two@example.com" });
      source.links = [{ studentExternalId: "S-1", familyExternalId: "F-2" }];
      const report = check(source);
      assert.equal(report.ok, true);
      assert.ok(has(report, "SECOND_GUARDIAN"));
      assert.equal(has(report, "FAMILY_NO_CHILDREN"), false, "a second guardian's family has a child");
      assert.equal(report.counts.links, 2);
      assert.equal(report.counts.secondGuardians, 1);
    });

    test("a link to a student or family that is not in the source is an orphan", () => {
      const source = valid();
      source.links = [{ studentExternalId: "S-1", familyExternalId: "F-9" }, { studentExternalId: "S-9", familyExternalId: "F-1" }];
      const report = check(source);
      assert.equal(codes(report).filter((code) => code === "ORPHAN_LINK").length, 2);
      assert.equal(report.ok, false);
    });

    test("the same link twice is refused", () => {
      const source = valid();
      source.families.push({ externalId: "F-2", name: "Parent Two", email: "parent.two@example.com" });
      source.links = [{ studentExternalId: "S-1", familyExternalId: "F-2" }, { studentExternalId: "S-1", familyExternalId: "F-2" }];
      const report = check(source);
      assert.ok(has(report, "DUPLICATE_LINK"));
      assert.equal(report.counts.secondGuardians, 1);
      assert.equal(report.ok, false);
    });

    test("a link row with an id missing is refused", () => {
      const source = valid();
      source.links = [{ studentExternalId: "S-1" }];
      assert.ok(has(check(source), "MISSING_ID"));
    });
  });

  describe("ids", () => {
    test("a duplicate externalId is an error, and the counts do not pretend it is one row", () => {
      const source = valid();
      source.tutors.push({ externalId: "T-1", name: "Tutor One Again", email: "again@example.com" });
      source.lessons.push({ ...source.lessons[0] });
      const report = check(source);
      assert.equal(codes(report).filter((code) => code === "DUPLICATE_ID").length, 2);
      assert.equal(report.counts.tutors, 1);
      assert.equal(report.counts.lessons, 1);
      assert.equal(report.ok, false);
    });

    test("a row with no externalId is an error, lessons included: nothing is matched by name instead", () => {
      const source = valid();
      delete source.tutors[0].externalId;
      delete source.lessons[0].externalId;
      const report = check(source);
      assert.deepEqual(report.findings.filter((f) => f.code === "MISSING_ID").map((f) => f.subject), ["tutors row 1", "lessons row 1"]);
      assert.equal(report.ok, false);
    });

    test("an email address used as an id is refused, and the report does not quote it", () => {
      const source = valid();
      source.families[0].externalId = "parent.one@example.com";
      const report = check(source);
      assert.ok(has(report, "ID_NOT_OPAQUE"));
      assert.equal(renderReport(report).includes("parent.one@example.com"), false);
    });
  });

  describe("values the database or the admin screens would refuse", () => {
    test("a tutor or a parent with no email, or a bad one, is refused: password resets go there", () => {
      const source = valid();
      delete source.tutors[0].email;
      source.families[0].email = "not an address";
      const report = check(source);
      assert.ok(has(report, "MISSING_EMAIL"));
      assert.ok(has(report, "BAD_EMAIL"));
      assert.equal(report.ok, false);
    });

    test("a missing or over-long name, title or subject is refused", () => {
      const source = valid();
      source.tutors[0].name = "";
      source.families[0].name = "x".repeat(LIMITS.name + 1);
      source.students[0].yearGroup = "y".repeat(LIMITS.yearGroup + 1);
      source.assignments[0].title = "t".repeat(LIMITS.title + 1);
      source.assignments[0].subject = "";
      const report = check(source);
      const found = report.findings.map((f) => `${f.code} ${f.subject}`);
      for (const expected of ["MISSING_FIELD tutors/T-1", "TOO_LONG families/F-1", "TOO_LONG students/S-1", "TOO_LONG assignments/A-1", "MISSING_FIELD assignments/A-1"]) {
        assert.ok(found.includes(expected), expected);
      }
    });

    test("tutor subjects must be strings", () => {
      const source = valid();
      source.tutors[0].subjects = "Maths";
      assert.ok(has(check(source), "SHAPE"));
    });
  });

  describe("assignments", () => {
    test("an unknown tutor, or nobody on it, is refused", () => {
      const source = valid();
      source.assignments[0] = { ...source.assignments[0], tutorExternalId: "T-9", studentExternalIds: [] };
      const report = check(source);
      assert.ok(has(report, "UNKNOWN_TUTOR"));
      assert.ok(has(report, "ASSIGNMENT_EMPTY"));
      assert.equal(report.ok, false);
    });

    test("a student who is not in the source, or the same student twice, is refused", () => {
      const source = valid();
      source.assignments[0].studentExternalIds = ["S-1", "S-1", "S-404"];
      const report = check(source);
      assert.ok(has(report, "ASSIGNMENT_UNKNOWN_STUDENT"));
      assert.ok(has(report, "ASSIGNMENT_DUPLICATE_STUDENT"));
      assert.equal(report.ok, false);
    });
  });

  describe("lessons", () => {
    test("no assignment, a bad date, a bad duration or no location type is refused", () => {
      const source = valid();
      source.lessons = [{ externalId: "L-1", assignmentExternalId: "A-9", startAt: "next Tuesday", durationMinutes: 0 }];
      const report = check(source);
      for (const code of ["LESSON_UNKNOWN_ASSIGNMENT", "BAD_DATE", "BAD_DURATION", "BAD_LOCATION"]) assert.ok(has(report, code), code);
      assert.equal(report.ok, false);
    });

    test("the duration follows the database's own limits", () => {
      for (const [minutes, ok] of [[4, false], [5, true], [600, true], [601, false], [60.5, false]]) {
        const source = valid();
        source.lessons[0].durationMinutes = minutes;
        assert.equal(has(check(source), "BAD_DURATION"), !ok, `${minutes} minutes`);
      }
    });

    test("a time without an offset is refused: it is ambiguous across the clock change", () => {
      for (const [startAt, ok] of [["2026-11-20T16:00:00", false], ["2026-11-20", false], ["2026-11-20T16:00:00Z", true], ["2026-11-20T16:00:00+01:00", true]]) {
        const source = valid();
        source.lessons[0].startAt = startAt;
        assert.equal(has(check(source), "BAD_DATE"), !ok, startAt);
      }
    });

    test("a lesson already in the past is a warning, so the plan can be trimmed deliberately", () => {
      const source = valid();
      source.lessons[0].startAt = "2020-01-01T10:00:00.000Z";
      const report = check(source);
      assert.ok(has(report, "LESSON_IN_PAST"));
      assert.equal(report.ok, true);
      assert.equal(report.clean, false, "a warning is still something a person must read");
    });

    test("lessons are optional", () => {
      const source = valid();
      delete source.lessons;
      assert.equal(check(source).clean, true);
    });
  });

  describe("warnings for a person", () => {
    test("a family with no children, and a tutor or student on no assignment", () => {
      const source = valid();
      source.families.push({ externalId: "F-2", name: "Parent Two", email: "parent.two@example.com" });
      source.tutors.push({ externalId: "T-2", name: "Tutor Two", email: "tutor.two@example.com" });
      source.students.push({ externalId: "S-2", name: "Sam", familyExternalId: "F-1" });
      const report = check(source);
      for (const code of ["FAMILY_NO_CHILDREN", "TUTOR_NO_ASSIGNMENT", "STUDENT_NO_ASSIGNMENT"]) assert.ok(has(report, code), code);
      assert.equal(report.ok, true);
    });

    test("a student's surname is flagged: only a first name or nickname is stored", () => {
      const source = valid();
      source.students[0].name = "Ada Okafor";
      const report = check(source);
      assert.ok(has(report, "FULL_NAME"));
      assert.equal(report.ok, true);
    });

    test("no provenance note is a warning", () => {
      const source = valid();
      delete source.source;
      assert.deepEqual(codes(check(source)), ["NO_SOURCE_NOTE"]);
    });

    test("two children of the same name in one family stay two children, and are flagged", () => {
      const source = valid();
      source.students.push({ externalId: "S-2", name: "Child", familyExternalId: "F-1" });
      source.assignments[0].studentExternalIds = ["S-1", "S-2"];
      const report = check(source);
      assert.equal(report.counts.students, 2);
      assert.ok(has(report, "DUPLICATE_NAME"));
      assert.equal(report.ok, true, "a shared name is for a person to check, not a reason to refuse");
    });

    test("children of the same first name in different families are not flagged", () => {
      const source = valid();
      source.families.push({ externalId: "F-2", name: "Parent Two", email: "parent.two@example.com" });
      source.students.push({ externalId: "S-2", name: "Child", familyExternalId: "F-2" });
      source.assignments[0].studentExternalIds = ["S-1", "S-2"];
      assert.equal(check(source).clean, true);
    });

    test("two families or tutors with the same name stay two, and are flagged", () => {
      const source = valid();
      source.families.push({ externalId: "F-2", name: "parent  one", email: "other@example.com" });
      source.students.push({ externalId: "S-2", name: "Kit", familyExternalId: "F-2" });
      source.assignments[0].studentExternalIds = ["S-1", "S-2"];
      const report = check(source);
      assert.deepEqual(report.findings.map((f) => `${f.code} ${f.subject}`), ["DUPLICATE_NAME families/F-2"]);
    });
  });

  test("a source that is not an object is refused with one clear finding", () => {
    for (const bad of [null, [], "rows", 7]) {
      const report = check(bad);
      assert.equal(report.ok, false);
      assert.deepEqual(codes(report), ["SHAPE"]);
    }
  });

  test("the report names records by id, never by name or address, and states the rule", () => {
    const source = valid();
    source.families.push({ externalId: "F-2", name: "Jane Okafor", email: "jane@example.com" });
    source.students.push({ externalId: "S-2", name: "Ada Okafor", familyExternalId: "" });
    source.links = [{ studentExternalId: "S-1", familyExternalId: "F-2" }];
    const report = check(source);
    const text = renderReport(report);
    assert.ok(text.includes(BACKFILL_RULE));
    assert.ok(text.includes("students/S-2"));
    for (const personal of ["Okafor", "Ada", "Jane", "Child", "Parent One", "Tutor One", "@example.com"]) {
      assert.equal(text.includes(personal), false, `the report carries "${personal}"`);
    }
    assert.ok(text.includes("NOT LOADABLE"));
  });
});

describe("backfill-check script", () => {
  const WEB = fileURLToPath(new URL("..", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "backfill-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...args) =>
    spawnSync(process.execPath, ["--import", "tsx", "scripts/backfill-check.mjs", ...args], {
      cwd: WEB,
      encoding: "utf8",
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT },
      timeout: 30_000,
    });

  test("the template is written once, checks as loadable, and is never overwritten", () => {
    const file = join(dir, "source.json");
    assert.equal(run(file, "--write-template").status, 0);
    const written = readFileSync(file, "utf8");
    const checked = run(file);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    assert.match(checked.stdout, /LOADABLE: no problems found/);
    assert.equal(run(file, "--write-template").status, 3);
    assert.equal(readFileSync(file, "utf8"), written);
  });

  test("a template into a folder that does not exist is a clear refusal, not a crash", () => {
    const result = run(join(dir, "missing", "source.json"), "--write-template");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /folder for that path does not exist/);
    assert.doesNotMatch(result.stderr, /^\s+at /m, "no stack trace");
  });

  test("a file inside the repository is refused before it is read", () => {
    const result = run("package.json");
    assert.equal(result.status, 3);
    assert.match(result.stderr, /outside this repository/);
  });

  test("a source that is not loadable exits 1; --json carries codes and ids, not names", () => {
    const file = join(dir, "bad.json");
    const source = exampleSource();
    source.students[0].familyExternalId = "";
    source.students[0].name = "Ada Okafor";
    writeFileSync(file, JSON.stringify(source));
    const result = run(file, "--json");
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.ok(report.findings.some((f) => f.code === "MISSING_FAMILY"));
    assert.equal(result.stdout.includes("Okafor"), false);
  });

  test("--strict fails on warnings", () => {
    const file = join(dir, "warned.json");
    const source = exampleSource();
    delete source.source;
    writeFileSync(file, JSON.stringify(source));
    assert.equal(run(file).status, 0);
    assert.equal(run(file, "--strict").status, 1);
  });

  test("unreadable JSON and a missing file exit 2", () => {
    const file = join(dir, "broken.json");
    writeFileSync(file, "{ not json");
    assert.equal(run(file).status, 2);
    assert.equal(run(join(dir, "absent.json")).status, 2);
  });
});
