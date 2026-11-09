# Safeguarding records: tutor checks and the concern log

Added 9 November 2026 (migration `0022`, [improvement/PLAN.md](improvement/PLAN.md) items 3 and 4). This describes what the software does. It is not a safeguarding policy and it does not show that any legal duty is met: the policy, who the leads are, which checks are required and how long records are kept are the owners' decisions ([OWNER_ANSWERS_2026-11-07.md](OWNER_ANSWERS_2026-11-07.md) D1 to D8, E3 to E5).

## Tutor checks (the vetting register)

- **What it is.** One row each time an administrator *sees* a check for a tutor: DBS, identity, right to work, references, safeguarding training, the signed agreement. It holds the date seen, how it was seen ("Update Service"), an optional expiry date and who recorded it.
- **What it never holds.** A certificate number or a copy of a document. Text containing a 12-digit number is refused by the form, by the data layer and by a database check.
- **Where.** `/dashboard/admin/vetting` lists every active tutor against every check; each tutor's page (`/dashboard/admin/tutors/<id>`) has the card to record one. Administrators only. A tutor does not see their own record.
- **States.** Not recorded, seen, runs out soon (within 60 days), expired. The newest check of a kind is the current one. A mistake is removed with a reason and kept, not deleted.
- **It flags; it does not block.** A tutor with a missing or expired check can still be given lessons. Whether that should be stopped, which checks are required (the default flags a missing DBS check and safeguarding training: `DEFAULT_REQUIRED_VETTING`) and how often each is renewed are open decisions.
- **When a tutor leaves.** The rows are deleted with the tutor's record (a foreign key with cascade), so the purge needs nothing extra.

## The concern log

- **Raising.** A tutor or an administrator opens `/dashboard/concerns` ("Raise a concern" in the menu), says what it is about, who, and what they saw or heard, and whether someone may be in immediate danger. The page tells them to call 999 first in that case.
- **Who can read it.** Only the people whose account's **linked email** is listed in `SAFEGUARDING_LEAD_EMAILS`. Being an administrator is not enough. The person who raised it sees a reference (`SC-yyyymmdd-XXXXXX`) and a status afterwards, never the text again.
- **With no lead named, nothing is stored.** The form is replaced by the published contact route. A concern must never be saved where nobody will read it. This is the default: production has no leads until the owners set the variable.
- **Telling the leads.** Each lead is emailed that a concern is waiting, with the reference and whether immediate danger was ticked. The email carries no name and no detail. The concern is stored before the email is tried; if the email cannot be sent the person who raised it is told to contact the lead directly.
- **The record.** The concern's text cannot be edited and a concern cannot be deleted through the application: a database trigger refuses both. Only the status moves (waiting, being looked at, closed). Every opening by a lead, every refused attempt by anyone else, every status change and every note is appended to a history that the database will not let anyone change.
- **Kept when someone is purged.** A concern does not reference a student, lesson or account record, so removing a person leaves it as written. Safeguarding records are one of the three retention exceptions in [LAWFUL_BASES.md](LAWFUL_BASES.md). How long they are kept, and deleting one, is the safeguarding lead's decision and is done outside the application.

## How this sits with the owners' decision on case records

On 7 November the owners said case records are kept by the directors in a **separate restricted safeguarding store** (D8), with the system still to be named. This log is the *intake* (so that a tutor has one obvious place to report, and the report cannot be lost or quietly read by others) and a restricted record of what happened to it. It is not a case-management system: notes here should say what was done, and anything that belongs in the case file goes in the restricted store. If the owners prefer concerns never to be stored in the platform at all, leave `SAFEGUARDING_LEAD_EMAILS` unset: the page then shows only the contact route.

## Where the code is

| What | Where |
| --- | --- |
| Types, rules and who-may-read functions | `packages/data/src/safeguarding/` |
| Tables, the edit and delete guards | `supabase/migrations/0022_safeguarding.sql` |
| Backend choice, the leads list, the email notice | `apps/web/src/lib/safeguarding/runtime.ts` |
| Actions | `apps/web/src/lib/actions/safeguarding.ts` |
| Screens | `/dashboard/concerns`, `/dashboard/admin/concerns`, `/dashboard/admin/concerns/<id>`, `/dashboard/admin/vetting`, the card on a tutor's page |

## Tests

- `packages/data/src/testing/safeguardingContract.ts`, run on memory and on Postgres (PGlite): the vetting rules, and that the tutor who raised a concern, another administrator and a lead with an empty list are all refused, each refusal recorded.
- `packages/data/src/safeguardingSql.test.ts`: no API role can read or write the tables; the database refuses to edit or delete a concern, to change its history, or to store a certificate number.
- `apps/web/tests/safeguardingAccess.test.mjs`: nothing imports the records except the guarded pages and actions; no page reads a concern around the lead check; every action checks the caller first.
- `apps/web/tests-e2e/safeguarding.spec.ts`: in a browser, a tutor raises a concern, the named lead reads it, another administrator and a parent are refused, and the refusal shows in the history.

**Not tested:** the real Supabase stack (Docker was not running), and a real email through Resend.
