# Identity, guardians and learners

What this is: how a student gets a login of their own under a parent or guardian's account, how a guardian controls it, and the one
rule that decides who may do what. Built 2026-10-22 on `feature/production-completion`. Migration `0010_learner_identity.sql`.
Status words used below: **implemented**, **mock-tested** (in-memory store, fake Auth), **service-tested** (real local Supabase),
**production-enabled**. At the time of writing nothing here is service-tested (Docker would not start, see the ledger) and nothing is
production-enabled: the children's switch (`ASSISTANT_MINORS_APPROVED`) and the portal stay closed until their owners approve.

## The model

| Thing | Where | Notes |
| --- | --- | --- |
| Authenticated person | `auth.users` + `profiles` | Supabase Auth is the only identity provider. `profiles.role` is set by the server; sign-up metadata can never choose it |
| Guardian / paying customer | `profiles` (CLIENT) + `clients` | An adult with the 18+ declaration. Owns one family account |
| Student record | `students` | Unchanged: first name, year group, `is_minor`. **No email, no auth id.** One new column, `access_mode` |
| Guardian link | `client_students` | Now has `status` (active / suspended / revoked) and `can_view_progress`. Only `active` gives anything |
| Learner login | `learner_identities` | One profile ↔ one student, unique on both sides, status active / suspended / revoked. The profile's role is STUDENT |
| Invitation | `learner_invitations` | Single use, expiring, revocable, optionally tied to one email address. Only the SHA-256 of the token is stored |
| Supervised view | `supervised_contexts` | A guardian's session with one learner selected. Opaque cookie; only its hash is stored |
| Audit | `identity_audit` | Ids and actions only: never an email or a name |
| Consent | `consents` (kind `learner_ai_use`, `student_id`) | A guardian's agreement that a learner may use LearnThrive AI. Withdrawing closes it at once |

A learner **never** has a family account: a trigger refuses it from both sides (`learner_not_client`), and `ensureClient` refuses it
in code. So a learner cannot pay, open the billing portal or be treated as a newly declared adult customer.

Adults studying as adults are not a special case of the child model: an adult who is their own account holder is simply a guardian
account (their own family, their own student record if they are enrolled). An adult *learner* in someone else's family (`is_minor =
false`) logs in as a learner and needs neither the children's switch nor a guardian's consent for LearnThrive AI.

## Two ways in

1. **Own login (direct).** The guardian adds the student, then invites them. The server makes a token, shows the link **once** (it is
   not emailed by the app), and stores only its hash. The learner opens the link, makes an account (no adult declaration; if the
   invitation names an address it must be that one), confirms the email Supabase sends, opens the link again, and accepts. Accepting
   is one database transaction (`accept_learner_invitation`): spend the invitation, create the login, make the profile a STUDENT.
   Refusals (`used`, `revoked`, `expired`, `email_mismatch`, `not_eligible`, `invalid`) change nothing. A profile that owns a family,
   has any staff role, or is already a learner cannot be bound.
2. **Supervised view.** For a young child with no email address. The guardian signs in, sets the learner to *supervised*, and chooses
   "View as Kit". The actor stays the guardian; the effective learner is the student. Inside the view the account, billing and every
   guardian control are closed by the server (not just hidden); leaving needs the guardian's password (a fresh sign-in that must be
   the same account, with the same lockout as sign-in). A view ends when it expires (60 minutes), when the guardian leaves, or when the
   access mode or the link changes.

Who may have their own login is a conservative **staging default**: an adult always; a minor from Year 9 (`LEARNER_DIRECT_MIN_YEAR`,
default 9, about age 13, the UK age of digital consent); an unknown year group is supervised only. **The production age rule is the
owner's decision** and nothing here assumes it.

## The one eligibility decision

`resolveActor()` (`packages/data/src/library/actor.ts`) is pure and keyed off **live** state, so suspension, a revoked link or a
withdrawn consent closes the very next request even though the learner's access token is still valid. The page, chat, sessions,
files, papers, voice and the guard of every Library download use it (through `resolveRequestActor`, `accessFactsFor`).

LearnThrive AI for a learner needs all of: the login is active; the owning guardian link and the student record are active; the way in is
enabled (direct for own login, supervised for the view); the household or the learner holds a Library right; and, **for a minor**, the
deployment is approved for children (`ASSISTANT_MINORS_APPROVED`) **and** a guardian's agreement is open. The deployment switch
permits the deployment; it never replaces the per-learner checks. `adultConfirmed` stays only where it belongs: paying, the billing
portal, managing learners.

Tuition follows each learner's **own** enrolment (`ownTuition`), never a sibling's assignment. The household's Library benefit (the
family is enrolled, subscribed or granted) reaches every learner with an active link: the Library and LearnThrive AI, never the
sibling's lessons. Ending a tuition assignment does not remove a separately paid Library subscription.

## Who can see what

- A learner reads only their own conversations, files and papers. Every chat, file and paper call takes an **owner** (family *and*
  learner); a sibling, the guardian and another family find nothing, whatever id they guess. The same rule is in row level security
  (a chat with a `student_id` is server-only), because the server role bypasses RLS and the repositories scope too.
- **A guardian can delete a learner's conversations but cannot read them**, export them, or open them by id. (There is deliberately no
  permission for transcripts. If the owner decides a guardian may see summaries, that is a new, explicit permission.) The general
  restriction against admin access to children's chats is unchanged.
- `can_view_progress` on a guardian link is the permission for a learner's reports and progress. Tutor access follows assigned
  learners and the existing tutor rules.
- A learner sees their own student record and assignment, never the family account, subscriptions, consents or invoices.

## Routes

Guardian (adult account, not inside a supervised view): `GET/POST /api/learners`, `POST /api/learners/<id>/invite`, `…/access`
(`none` | `supervised`; `direct` only ever comes from an accepted invitation), `…/status`, `…/consent`, `…/chats/delete`,
`DELETE /api/learners/invitations/<id>`. Page: `/account/learners`.
Learner side: `POST /api/learner/invitation` (peek), `/signup`, `/accept`; supervised: `POST /api/learner/view`, `/view/leave`.
Page: `/learner/accept?token=…`.

## Settings

`LEARNER_INVITE_HOURS` (default 72, 1 to 336), `LEARNER_INVITES_PER_DAY` (default 5, 1 to 20 per student), `LEARNER_DIRECT_MIN_YEAR`
(default 9). Nothing secret. The supervised cookie is an opaque random token whose hash is in the database, so it needs no signing key.

## Not done / owner decisions

- The production age rule and the wording of the guardian consent (`LEARNER_CONSENT_TEXT`, version `1`) are drafts for the owner and the
  safeguarding lead. The deployment stays closed to children until `ASSISTANT_MINORS_APPROVED` is recorded.
- Invitation emails are not sent by the app (the link is shown once to the guardian). Sending through Resend is a small addition once
  the owner approves the wording.
- Staff-side suspension/revocation exists in the store (`setLearnerStatus` with no family) but has no admin screen yet.
- Orphans: deleting a student removes the login row and invitations but not the learner's `auth.users` / `profiles` row. A retention
  step that reports and removes those orphans, and the learner's stored chat files, is listed in `docs/RETENTION_AND_DELETION.md` work.
- Real Supabase Auth runs (invitation e-mail confirmation, refresh, the narrow server role) have not been executed yet.

## One shell (workstream 2)

The tuition dashboard and the Library, LearnThrive AI and account pages now share ONE frame, `PlatformShell` (`components/shell/PlatformShell.tsx`, rendering
`AppShellClient`): one sidebar, one top bar, one account menu, one mobile drawer, never nested. The old Library `MemberShell` is gone.

- **Capability navigation.** `platformNavigation()` (`lib/navigation/appNavigation.ts`) builds the menu from what the person may use (the `platformAccess`
  result plus whether LearnThrive AI and the Library are open), not from a role list. Rows of the target table are unit tests (`platformNavigation.test.mjs`).
  A person with the whole platform keeps a short sidebar (Library search is in the top-bar palette, the account in the account menu); a Library-only member
  or linked learner gets LearnThrive AI, Library, Search and Account; no entitlement gets Account only; inside a supervised view the menu is the learner's and
  there is no Account link. Hiding a link is never the control: every page and API checks again.
- **Secondary slot.** A page renders into the sidebar with `<SidebarSection>` (`components/shell/SidebarSlot.tsx`). LearnThrive AI's conversation history lives
  there. One slot element is moved between the desktop sidebar and the open drawer, so a page's state (an open search box) survives either.
- **Focused areas.** `/library/ai` takes the whole content column (`app-content--flush`) and owns its height under the top bar (and the
  supervised banner), so the box stays above a phone's keyboard and the page has one scroll.
- **Focus and keyboard.** The drawer returns focus to its button on Escape, the close button and the scrim; the skip link is first; covered by
  `one-sign-in.spec.ts` ("one shell, by keyboard alone").
- **Checked in a browser** (desktop and 390 px; guardian, enrolled learner, Library subscriber, linked learner): screenshots were inspected, and the
  Playwright runs (sign-in, LearnThrive AI, Paper Tutor, learner, dashboards, accessibility light/dark/zoom/keyboard) pass. Found and fixed on the way: a long
  name pushed the top bar wider than a 320 px screen; the chat list was squeezed beside a long menu (the slot now has a minimum height and the sidebar scrolls);
  the flush rule lost to a later media rule (specificity).
