# Backfilling real families

Launch checklist **3.3**: the tooling for loading real families must find duplicate and missing guardian-student links *before* anything
is written, and it must **never match people by name**. This document is the tool, the source shape, and the order the load happens in.

The load is a one-shot operation. A wrong guardian link does not show up as an error — it shows up as one family's parent opening
another child's progress page. So the check runs first, in public, and the load itself stays with scripts and screens a person watches.

## The rule

**People are matched by `externalId` only.** A name never links, merges or finds anyone. The checker enforces it in both directions:

- a row with no `externalId` is an error, not something to guess at;
- a student with no family is an error even when a family has the same surname — it reports `LOOKS_LIKE_FAMILY` and links nothing;
- two people with the same name are kept as two people and flagged for a human (`DUPLICATE_NAME`; for children, within one family,
  since a child is stored by first name only);
- an `externalId` must be the export's own opaque id. One that is an email address is refused (`ID_NOT_OPAQUE`), because the report
  quotes ids; do not use a name as an id either.

## Run it

```
npm run backfill:check --workspace=apps/web -- "C:\path\outside\the\repo\source.json"
```

The path is the argument. `--file <path>` and `--file=<path>` also work, but **the bare path is the form to use on Windows**: Windows
PowerShell 5.1 drops the `--` separator before npm sees it, npm then reads `--file` as one of its own options and passes only the path
through, so the flagged form fails there with "a source path is required" while the path sits unused. The bare path survives every shell.

Directly, without npm:

`node --import tsx scripts/backfill-check.mjs <source.json> [--strict] [--json]`

**No file yet?** Make one. This writes a complete, fictional, valid example to a path that does not exist yet, and never overwrites an
existing file:

```
npm run backfill:template --workspace=apps/web -- "C:\path\outside\the\repo\source.json"
```

Then run the check on it as it is (it says `LOADABLE`), and replace the example with the real export.

It **reads one file and writes nothing**: no database, no connection string, no key, no `--host`. That is deliberate — it cannot
half-load a project. `--strict` makes warnings fail as well (for CI or a nervous first run); `--json` prints one machine-readable report
with counts, codes and record ids only.

Exit codes: `0` loadable, `1` not loadable (or warnings under `--strict`), `2` usage or unreadable file, `3` refused. It refuses if the
file is **inside this repository**, because it holds real people's details.

The output names records as `students/S-31`, never a person, so a report can be filed or pasted without carrying personal data —
provided the ids themselves are opaque (above).

## The source shape

One JSON object, kept outside the repository:

```json
{
  "source": "tutorcruncher export, 1 November 2026",
  "tutors":      [{ "externalId": "T-104", "name": "…", "subjects": ["Maths"], "email": "…" }],
  "families":    [{ "externalId": "F-22", "name": "…", "email": "…" }],
  "students":    [{ "externalId": "S-31", "name": "first name only", "yearGroup": "Year 9", "familyExternalId": "F-22" }],
  "links":       [],
  "assignments": [{ "externalId": "A-9", "title": "…", "subject": "Maths", "tutorExternalId": "T-104", "studentExternalIds": ["S-31"] }],
  "lessons":     [{ "externalId": "L-7", "assignmentExternalId": "A-9", "startAt": "2026-11-20T16:00:00Z", "durationMinutes": 60, "locationType": "ONLINE" }]
}
```

**Guardians, as the database has them.** Every student belongs to exactly one owning family (`students.client_id`, which cannot be
empty), and that is `familyExternalId` — required. The owning family's guardian link (`client_students`) is written by a trigger when
the student is created, so it is not a separate row here; a `links` row naming the owning family is accepted and changes nothing.
`links` is for **second guardians only** — a second parent with their own account. The schema supports them, so they are not an error,
but each puts a child in front of another family, so each is a `SECOND_GUARDIAN` warning that the owning family must confirm.

**Families.** A family's `name` is the parent's display name on their login (there is no separate family-name column), and its `email`
is required: it is the parent's linked address, and their children's password resets go to it too. Tutors' `email` is required for the
same reason.

**Students** carry a first name or nickname only (`students.display_name`); a surname is flagged as `FULL_NAME` to drop before loading.

**Lessons** are optional. A lesson's students are its assignment's students, as the scheduling screen creates them, so a lesson names
none. `startAt` must carry its offset (`Z` or `+01:00`): a bare local time is ambiguous across the clock change. `locationType` is
`ONLINE` or `IN_PERSON` and is required, because it decides whether the lesson gets an online classroom; `location` is optional.

Every length and range is the database's own CHECK constraint, so a source that is `LOADABLE` goes in as written: names 80 characters,
year group 40, assignment title 200, subject 80, email 160, location 300, duration 5 to 600 minutes.

JSON rather than CSV is a decision, not an oversight: a spreadsheet export needs a column mapping, and column guessing is exactly where
an ambiguous link could hide. If the real export is CSV, export or convert it to this shape once, and check the conversion in — the
checker is the thing that catches a bad conversion.

### What stops a load

| Code | Why it is an error |
| --- | --- |
| `MISSING_FAMILY` / `UNKNOWN_FAMILY` | A student has no owning family, or one that is not in the source |
| `MISSING_ID` / `DUPLICATE_ID` | A row cannot be matched, or two rows claim the same identity |
| `ID_NOT_OPAQUE` | An id is an email address, which the report would then quote |
| `ORPHAN_LINK` | A second-guardian link names a student or family that is not in the source |
| `DUPLICATE_LINK` | The same link appears twice |
| `UNKNOWN_TUTOR` | An assignment names no tutor, or one that is not in the source |
| `ASSIGNMENT_EMPTY` / `ASSIGNMENT_UNKNOWN_STUDENT` / `ASSIGNMENT_DUPLICATE_STUDENT` | Nobody on it, a stranger on it, or a child twice |
| `LESSON_UNKNOWN_ASSIGNMENT` / `BAD_DATE` / `BAD_DURATION` / `BAD_LOCATION` | A lesson that cannot be scheduled as written |
| `MISSING_FIELD` / `TOO_LONG` | A value the database would refuse |
| `MISSING_EMAIL` / `BAD_EMAIL` | A tutor or parent with no address a password reset can reach |
| `SHAPE` | The file, a collection or a row is not the shape above |

### What a person reads

`SECOND_GUARDIAN`, `FULL_NAME`, `LOOKS_LIKE_FAMILY`, `DUPLICATE_NAME`, `FAMILY_NO_CHILDREN`, `TUTOR_NO_ASSIGNMENT`,
`STUDENT_NO_ASSIGNMENT`, `LESSON_IN_PAST`, `NO_SOURCE_NOTE`. None of them changes a record; each one is a decision someone should make
on purpose.

## The order the load happens in

The check does not load, and the loader is not written, because `public.provision_account` **creates the `clients` row** for a parent and
refuses if one already exists. So a family comes into being when its account is made, not before:

1. **Check the source** with this tool until it is loadable, and read every warning out loud to the owner.
2. **Staff first** (`scripts/create-account.mjs`, checklist 3.2.8): the four launch accounts, usernames agreed with each person.
3. **One family at a time, in the admin screens**: create the parent's account (which creates the family record), then each child's
   record under that family (which writes the guardian link), then the assignment. Every step is audited and visible, which is the
   point of not having a bulk loader.
4. **Second guardians are not loaded yet.** There is no admin screen that adds one: the schema allows it, but it is written only by the
   server after verification. Keep each `SECOND_GUARDIAN` finding on the family's sign-off record and add it when that path exists.
5. **Verify with them on a call** before the next family (9.3), and write down who checked which family.
6. **Upcoming lessons only.** Past lessons are records of teaching that already happened; they are not reconstructed as scheduling.

A bulk `--apply` is deliberately not built. It would need externalId bookkeeping to be safe to re-run, and the real export has not been
seen yet. The check is the part that must exist before any data is loaded; the loader can wait until the source is real.

## Source of truth (still the owners')

3.3 also asks who owns the data. The tool cannot decide this, and the checklist still needs an answer:

- **Which system is authoritative** for current tutors, families, students, assignments and upcoming lessons — TutorCruncher, a
  spreadsheet, or both in different places — and on what date the export was taken.
- **Who signs off** each family as correct, and where that record is kept.

Until that is written down, a source file has no provenance, which is why `file.source` is a warning: name the export and its date in
the file itself.

## Tests

`apps/web/tests/backfill.test.mjs` runs the checker without a database, one test or more for every code above, including the cases that
must never pass: a student with no family, a surname that looks like a family (reported, not linked), two identical names (kept
apart), a duplicate id, an email used as an id, values past the database's limits, and a report that carries no name or address. It
also runs the script itself: the template is valid whenever it is made and never overwrites a file, a file inside the repository is
refused, `--json` carries no names, and `--strict` fails on warnings.
