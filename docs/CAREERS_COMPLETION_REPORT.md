# Careers, safeguarding agreement and subject requests: completion report

**Date:** 9 October 2026  
**Branch:** `feature/careers` (the monorepo, `apps/web`)  
**Written to:** `CAREERS_PROMPT.md` (the authoritative brief) and `CAREERS_PLAN.md` (background; where the two differ, the prompt won).

`CAREERS_PLAN.md` and `CAREERS_PROMPT.md` both describe the standalone site at `D:\LearnThrive`. The work was done in this monorepo's `apps/web`, as you directed, with the brief's `src/...` paths mapped onto `apps/web/src/...`.

## 1. Where things stand

Everything the brief asks for is built and tested, with one deliberate exception: **online applications and reconfirmations are closed**, because the safeguarding agreement is a draft until you approve it.

- 6 of the agreement's 66 clauses restate a rule you confirmed and are marked approved. The other 60 are proposals (section 5).
- While `careersConfig.agreementApprovedByOwner` is `false` (the shipped value): the agreement page carries a draft notice and is kept out of the sitemap and search; `/careers/apply` and `/safeguarding/reconfirm` say they open soon and show no form; `POST /api/careers/apply` and `POST /api/safeguarding/reconfirm` answer 503 and send nothing; no page carries job-posting markup; the home page shows no recruitment band.
- The hub, the role pages, the applicant privacy notice, the subject-request form and the subject hero cards are live now. (The hero cards were later taken off `/subjects`, where they repeated each section's heading and carried a second link to the same page; they remain on each subject's own page. See `docs/UI_UX_COMPLETION_REPORT.md`.)

To open applications: approve or edit the proposals, set `agreementApprovedByOwner` to `true` in `apps/web/src/lib/careers-config.ts`, bump the agreement version date, set the production variables listed in `docs/DEPLOYMENT.md`, and run the probes in `docs/RENDER.md`. A test fails the build if the flag is `true` while any clause is still unapproved.

## 2. What was built

All of it is email-only: **no database, no file storage, no cookies or browser storage, no third-party requests, no new dependencies.**

### A careers section

| Route | What it is |
| --- | --- |
| `/careers` | The hub: who we are looking for, what to expect (self-employed, £10 an hour per student, hours depend on student availability, no formal training, progression being worked out), the seven hiring steps exactly as you set them, the open roles, safeguarding facts, how applications are judged, 13 applicant FAQs, and a closing call to action. Indexed, in the sitemap. |
| `/careers/[slug]` | One page per role: `maths-tutor`, `english-tutor`, `science-tutor`, `11-plus-tutor`, and `register-interest` (the general option, which is never a vacancy and never carries job-posting markup). Indexed, in the sitemap. |
| `/careers/apply` | The one-page application in eight sections, with CV, cover letter (typed or a file) and supporting-document uploads. Not indexed. Closed until the agreement is approved. |
| `/careers/privacy` | The applicant privacy notice: what is collected, why, who sees it, the providers (IONOS, Resend, Render), retention, rights. Indexed, in the sitemap. |
| `/careers/safeguarding-agreement` | The full agreement, read from the one source. A draft notice and no indexing until approved. |
| `/safeguarding/reconfirm` | The yearly reconfirmation page for existing tutors. Not indexed. Closed until the agreement is approved. |
| `POST /api/careers/apply` | Receives the application, validates it again from scratch, inspects each file, emails the hiring team with the files attached, then (only if that worked) emails the applicant a confirmation. |
| `POST /api/safeguarding/reconfirm` | Receives a reconfirmation and emails it. |
| `POST /api/subject-request` | Receives a subject request and emails it. |
| `POST /api/careers/challenge` | Issues the signed, expiring, one-use human-check challenge. |

The application form keeps answers in memory only, warns before the page is left with unsent work, shrinks large JPEG or PNG photographs in the browser before upload, shows an error summary that takes focus, and shows a live list of the eight sections as Complete, To do, Needs attention or Optional. Without JavaScript, the page offers the email route.

**The human check** is built here, not bought: a SHA-256 proof of work, solved in a Web Worker, signed with an HMAC (`CAPTCHA_SECRET`), expiring after 20 minutes and usable once, with a signed text-sum fallback where workers or `crypto.subtle` are missing. It sets no cookie, stores nothing and contacts no outside service. Difficulty is 17 bits (about a second on a mid-range phone, per `docs/RENDER.md`).

**Other protections:** an origin check, size-limited body reads, in-memory rate limits per visitor and per route, a honeypot and a minimum fill time, file inspection (signature sniffing; a PDF byte scan for scripts, launch actions and embedded files; a DOCX inspector for macros, embeddings, zip bombs and encryption), sanitised attachment names, escaped HTML in every email, logs that carry no personal data, and a fail-closed 503 in production when the email credentials or `CAPTCHA_SECRET` are missing.

### A hardened safeguarding agreement

- One source, versioned: `src/lib/safeguarding-agreement-v1.ts`, read through `src/lib/safeguarding-agreement.ts` by the page, both forms, both routes and the emails. A test fails if any other file repeats a clause or imports a version file directly.
- Seven parts, A to G, 66 clauses, written as exact first-person obligations with no hedging words (a test enforces it), terms defined once, and timings exact ("immediately", "the same day").
- A six-question understanding check on applications (not training; off for reconfirmations), with the correct answers in varied positions and all six needed.
- Applicants agree by ticking each part and typing their full name. The record in the email holds the version, the typed name, the parts and clause ids confirmed, the check result, the server time (UTC) and the SHA-256 of the exact agreement text. **The visitor's IP address is never recorded.**
- Once published, a version is frozen by a recorded hash; a change is a new version, and every tutor then reconfirms.

### The "Can't see your subject?" request

On `/subjects`, before the closing call to action: a subject list ending in "Other" (which reveals a text box without moving focus), a level, who is asking, an optional 500-character note with a warning not to include a child's name, and a separate, unticked box asking to be emailed if the subject becomes available. It promises no subject, date or number. See `docs/SUBJECT_REQUESTS.md`.

### The subject hero cards

One shared `SubjectHeroCard`, used on each subject's own page. One source of words (`subjectLandingPages` in `src/lib/site.ts`).

**Since this report was first written:** the card was also set in each subject section of `/subjects`, between the section's text and its photograph. The plan18 audit removed it from that page: it repeated the section's heading, stage range and description, and its "Explore Maths Tuition" link went to the same page as the section's own "Explore Maths in depth" link. Each section on `/subjects` now has the text, one link and the photograph; the 11+ panel sets its four areas beside its text. The card on each subject's own page is unchanged, and `tests-e2e/subjects-layout.spec.ts` (which replaced `subjects-hero-cards.spec.ts`) checks both.

### Supporting changes

- Footer: "Careers" in the Company column and "Applicant privacy" in the legal links. Command palette: Careers and the applicant privacy notice. About page: a link for tutors. Sitemap and Open Graph pages updated.
- Home page: a quiet "Teach with LearnThrive" band at the very end, shown only while applications are open and at least one real vacancy is open (so never in production today).
- Main privacy notice: applicants (with a link to `/careers/privacy`), subject requests (data, lawful basis, retention), and the providers by name. Cookie notice: the three forms and the human check.
- `LEGAL_REVIEW.md`: the stale "mailto draft" position corrected, the new data flows recorded, and the open legal questions listed.
- Docs: `RENDER.md`, `AGREEMENT_RECONFIRMATION.md`, `SUBJECT_REQUESTS.md`, `RETENTION_AND_DELETION.md`, and the variable table and checklists in `DEPLOYMENT.md`.

## 3. Config values and why

All in `apps/web/src/lib/careers-config.ts`; change a value there and the pages, forms and routes follow.

| Setting | Value | Why |
| --- | --- | --- |
| `acceptingApplications` | `true` | Master switch. Set `false` to close the form without touching other code. |
| `agreementApprovedByOwner` | `false` | Unapproved wording must never go live by accident. See section 1. |
| `understandingCheck` | applications `true`, reconfirmation `false` | A check at application proves the applicant read it; at yearly reconfirmation it would only be friction. |
| `talentPool` | enabled, 12 months | Your retention rule: 12 months if the separate, unticked box is ticked. |
| `unsuccessfulRetentionMonths` | 6 | Your rule. Identity documents are always deleted at 6 months for unsuccessful applicants. |
| `minimumAge` | 18 | A tutor works with children and is self-employed; asked as a yes/no, no date of birth collected. |
| `responseTime` | "We will reply within 5 working days." | Your rule. |
| CV and cover-letter file | 3 MB each, PDF or DOCX | Cautious until the Render request limit is measured (`docs/RENDER.md`). |
| Supporting documents | up to 5, 3 MB each, PDF, DOCX, JPG, JPEG or PNG | Certificates, results, identity documents. |
| Total upload | 12 MB (plus 512 KB for the fields) | Keeps one email within what mail providers accept. |
| Cover letter text / short answers | 4000 / 1500 characters; "why tutor" at least 80 | Enough to read, small enough to review. |
| Human check | 17 bits, 20 minute lifetime | Measured, not guessed (`docs/RENDER.md`). |
| Rate limits (per visitor / whole route, per hour) | apply 3 / 30; reconfirm 5 / 60; subject request 5 per 15 minutes / 120; challenge 40 per 15 minutes / 600 | A person applies once or twice; the whole-route cap stops a forged address flooding the mailbox. |
| Minimum fill time | apply 30 s, reconfirm 15 s, subject request 4 s (production only) | A script is faster than a person reading the form. |
| `hiringSteps` | the seven steps exactly as you set them | Only these steps are shown. |

Environment variables are in `docs/DEPLOYMENT.md`. The new ones: `CAREERS_EMAIL`, `SUBJECT_REQUEST_EMAIL`, `CAPTCHA_SECRET`, `CLIENT_IP_HEADER`, `TRUSTED_PROXY_HOPS`, and (development only, never production) `CAREERS_OPEN_FOR_TESTING`.

## 4. Owner-confirmation items, and the defaults chosen

| # | Item | Default chosen | Where to change |
| --- | --- | --- | --- |
| 1 | **Approve the safeguarding agreement** | Draft; forms closed | `agreementApprovedByOwner`; section 5 |
| 2 | **The 60 proposed clauses** | Shown as the draft, `ownerApproved: false` | `safeguarding-agreement-v1.ts` |
| 3 | Date a role went live (`postedDate`) | Unset, so no posting date on the page and no job-posting markup | `careers.ts` |
| 4 | Preferred extras ("nice to have") | None confirmed, so the section is left out | `careers.ts` |
| 5 | Equal-opportunities / adjustments wording | A short draft that promises nothing beyond a reply | `adjustmentsText` in `careers.ts` |
| 6 | Talent pool | On, 12 months, separate unticked box | `careersConfig.talentPool` |
| 7 | **Barred List entitlement** for these self-employed, online roles | Published as your rule; entitlement unverified | `LEGAL_REVIEW.md` item 1 |
| 8 | **DBS payment rule and "suitable certificate"** | LearnThrive pays unless the applicant holds a suitable certificate or chooses to pay. "Suitable" = Enhanced including the Children's Barred List, subscribed to the Update Service, and LearnThrive decides | `suitableCertificateText` in `careers.ts` |
| 9 | Lesson platform name | Google Meet removed; now "the lesson platform LearnThrive provides" | `legal-faqs.tsx` |
| 10 | Lawful bases for applications, agreement records, subject requests | Legitimate interests; consent for the "email me" box | `/careers/privacy`, `/privacy` |
| 11 | Typed-name strength | Ticks per part plus a typed full name; not a qualified electronic signature | section 10 |
| 12 | Identity documents arriving in a shared mailbox | Accepted; the form says not to upload a DBS certificate | `docs/RETENTION_AND_DELETION.md` |
| 13 | Retention periods (6 years for agreement records; ID documents while working plus 12 months) | As you set them | `docs/RETENTION_AND_DELETION.md` |
| 14 | What the form deliberately does not collect | Date of birth, photograph, nationality, marital status, health or disability information, and any criminal-record information (the DBS question is a status question only) | `careers-validation.ts` |
| 15 | Hosting facts: Render's request limit and client-address header | Cautious limits; address handling configurable | `docs/RENDER.md` |

## 5. The draft agreement

Generated from the data, not copied by hand, so it matches what the site shows and what the record hashes.

**Marked approved (6), each restating a rule you confirmed:** A1 (reporting to the safeguarding lead, Tahasin Hasan, or the deputy, Abdurrahman Mustafa), F1 (Enhanced DBS check including the Children's Barred List), F2 (identity, right-to-work and any other check), F4 (no teaching or contact until every check is complete), G1 (yearly reconfirmation) and G6 (the expectations form part of the tutor agreement).

**Proposals for you to approve, edit or remove (60), listed separately:** A2 to A10; B1 to B11; C1 to C10; D1 to D12; E1 to E6; F3, F5 to F9; G2 to G5, G7, G8. Every one of them is shown in the text below without the **[confirmed]** tag.

Version **1.0**, dated 9 October 2026. Draft: not yet approved or published.

SHA-256 of the canonical text: `60d4fbde329c3fd630799ed0b9b84b5b930f464fc0b7321a2bdb04076d170baa`

### Introduction

This agreement sets out what every LearnThrive tutor must do, and must never do, when working with children and young people. It is firm on purpose. Children’s safety comes before everything else.

Read every clause. You must agree to all of it to apply. If you do not understand any part, ask the safeguarding lead before you agree. These expectations then become part of the tutor agreement you sign if you are offered work.

### Definitions

- **Student**: Any person I teach, or am asked to teach, through LearnThrive.
- **Family**: A student’s parent, guardian or any other family member.
- **LearnThrive channels**: The lesson platform, and the communication routes, that LearnThrive provides or approves in writing. Nothing else counts.
- **Contact**: Any communication of any kind: voice, video, text, messaging apps, email, social media, gaming platforms, messages passed through other people, or meeting in person.
- **Safeguarding concern**: Anything described in clause A4.
- **Safeguarding lead**: Tahasin Hasan.
- **Deputy safeguarding lead**: Abdurrahman Mustafa.
- **Checks**: The Enhanced DBS check including the Children’s Barred List, identity checks, right-to-work checks, and every other suitability check LearnThrive carries out.
- **Private room**: A room with the door closed, where nobody other than me can see or hear the lesson or the student.
- **Immediately**: Straight away, before I do anything else except what is needed to keep a child safe.
- **The same day**: Before midnight, UK time, on the day I first become aware.

### Part A: Reporting and responding to concerns

**[confirmed]** **A1.** I will report any safeguarding concern to the safeguarding lead, Tahasin Hasan, immediately, and never later than the same day, using the contact route LearnThrive gives me. If I cannot reach the safeguarding lead, I will report it in the same way to the deputy safeguarding lead, Abdurrahman Mustafa.

**A2.** If my concern is about the safeguarding lead, I will report it to the deputy safeguarding lead. If it is about both of them, I will report it directly to the police or to the local authority’s children’s social care.

**A3.** If a child is in immediate danger, I will call 999 first. I will then tell the safeguarding lead as soon as the child is safe.

**A4.** A safeguarding concern includes all of the following. If I am unsure whether something counts, I will report it.
   - a child telling me, or hinting, that they or another child have been hurt, neglected, abused or frightened, or are at risk;
   - signs of injury, neglect, distress, self-harm or fear that I see or hear in a lesson;
   - a child saying they feel unsafe, or that an adult is behaving in a way that worries them;
   - worrying behaviour by any adult that I see or hear during a lesson, including another adult in the room;
   - signs that a child is being groomed or exploited, online or offline;
   - anyone contacting a child in a way that worries me;
   - any contact request, gift or inappropriate behaviour from a student or a family member towards me; and
   - worrying or inappropriate behaviour by any adult connected with LearnThrive, including other tutors and the directors.

**A5.** When a child tells me something worrying, I will listen calmly. I will not ask leading questions and I will not investigate.

**A6.** I will never promise a child that I will keep something secret. I will tell the child that I may need to pass it on to keep them safe.

**A7.** I will not discuss a safeguarding concern with anyone except the safeguarding lead, the deputy safeguarding lead or the emergency services.

**A8.** I will write down what I saw or heard, with the date and time, using the child’s own words for anything the child said. I will give it to the safeguarding lead the same day.

**A9.** After I have passed my written record to the safeguarding lead, I will delete my own copy unless LearnThrive tells me to keep it.

**A10.** I will follow the safeguarding lead’s instructions on any safeguarding matter immediately.

### Part B: Contact and communication

**B1.** I will communicate with students and families only through LearnThrive channels.

**B2.** I will teach students only on the lesson platform that LearnThrive provides.

**B3.** I will not contact a student or any member of a family outside LearnThrive channels. This includes phone calls, texts, WhatsApp and other messaging apps, email, social media, direct messages and gaming platforms, and contact through friends or relatives.

**B4.** If a student or a family member contacts me outside LearnThrive channels, I will not reply. I will report it to the safeguarding lead the same day.

**B5.** I will not share my personal phone number, email address, social media or any other personal account details with a student or a family member, and I will not ask for theirs.

**B6.** I will not follow, befriend, connect with or message a student or a family member on social media, and I will not accept their requests to connect.

**B7.** I will not arrange, offer or agree private or unpaid lessons, extra sessions or any other tuition outside LearnThrive with any student I meet through LearnThrive.

**B8.** I will not ask or encourage a student or a family to leave LearnThrive.

**B9.** I will not send, ask for or exchange photographs, videos, voice messages, links, files or any other content with a student, other than lesson materials shared through LearnThrive channels.

**B10.** I will never ask or tell a student to keep a secret from their parent or guardian or from LearnThrive.

**B11.** For as long as a student is under 18, I will not contact that student outside LearnThrive channels, even after I stop teaching them or stop working with LearnThrive.

### Part C: Lessons and setting

**C1.** Every lesson will take place online, on LearnThrive’s lesson platform. I will never meet a student in person, arrange to meet one, visit a student’s home, or invite a student or a family member to mine.

**C2.** I will teach every lesson from a private room.

**C3.** If anyone enters my room, or interrupts a lesson, I will pause the lesson immediately and will not resume until the room is private again.

**C4.** I will keep my camera and microphone on for the whole lesson. I will not turn off my video or end the call early, unless the lesson platform fails or a safeguarding reason requires it.

**C5.** I will dress as I would to teach in a school. Nothing that would be unsuitable around children will be visible or audible in my room, for example nudity, alcohol, drugs, weapons, offensive posters or offensive language.

**C6.** I will not record, photograph, screenshot, transcribe or otherwise capture any lesson or any student, and I will not allow anyone else to.

**C7.** I will not use AI note-takers, transcription tools, bots or recording plug-ins in any lesson.

**C8.** I will not teach while under the influence of alcohol or any drug, or while so unwell that it affects my judgement.

**C9.** I will teach every lesson myself. I will not let anyone else teach, join or take over any part of a lesson for me.

**C10.** I will not teach a student I have a personal connection with (a relative, friend, neighbour or any other personal relationship) unless the safeguarding lead has agreed in writing beforehand. If I find that a student is someone I know, I will tell the safeguarding lead the same day.

### Part D: Conduct and boundaries

**D1.** I will keep my language, behaviour, jokes and examples professional and suitable for children at all times. I will not use swearing, or discriminatory, sexual, violent or frightening language or material.

**D2.** Where the curriculum covers a sensitive topic, I will deal with it factually and in a way that suits the student’s age.

**D3.** I will not form, or attempt to form, any romantic, sexual or secret relationship with any student, whatever their age.

**D4.** I will not say or do anything sexual or flirtatious to a student, or in front of a student.

**D5.** I will not give or accept gifts, money, favours or special treatment, other than the agreed payment for tuition made through LearnThrive.

**D6.** I will not ask a student about their private life, family, body, relationships, religion, health or home circumstances, beyond what I need to know in order to teach them.

**D7.** I will not comment on a student’s appearance.

**D8.** I will treat every student fairly and with respect. I will not shout at, bully, humiliate, threaten or discriminate against any student.

**D9.** I will not pressure a student, or make a student feel uncomfortable or afraid.

**D10.** If a student tells me they are uncomfortable, I will stop that activity immediately.

**D11.** I will not ask a student to show anything on camera other than their face and their schoolwork, and I will not ask a student to move the camera to show their room.

**D12.** If I break any part of this agreement, however small, I will tell the safeguarding lead the same day.

### Part E: Information and data

**E1.** I will keep all information about students and families confidential. I will discuss a student only with LearnThrive, or with the student’s parent or guardian through LearnThrive channels. The only exceptions are where this agreement requires me to report a concern, and where the law requires me to disclose information.

**E2.** I will keep only the student information I need in order to teach, and I will keep it on a password-protected device with up-to-date security.

**E3.** I will not store student information in personal cloud accounts, messaging apps or social media accounts.

**E4.** I will delete student information when I no longer need it, or when LearnThrive asks me to.

**E5.** I will not share lesson links, login details or any materials that identify a student with anyone.

**E6.** I will not post or share anything about LearnThrive students online, including on social media, even without names.

### Part F: Checks, honesty and changes

**[confirmed]** **F1.** I agree to an Enhanced DBS check including the Children’s Barred List, carried out by LearnThrive, if I am offered a place.

**[confirmed]** **F2.** I agree to every other check LearnThrive carries out, including identity checks and right-to-work checks.

**F3.** I will give true and complete information for every check, promptly, and I will cooperate with it fully.

**[confirmed]** **F4.** I will not teach, or have any contact with, any LearnThrive student until every check is complete.

**F5.** I will treat the checks as complete only when LearnThrive has told me so in writing.

**F6.** I confirm that I am not barred from working with children, that no order, restriction, disqualification or sanction prevents me from working with children, and that I will not work with children in any role from which I am barred.

**F7.** Everything I have told LearnThrive in my application is true and complete, and I have not withheld anything relevant to my suitability to work with children.

**F8.** I understand that false or incomplete information may lead to my application, or my work with LearnThrive, ending immediately.

**F9.** I will tell the safeguarding lead immediately, and never later than the same day, if anything changes that could affect my suitability to work with children. This includes:
   - a police investigation, arrest, charge, caution, conviction, barring decision or disqualification;
   - any allegation or concern about my conduct towards a child, anywhere; and
   - any decision by an employer, school, regulator or other body about my suitability.

### Part G: Reconfirmation, cooperation and consequences

**[confirmed]** **G1.** I will reconfirm this agreement every year, and whenever LearnThrive issues a new version.

**G2.** I will reconfirm by the date LearnThrive sets. If I have not reconfirmed by that date, I must stop teaching until I have.

**G3.** I will cooperate fully, honestly and promptly with any safeguarding review, investigation or request for information, including one from LearnThrive, the police, the DBS or the local authority.

**G4.** I understand that if I break any part of this agreement, LearnThrive may suspend me immediately and without notice, end my work with LearnThrive, and report me to the police, the DBS, the local authority or any other body, where the law requires it or where LearnThrive believes it is needed to protect a child.

**G5.** I understand that LearnThrive may share information about my conduct, this agreement and my checks where that is needed to protect children.

**[confirmed]** **G6.** These expectations are part of the tutor agreement I will sign.

**G7.** This agreement applies to everything I do as a LearnThrive tutor, at all times, in lessons and outside them, online and offline.

**G8.** I have read this agreement in full, and I have read LearnThrive’s safeguarding page. If I do not understand any part of it, I will ask the safeguarding lead before I agree.

### Understanding check (six questions; correct answer marked)

**report-who-when. A child tells you something that worries you. Who do you report it to, and by when?** (clauses A1)

- a) The child’s parent, by the end of the week.
- b) Nobody, unless the child asks me to tell someone.
- **✔** c) The safeguarding lead, immediately, and never later than the same day.
- d) The safeguarding lead, at the end of the month.

**immediate-danger. A child is in immediate danger. What do you do first?** (clauses A3)

- **✔** a) Call 999.
- b) Email the safeguarding lead and wait for a reply.
- c) Ask the child questions to find out exactly what happened.
- d) Text the child’s parent.

**keep-it-secret. A child asks you to keep something they have told you secret. What do you say?** (clauses A6)

- a) “I promise I won’t tell anyone.”
- b) “Tell me everything, and I will decide whether it matters.”
- c) Nothing. I change the subject and carry on with the lesson.
- **✔** d) “I may need to pass this on to keep you safe, so I can’t promise to keep it secret.”

**personal-number. A student asks for your personal phone number so they can message you about homework. What do you do?** (clauses B3, B5)

- a) Give it to them if their parent agrees.
- **✔** b) Do not give it. I use LearnThrive channels only.
- c) Give it to them, but only for homework.
- d) Give them my personal email address instead.

**where-lessons-happen. Where may a lesson take place?** (clauses B2, C1)

- a) Anywhere the student prefers, including at their home.
- b) On any video app that the student and I both like.
- **✔** c) Online, on the lesson platform LearnThrive provides, and nowhere else.
- d) In a public place such as a library.

**someone-walks-in. Someone walks into your room during a lesson. What do you do?** (clauses C3)

- a) Carry on, because they are probably a family member.
- b) Ask them to sit quietly until the lesson ends.
- c) Turn my camera off and carry on by voice.
- **✔** d) Pause the lesson immediately, and carry on only when the room is private again.

## 6. Google Workspace corrected to IONOS (flagged)

The legal FAQ said LearnThrive "primarily uses Google Workspace" (Gmail, Drive, Docs, Sheets, Meet), and its provider list named Google Workspace and Google Meet. That is wrong: company mail is IONOS, email delivery is Resend, hosting is Render.

| Before | After |
| --- | --- |
| "LearnThrive primarily uses Google Workspace for business communications and records" (Gmail, Drive, Docs and Sheets, Meet) | "LearnThrive's company email is hosted with IONOS. Enquiries, tutor applications and other messages sent through this website arrive in that company mailbox" |
| Providers: Google Workspace (email, documents, file storage, administration), Google Meet (online tuition sessions) | Providers: IONOS (company email and mailboxes), Resend (delivery of the emails the website sends), Render (hosting of this website) |
| "LearnThrive currently uses Google Meet for online tuition." | "Online tuition takes place on the lesson platform LearnThrive provides." **Flagged:** if you want the platform named, say which. |

The main privacy notice now names the same three providers. A test (`tests/careers.test.mjs`) fails if any source file names Google Workspace, Meet, Drive, Docs or Sheets.

## 7. Safeguarding statements: before and after

Tags: **confirmed** (a rule you gave me, now stated firmly), **flagged** (kept as it was, because you have not confirmed it; I did not invent a process), **removed** (at your direction), **corrected**.

| Where | Before | After | Tag |
| --- | --- | --- | --- |
| Home, trust heading | "Every tutor is DBS-checked" | "No tutor teaches until every check is complete" | confirmed |
| Home, trust text | "Every tutor goes through a thorough hiring process before teaching a LearnThrive student, including a Disclosure and Barring Service (DBS) check. No tutor begins teaching until this process is complete." | "Every tutor must pass identity and right-to-work checks, agree to an Enhanced DBS check including the Children's Barred List, and agree to our safeguarding agreement. No tutor teaches any student, or has any contact with one, until every check is complete." | confirmed |
| Home and `/safeguarding` pipeline labels | "Hiring process", "DBS check" | "Identity and right-to-work checks", "Enhanced DBS check" | confirmed |
| `/safeguarding`, who is responsible | Nobody named on the page | New section: the safeguarding lead is Tahasin Hasan and the deputy is Abdurrahman Mustafa; every tutor reports a concern to the lead, or to the deputy if the lead cannot be reached; how to reach them | confirmed |
| `/safeguarding`, tutor checks | "Every tutor goes through a thorough hiring process ... including a DBS check. No tutor begins teaching until this process is complete." | "No tutor teaches any student, or has any contact with one, until every check is complete." Then what every tutor must do: identity and right-to-work checks; agree to an Enhanced DBS check including the Children's Barred List (LearnThrive arranges and pays unless the tutor holds a suitable certificate or chooses to pay); read and agree to the safeguarding agreement when applying; reconfirm it every year. Links to the agreement | confirmed |
| `/safeguarding`, raising a concern | "contact us as soon as possible" | "If a child is in immediate danger, call 999 first." Then who can raise a concern (a parent, a student, a tutor or anyone else) and how | confirmed |
| `/safeguarding`, NSPCC and Childline numbers | present | unchanged (verified) | confirmed |
| `/safeguarding`, online tuition list ("should include ...") | present | unchanged | flagged |
| `/safeguarding`, recording | "Do not assume lessons are recorded." | "LearnThrive lessons are not recorded by default." This is the position the legal FAQ already stated ("No. LearnThrive lessons are not recorded by default."), so the two now agree | confirmed (existing position) |
| `/safeguarding`, how concerns are recorded | Not mentioned | "A concern should be recorded factually, and safeguarding records should be kept separately from routine learner records, with restricted access." The legal FAQ's own wording, kept as "should" because the practice is not confirmed | flagged |
| FAQ, "What checks **should** LearnThrive carry out before a tutor teaches?" | A list of "should" checks: identity verification, verification of qualifications relied upon, "appropriate references", right-to-work, an assessment of eligibility for the DBS level, safeguarding induction, agreement to the Tutor Code of Conduct | "What checks **must** a tutor complete before they teach students?" Identity and right-to-work checks; Enhanced DBS including the Barred List; the agreement; yearly reconfirmation. "There is no fixed number of references." | confirmed |
| FAQ, the same answer | Safeguarding induction; the Tutor Code of Conduct; verification of qualifications; "appropriate references" | Gone. "Safeguarding induction" is replaced by agreeing to the safeguarding agreement. "Tutor Code of Conduct" is removed: no document with that name exists in the repo, and the safeguarding agreement takes its place. LearnThrive looks at CV, experience and GCSE, A Level and degree results instead of verifying qualifications or asking for references | removed |
| FAQ, refresher training | "Tutors should receive safeguarding refresher training periodically, with annual refresher training used as the working standard." | Deleted | removed |
| FAQ, safeguarding responsibilities | "The proposed internal safeguarding responsibilities are ... These appointments should be formally approved and kept under review." | Lead and deputy stated firmly, with a link to the agreement | confirmed |
| FAQ, "The same safeguarding standards should apply to employed, self-employed, contracted tutors" | "should apply" | "apply" | confirmed |
| FAQ, "LearnThrive should maintain a documented safer-recruitment process, and should not request a level of DBS information that it is not legally entitled to obtain." | present | unchanged | flagged |
| FAQ, what happens when a concern is raised (listen, record factually, pass to the lead "promptly", consider external referral); what a tutor does when a learner discloses | "should" lists | unchanged (the agreement's proposed clauses are stricter: "immediately, and never later than the same day") | flagged |
| FAQ, tutors "should use approved LearnThrive systems wherever reasonably possible" and the other online-tuition "should" lines | present | unchanged | flagged |
| FAQ, online tuition platform | "LearnThrive currently uses Google Meet" | "the lesson platform LearnThrive provides" | corrected, flagged |
| FAQ, where information is stored | Google Workspace | IONOS, Resend, Render | corrected |
| FAQ, retention | Applications 6 months; personnel records 6 years | Applications 6 months (12 with the talent-pool box); identity documents deleted at 6 months for unsuccessful applicants; a tutor's identity documents while they work plus 12 months; agreement records while they work plus 6 years; subject requests until added or 12 months | confirmed |
| FAQ section intro | "... including the working policies and proposed responsibilities described below." | "... including working policies." | corrected |
| Cookie notice | The enquiry form only | The enquiry, application and subject-request forms, and the human check | corrected |
| Privacy notice | Enquiries only; provider categories | Applicants (with a link), subject requests, providers by name, retention for subject requests | corrected, flagged (lawful bases are drafts) |
| Careers pages | n/a | Only the confirmed facts: the lead and deputy, the agreement, the Enhanced DBS check and who pays, no teaching until every check is complete, yearly reconfirmation. No mention of induction, refresher training or a code of conduct (a test enforces it) | confirmed |

No escalation process was invented. Where the site describes what happens after a concern is raised, it is the wording that was already there, flagged for you.


## 8. What was tested, and what could not be

### Run at the final commit

| Check | Result |
| --- | --- |
| Lint (`eslint src tests tests-e2e tests-prod`) | 0 errors. One warning that was already there (`AppSearchKind` unused in `src/lib/search/appSearch.ts`) |
| Typecheck (`tsc --noEmit`) | Clean |
| Unit tests (`npm test`) | 402 passing. 139 of them are new, in 10 files (below) |
| Production build (`npm run build`) | Passes |
| Production smoke (`npm run test:prod-smoke`, Chromium, against `next build` and `next start`) | 48 passing, including 7 new ones for the closed state and 4 new routes in the sweeps |
| End-to-end, the whole dev-server suite (`npm run test:e2e`) | 668 passed, 1 failed, 1 skipped in 7.1 minutes (670 tests). The one failure is the known `StatCounter` frame-loop test (item 6 below), which passes alone |

**Unit tests added or extended** (the email call is replaced in every route test, so nothing sends):

| File | Tests | Covers |
| --- | --- | --- |
| `careersApply.test.mjs` | 28 | The application route end to end: the gate, origin, rate limit, fail-closed config, body limits, honeypot and timing, human check, validation, file checks, the two emails and their order, the agreement record |
| `careersFiles.test.mjs` | 16 | Signature sniffing, the PDF feature scan (including `#xx`-escaped names), the DOCX inspector (macros, embeddings, bombs, encryption), sanitised names |
| `careersValidation.test.mjs` | 15 | Every field rule, the results rule, dates, the agreement section, the option lists |
| `safeguardingAgreement.test.mjs` | 16 | Structure, writing rules (no hedging words), the owner-approval gate, the understanding check, typed names, the record and hash, frozen versions, single source (including that pages, forms, routes and emails read it through the shared module) |
| `humanCheck.test.mjs` | 12 | Issue and verify, expiry, one use, tampering, the text fallback, a missing secret |
| `rateLimit.test.mjs` | 7 | The sliding window and the client address (header, hops) |
| `email.test.mjs` | 11 | Fail-closed config, destinations, escaped HTML, subject safety |
| `reconfirm.test.mjs` | 12 | The reconfirmation route |
| `subjectRequest.test.mjs` | 14 | The subject-request route and its confirmation rule |
| `careers.test.mjs` | 8 | The gates, the roles and their terms, the JobPosting markup, and that no source says refresher training, induction or names Google as a provider |

**End-to-end specs added** (every POST is mocked, because this project has real email credentials; the routes themselves are covered by the unit tests above): `careers.spec.ts` (25), `careers-apply.spec.ts` (39), `safeguarding-reconfirm.spec.ts` (10), `subject-request.spec.ts` (13) and `subjects-hero-cards.spec.ts` (15, since renamed `subjects-layout.spec.ts` and rewritten for plan18), plus the seven new routes in the shared sweeps in `tests-e2e/support.ts` (motion and reveal, axe in light and dark, images, content consistency, theme, 360px overflow). They cover keyboard-only completion, error summaries and focus, the live region, files added, replaced and refused, the date rule, the human check and its fallback, the unsent-work guards, JavaScript off, axe at WCAG 2 A and AA in light and dark, no horizontal overflow from 360px to 1440px, and touch targets of at least 44px.

### Problems the full run found, and what was done

1. **The footer test clashed with the new "Applicant privacy" link.** `getByRole('link', { name: 'Privacy' })` matches by substring, so it matched both. The locator is now `exact: true`; the assertions are unchanged.
2. **The end-to-end run exhausted the human-check challenge limit** (40 per address per 15 minutes; every page with a form asked for a challenge, and the suite opens them all from one address). The dev-server log shows 40 answers of 200, then 429 for every later request. Most of the first run's 19 failures were tests waiting for a check that never came (application, reconfirmation, subject request), plus the three 360px sweeps for the three routes that have a form, which timed out waiting for network idle. They pass after the changes here; I did not isolate which of items 2 and 4 fixed the sweeps. The limit is now skipped in development with the preview flag only (`previewOpen`, never true in a production build); the production limit is unchanged.
3. **A race in the start-date test.** On a loaded machine the field was filled before React had hydrated, and hydration reset it. The test now waits for hydration first (`hydrated()` in `careers-support.ts`).
4. **A design change that came out of it.** `/subjects` is a page most families only read, yet its request form started the human check (a request and about a second of work) on every visit. The check on that form now starts when the form is first touched. The application and reconfirmation forms, which people open to use, still start it when the page is idle.
5. **Focus was occasionally lost after a send.** The keyboard-only application test flaked once: the "sent" panel was on the page but not focused, because the form focused it from `requestAnimationFrame`, which on a busy page can run before React has rendered the panel. The three new forms now move focus from an effect (`useFocusAfterRender`), which only runs after the render. The older enquiry form still uses the animation-frame pattern; I did not change it.
6. **`StatCounter` in `frame-loops.spec.ts` fails in the full run.** It is a known load-sensitive test, already recorded in `docs/PLAN13_BUG_SWEEP.md` and `docs/PLAN15_COMPLETION_REPORT.md`: it waits for React to be quiet for a second, and in a busy dev-server run that never happens. It failed in the full run with this work and in a full run **without** this work's five new specs, and it passes alone, three times out of three. `smooth-scroll.spec.ts` has two timing tests that were flaky in the same way (passed on retry). I did not run the base commit.
7. **`scripts/browser-check.mjs` cannot run in this monorepo.** The brief asks for it to be extended. It looks for `next` under `apps/web/node_modules`, which does not exist here (dependencies are hoisted to the root), and it still tests the retired `mailto:` enquiry flow, so it fails before it reaches any page. I left it alone and put every check the brief lists into Playwright specs, which is what this repo's CI runs: keyboard-only completion of the application and reconfirmation, error summaries and focus, files added and removed, the Other box on `/subjects`, a phone viewport, no overflow, axe on every careers page, the agreement, reconfirmation, safeguarding and subjects pages, no cookies or storage or third-party requests, the no-JavaScript fallbacks, and an unknown role slug.

### Not tested, and why

- **No real email.** There are live Resend credentials in this environment, so nothing was sent. A real application with attachments, a reconfirmation and a subject request still need one trial each in staging (`docs/DEPLOYMENT.md`).
- **No real phone and no screen reader.** The proof-of-work difficulty was measured with CPU throttling standing in for a phone; accessibility rests on axe and keyboard-only tests. iPhone and Android file selection (camera roll, Files, cloud pickers) was not tried.
- **No look at the emails in real mail clients.** The HTML is table-based with inline styles and a plain-text part, but it has not been opened in a webmail or mobile client.
- **A closed role page was read, not run.** The page handles `closed` and `coming-soon`, but every role is open, so no test can reach that state without changing the data.
- **Only Chromium.** The production smoke suite runs Firefox and WebKit with `PW_CROSS_BROWSER=1`; that was not run here. The DOCX/PDF inspectors and the in-browser image shrink are the code most likely to behave differently in other browsers.
- **Render itself.** Its request-size limit and client-address header are undocumented; `docs/RENDER.md` gives the probes to run on the deployed service.
- **Load and abuse testing**, **malware scanning of uploads**, and a **legal review** of the notices, the agreement and the retention periods.

## 9. Operational notes for the owner

- **Where everything lands.** Applications, reconfirmations and subject requests arrive in the main `info@` mailbox on IONOS, or the addresses you set in `CAREERS_EMAIL` and `SUBJECT_REQUEST_EMAIL`. Resend also keeps a sending log, so there are copies there too (`docs/RETENTION_AND_DELETION.md` covers both).
- **Mailbox size.** Applications with attachments add up, and identity scans are the bulk of them (up to 12 MB per application). Decide the mailbox size before applications open.
- **A filter or folder.** The subject lines make this easy: `Careers application:` (with `[ID documents attached]` when there are identity scans), `Safeguarding reconfirmation:` (with `[CHANGE DECLARED]` first when a tutor says something has changed, which needs a same-day look), and `Subject request`.
- **A deletion routine that matches the retention schedule.** Identity documents stay for the whole engagement plus 12 months, so each one needs deleting, with the message it arrived in, at that point (or at 6 months for an unsuccessful applicant), and the Resend log needs checking too. `docs/RETENTION_AND_DELETION.md` has the instruction and a simple log to keep.
- **Do not delete the agreement emails early.** The emails that hold the agreement record and each yearly reconfirmation are the evidence: keep them for the agreed period (the engagement plus 6 years, longer if linked to a safeguarding concern).
- **Holding identity scans in a shared mailbox is a security risk** that should end when a proper secure store exists.
- **Subject requests are counted by hand.** Nothing is stored, so someone reads the mailbox and keeps the tally (`docs/SUBJECT_REQUESTS.md`).
- **Render and email setup** (not done; nothing was deployed). Use a paid Render instance: a free one sleeps after about fifteen minutes and cold-starts slowly, which a form site should not do. Add Resend's SPF and DKIM records and a DMARC policy to your DNS **without touching the existing IONOS mail records**, test them, then send one test application and one test subject request end to end. The commands, health-check path (`/api/health`), variables and the upload-limit test are in `docs/RENDER.md`.

## 10. Known limitations

- **The agreement is a draft.** Until you approve it, nobody can apply online or reconfirm. Applicants are sent to email, and the agreement page says so.
- **Typed-name acceptance is an acknowledgement, not a qualified electronic signature.** The record (version, parts, check result, UTC time, hash of the exact text) is evidence of what was shown and agreed, not of identity. No IP address is recorded, by design.
- **Rate limits and one-use challenges are in memory.** Correct for one Render instance; they reset on a restart. With several instances each would count separately. `docs/RENDER.md` says what to add.
- **The human check raises the cost of a script; it does not stop a determined one.** It is a proof of work, not a CAPTCHA with a human-only puzzle. The honeypot, minimum fill time, rate limits and the origin check sit beside it. Difficulty was tuned on a laptop with CPU throttling standing in for a phone; no real phone was available.
- **File inspection is structural, not a virus scan.** It rejects the wrong type, scripts and launch actions in PDFs, macros and embedded objects in DOCX files, zip bombs and encrypted files. It does not run an antivirus engine. The mailbox's own scanning is the second layer.
- **Identity documents arrive by email**, and are as safe as access to that mailbox. Restrict it, and delete on schedule.
- **Deletion and counting are manual.** There is no database, so nothing expires by itself.
- **Render's upload limit and client-address header are undocumented.** The limits (3 MB per file, 12 MB in total) are cautious, and the address handling is configurable. The probes in `docs/RENDER.md` must be run on the deployed service before applications open.
- **Without JavaScript the forms are not offered.** The pages say so and give an email route.
- **The job-posting markup is dormant.** It needs a confirmed `postedDate` for each role, and applications to be open.
- **Whether online tuition qualifies for the Children's Barred List check is not settled.** It is published as your rule; the entitlement question is open (section 4, item 7).
- **No real email was sent,** and `apps/web/.env.example` was not updated (access to `.env*` files is blocked in this environment; the block to paste is in `docs/DEPLOYMENT.md`).

## 11. Commands

From `apps/web`:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The production-build smoke suite (the closed state, as deployed):

```bash
npm run build
NODE_ENV=production npx next start -p 3200
npm run test:prod-smoke
```

Run in two terminals; the second starts once the first says it is ready.

One spec at a time:

```bash
npx playwright test tests-e2e/careers.spec.ts
npx playwright test tests-e2e/careers-apply.spec.ts
npx playwright test tests-e2e/safeguarding-reconfirm.spec.ts
npx playwright test tests-e2e/subject-request.spec.ts
npx playwright test tests-e2e/subjects-layout.spec.ts
```

To try the forms in development while the agreement is still a draft, start the dev server with `CAREERS_OPEN_FOR_TESTING=1` (a production build ignores it). Nothing in the e2e suite sends a real email.

To open applications, see section 1 and `docs/DEPLOYMENT.md`.
