# The safeguarding agreement: approving it, and reconfirming it every year

For the owners. The agreement is a document tutors must read and agree to when they apply, and then **reconfirm every year, and whenever a new version is issued**. There is no login and no database, so this page explains how that works in practice, and the part that stays manual: matching each reconfirmation against your own list of tutors.

## 1. Opening the agreement to the public (approving it)

The application form, the reconfirmation page and their routes are **closed** until you approve the wording. The pages say so (the agreement page is marked as a draft and kept out of search engines and the sitemap) and the routes refuse submissions. To open them:

1. Read the whole agreement at `/careers/safeguarding-agreement`. The full text is also in `docs/CAREERS_COMPLETION_REPORT.md`, with the clauses that go beyond the rules you confirmed listed separately so that you can approve or remove each one.
2. In `apps/web/src/lib/safeguarding-agreement-v1.ts`, change each clause you approve to `ownerApproved: true`, and delete or reword any you do not. Set the version date if it should change.
3. When **every** clause is approved, set `agreementApprovedByOwner: true` in `apps/web/src/lib/careers-config.ts`. A test (`tests/safeguardingAgreement.test.mjs`) fails the build if that flag is true while any clause is still unapproved, so a half-approved agreement cannot go live.
4. Record the published hash. Run `npm test`; or compute it with `agreementHash(currentAgreement)` from `src/lib/agreement-record.ts`. Put the value in `publishedHash` in the version file. From then on a test fails if anyone edits that version in place.
5. Deploy. Then send a test application and a test reconfirmation end to end ([RENDER.md](RENDER.md)).

**Take advice** before you rely on it, in particular on: whether a typed name is strong enough as a record (it is a simple electronic confirmation), whether to ask a tutor to sign again by another route when the full tutor agreement is signed, and whether you are entitled to request an Enhanced DBS check with the Children's Barred List for self-employed online tutors (and through which route).

## 2. The yearly reconfirmation

Each reconfirmation arrives as an email to the careers address (`CAREERS_EMAIL`, falling back to the enquiry address, then `info@`), with:

- a reference, `LT-RECONF-<date>-<six characters>`;
- the subject `Safeguarding reconfirmation: <name> - <version> - <reference>`, with `[CHANGE DECLARED]` in front when the tutor said something has changed;
- the tutor's name and email, the version, the name they typed, the parts and clauses confirmed, the time it was received (server time, UTC), and a SHA-256 hash of the exact agreement text they were shown.

The tutor gets a short confirmation email with the same record. The visitor's address is not recorded.

**The page cannot check who the person is.** Anyone could submit it. The submission proves what was agreed, to which version, by the name typed and when. It is up to you to match it to a real tutor.

### A simple yearly process

1. Keep a spreadsheet of tutors with: name, email on file, date they started, **date and version last confirmed**, the reference of that reconfirmation, and notes.
2. A few weeks before each tutor's anniversary, email them the link to `/safeguarding/reconfirm` (it is not in the menu or the sitemap and is not indexed; it is linked only from the agreement page). Set and state a deadline yourselves; **do not publish one on the website**.
3. When a submission arrives, check it against the list: the name matches a tutor, the email matches the one on file, the version is the current one, and the typed name matches the name given. Then record the date, version and reference in the spreadsheet and label the email (for example "Reconfirmed 2026").
4. Chase anyone overdue. The agreement (clause G2, a proposed clause until you approve it) says a tutor must stop teaching until they have reconfirmed.
5. If a submission is marked **CHANGE DECLARED**, treat it as urgent: contact the tutor directly and immediately, and follow your safeguarding procedure. The tutor is told on the page and in their email to contact the safeguarding lead, but do not rely on that.
6. Keep every reconfirmation email while the tutor works with LearnThrive and for **6 years** after. A record linked to a safeguarding concern is kept longer, separately and with restricted access ([RETENTION_AND_DELETION.md](RETENTION_AND_DELETION.md)).

## 3. When the wording changes

A published version is never edited. To change the agreement:

1. Copy `safeguarding-agreement-v1.ts` to `safeguarding-agreement-v2.ts`, change the wording and the version string (`"2.0"`), and mark any new or changed clause `ownerApproved: false` until you have approved it.
2. Add it to the registry in `safeguarding-agreement.ts` and make it the current version. Keep version 1 in the repository: it is the record of what people agreed to.
3. Approve, record the hash and deploy as in section 1.
4. **Every active tutor must reconfirm.** Set a deadline and send the link, as above. Applications in progress against the old version are refused with a message to reload.

## What the understanding check is

Six multiple-choice questions taken straight from the agreement, in the application. It is **not training** and must never be described as training: there is no training, and no refresher training, and the wording for both was removed from the site. All six must be right, there is no limit on tries, and nothing about attempts is stored. It is switched off for reconfirmation by default (`understandingCheck.reconfirmation` in `careers-config.ts`).
