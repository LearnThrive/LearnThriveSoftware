# Claude Code prompt: build the LearnThrive careers section, safeguarding agreement and subject requests

You are working in `D:\LearnThrive`, the LearnThrive Tuition marketing site (Next.js 16, React 19, strict TypeScript, CSS modules and a global stylesheet, Resend for email). There are four pieces of work in this prompt:

- A complete careers section: a careers hub, role pages, a single-page application form with CV, cover letter and supporting-document uploads, a self-built human check, a server route that emails the application, an applicant privacy notice, and supporting updates to existing pages.
- A hardened safeguarding agreement that every applicant must read and agree to as part of applying, a yearly reconfirmation page for existing tutors, and a site-wide tightening of all safeguarding wording.
- A "request a subject" feature on the subjects page, so families can ask for a subject LearnThrive does not yet offer (for example Computer Science), which the owners use to decide whether enough people want it.
- A small redesign of the subjects page so each subject section also shows the same hero card used on that subject's own landing page.

There is no login and no database. Nothing about an application or a subject request is stored by the website. Both are delivered by email and then handled by hand.

Work carefully and honestly. This site is read by parents and by prospective tutors, and it handles personal data and children's safeguarding. Every statement on the pages must be true, and every statement you cannot confirm must stay out or be clearly flagged for the owner. Hardening safeguarding means making requirements stricter, clearer and more specific. It never means claiming practices that do not exist.

## Read first, in this order

- `CLAUDE.md` and `AGENTS.md` in the repo root. This version of Next.js differs from older ones. Read the relevant guides in `node_modules/next/dist/docs/` before writing routing, metadata, request handling, headers, workers or fonts code.
- `CAREERS_PLAN.md` (background and reasoning, partly superseded by this prompt) and `DEPLOYMENT_PLAN.md` (known problems on the site that affect this work).
- `LEGAL_REVIEW.md`, `src/lib/legal-faqs.tsx` (the working retention schedule and tutor-checks wording), `src/lib/site.ts`, `src/lib/metadata.ts`, `src/app/layout.tsx`, `src/app/safeguarding/page.tsx`.
- The design language to reuse: `src/app/globals.css`, `src/components/PageHero.tsx`, `SectionHeading.tsx`, `FeatureCard.tsx`, `FaqList.tsx`, `ButtonLink.tsx`, `TestimonialCard.tsx`, `ScrollReveal.tsx`, `Icon.tsx`, `SubjectCard.tsx`, and the pages `src/app/book`, `src/app/contact`, `src/app/about`, `src/app/subjects` with their CSS modules.
- The existing enquiry flow, which is the pattern to follow and the thing not to break: `src/components/EnquiryForm.tsx` and `src/app/api/enquiry/route.ts`.
- `scripts/browser-check.mjs` and the files in `tests/`.

## Before you change anything

- The working tree currently has many uncommitted changes that belong to the owner. Do not revert, reformat or tidy them. Create a branch for this work (for example `feature/careers`) and commit only your own changes, in small commits with clear messages.
- Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` separately and record the baseline. At the time of writing lint has errors and some enquiry tests fail because the Resend client is created when the file loads. Do not fix unrelated problems, with two exceptions. First, the new routes need a safe way to create the email client at request time, so add one small shared helper and use it in the new routes. You may switch the existing enquiry route over to the same helper if that is all it takes to make its tests pass, and say so in your report. Second, `src/app/subjects/page.tsx` has a known lint error (a plain `<a>` linking to `/`, which should be `Link`). Since you are editing that file anyway, fix that one error there and say so.

## Decisions the owner has already made (9 October 2026)

- Tutors are self-employed.
- Hours depend on student availability.
- Pay is 10 pounds an hour per student. Publish it exactly like that. Introductory offers for families will be decided later and are not mentioned anywhere in this work.
- No formal training is offered. Progression opportunities may exist later and are still being worked out. Say that honestly, without promising anything.
- Hiring is run by Tahasin Hasan together with Abdurrahman Mustafa. Tahasin Hasan is the safeguarding lead and Abdurrahman Mustafa is the deputy safeguarding lead.
- Every tutor must agree to an Enhanced DBS check that includes the Children's Barred List, because tutors work with children. LearnThrive carries it out and pays for it, unless the applicant already holds a suitable certificate or chooses to pay for their own check. Any start is subject to its outcome. Flag in your report that the owner should confirm with the DBS (or the umbrella body used) that online one-to-one tuition qualifies for a barred list check, because the site's own legal FAQ says LearnThrive must not request DBS information it is not entitled to.
- There is no fixed number of references. LearnThrive looks at the whole picture: the applicant's CV and experience, and their results at GCSE, A Level and degree level (undergraduate or higher). Someone who did less well at GCSE or A Level may have done much better at degree level, so earlier results do not rule an applicant out. For example, a middling GCSE result and a weak A Level followed by a first-class degree can still be a strong fit.
- Every applicant must read and agree to a safeguarding agreement as part of the application itself. The same expectations then form part of the tutor agreement that tutors sign. See the dedicated section below, and make it as strong and as hard to bypass as you can.
- No tutor teaches any student, or has any contact with one, until every check is complete (identity, right to work, DBS and any other check LearnThrive carries out). This is confirmed, so it may be stated publicly and is part of the agreement.
- Tutors reconfirm the safeguarding agreement every year, and whenever a new version is issued. Build a small reconfirmation page so this can really happen without a login or database (see the section on yearly reconfirmation).
- Retention, as decided by the owner (with the specifics fixed in the section on defaults below): identity and right-to-work documents are kept so that a tutor can return without starting again, with a 12-month gap after they stop working with LearnThrive; subject requests have a 12-month long-stop; reconfirmation records are kept for longer, for a period chosen as best for LearnThrive.
- The agreement wording must be as explicit and as hardened as possible. See the agreement section.
- There will be no refresher training. The owner has decided to remove it. Remove the refresher training wording from the site (see the safeguarding section below). Do not replace it with any other training claim.
- Introductory offers are for families (clients), so that they can see what LearnThrive is like. They are not part of tutor hiring. Do not add an introductory conversation to the hiring steps, and do not mention introductory offers on the careers pages. The owner will decide how introductory offers work at a later date, including whether and how they affect tutor pay, so do not mention them anywhere in this work.
- Response time: within 5 working days.
- Applications go to `info@learnthrivetuition.co.uk` for now. Read the destination from configuration so it can change to a careers address later.
- The site will be hosted and deployed on Render. Company mailboxes are hosted with IONOS. The existing transactional email provider is Resend.
- Four open tutor roles (Maths, English, Science, 11+ Preparation) plus a general register-your-interest option. Minimum age 18. Applicants must have the right to work in the UK, including for self-employed work. These are confirmed.
- The cover letter can be uploaded as a file or pasted into a text box, and is optional. Supporting documents are optional, and the page must say this is where applicants can upload identity and right-to-work documents until a separate secure process is put in place.
- The application is one scrolling page divided into numbered sections, not a multi-page wizard.
- Applicants must pass a human check. A self-built check is acceptable and preferred, so that no third party is involved.
- The reviews already shown on the home page are the testimonials. Tutor photos are not used on the careers pages, because tutors may add their own after logging in to a future platform.
- Families can request a subject that is not offered (for example Computer Science). If there is enough interest, the owners may add it. The subject list is a dropdown with an "Other" option that reveals a text box.

## Defaults chosen on the owner's behalf

The owner asked for open questions to be settled sensibly. Apply these, use them consistently everywhere, and list them in your report so the owner can reverse any of them.

- A suitable existing DBS certificate means an Enhanced DBS certificate that includes the Children's Barred List for the children's workforce, that is subscribed to the DBS Update Service, so LearnThrive can check its status online with the applicant's permission. LearnThrive decides whether to accept it. Anything else needs a new check, arranged and paid for by LearnThrive, or paid for by the applicant if they choose. Use this one definition in the form, the hub FAQ, the privacy notice and the agreement page.
- The optional DBS status question stays in Section 4. Applicants are told not to upload a DBS certificate.
- Talent pool is on, as a separate unticked optional consent box, with 12 months retention.
- For unsuccessful applicants, the application, its agreement record and any identity documents are deleted six months after the decision (the existing schedule), or 12 months for the application only if they ticked the talent pool box. Identity documents are always deleted at six months for unsuccessful applicants. A returning applicant must always show current, valid documents, because documents expire; old copies are never relied on without checking.
- For engaged tutors: identity and right-to-work documents are kept while they work with LearnThrive and for 12 months after, then deleted; agreement and reconfirmation records are kept while they work with LearnThrive and for 6 years after (the existing personnel records period, which also matches the usual six-year period for contract claims), and longer, separately and with restricted access, for anything linked to a safeguarding concern.
- Subject requests: until the subject is added, or 12 months, whichever is sooner.
- The agreement is accepted in the application by typed name, with the full tutor agreement signed separately when the tutor is engaged.
- The reconfirmation deadline is set by the owners each time and is not published. Reconfirmation uses the same agreement and no understanding check by default.
- The understanding check needs all six answers right, with unlimited attempts and nothing stored about attempts.
- The destination is `info@learnthrivetuition.co.uk` for now, through the environment setting, so it can move to a careers address later without code changes.
- Render needs a paid instance so the forms do not suffer slow starts.
- The pay wording is published as given. Hours are described only as depending on student availability.
- The agreement stays closed to the public until the owner sets `agreementApprovedByOwner` to true. This is a safety measure, not a default for the owner to reverse.

## What you may publish and what you may not

You may publish, as the owner has confirmed: online one-to-one tuition; subjects and year groups already on the site; tutors are self-employed; 10 pounds an hour per student; hours depend on student availability; no formal training is currently provided; progression is being worked on; the hiring is run by Tahasin Hasan and Abdurrahman Mustafa; the named safeguarding lead and deputy; tutors must agree to an Enhanced DBS check including the Children's Barred List, arranged by LearnThrive, which LearnThrive pays for unless the applicant already holds a suitable certificate or chooses to pay for their own; there is no fixed number of references and the team looks at CV, experience and all results from GCSE through degree level; applicants must read and agree to the safeguarding agreement as part of applying, and its expectations are part of the tutor agreement; no tutor teaches any student until every check is complete; tutors reconfirm the safeguarding agreement every year and whenever it changes; applicants hear back within 5 working days; applications are made online or by email; the existing home page reviews.

You must not invent or imply anything else. In particular, do not state any of these on a public page unless the owner confirms them: any induction, training or refresher training, qualification requirements beyond those above, start dates, benefits, flexibility claims beyond "hours depend on student availability", team size, awards, accreditations, or tutor quotes. Put anything unconfirmed in a clearly named configuration entry with a short `// OWNER TO CONFIRM` comment, leave it out of the public copy until confirmed, and list every such item in your final report.

## Hard constraints

- No database, no file storage, no writing uploaded files to disk, no logging of personal data or file contents.
- No cookies and no browser storage (no local storage, session storage or IndexedDB). The privacy and cookie pages promise this. The forms keep their state in memory only, and the careers form warns before the visitor leaves with unsent work.
- No third-party requests from the browser. No analytics, pixels, embeds, hosted fonts or third-party CAPTCHA.
- No new dependencies unless you can show they are essential. Validation, file checks, hashing (use the platform's built-in crypto), the human check and the forms should use plain code. If you think a dependency is justified, stop and explain before adding it.
- Do not touch `D:\LearnThriveSoftware`.
- Keep lint, typecheck, tests and build passing at every commit that you author. Never weaken or delete a test to get a pass.

## Configuration and data to create

Create `src/lib/careers.ts` (roles and copy), `src/lib/careers-config.ts` (limits and switches) and `src/lib/safeguarding-agreement.ts` (the agreement text, described below). Keep every number and flag in one place.

Roles: typed entries with slug, title, status (open, closed, coming soon), subject, year groups, employment type (self-employed), location (online, UK), hours text, pay text, summary, what you will do, what we are looking for, nice to have, posted date and closing date (optional). Seed with the four open tutor roles plus a general "register your interest" option. The owner can change statuses in this file. Role copy must stay inside the confirmed facts.

Configuration, with defaults you can tune:

- Accepting applications on or off.
- Destination email address, read from the environment (`CAREERS_EMAIL`, falling back to `ENQUIRY_EMAIL`, falling back to the site email).
- File limits. CV: PDF or DOCX, up to 3 MB. Cover letter file: PDF or DOCX, up to 3 MB. Supporting documents: up to 5 files, PDF, DOCX, JPG or PNG, each up to 3 MB. Total across all files: 12 MB. These are deliberately cautious. Resend allows 40 MB per email after Base64 encoding and the IONOS mailbox limits are far higher, but Render's request limits could not be confirmed from its documentation, and one community report describes a 413 error returned before the app. Test the real maximum on the deployed service and lower the limits here if the edge rejects it.
- Minimum age: 18.
- `agreementApprovedByOwner`: false by default. While it is false, the agreement page and the reconfirmation page show a clear draft notice and the apply and reconfirm routes refuse submissions with a friendly "applications open soon, please email us" message, so unapproved wording can never go live by accident. The owner changes it to true after approving the agreement text.
- The agreement understanding check: enabled by default for applications, off by default for reconfirmations (see the agreement section).
- Talent pool (keep details for future roles): on, as a separate, unticked, optional consent box in Section 8, with retention of 12 months after the decision, configurable. Applicants who do not tick it follow the normal six-month schedule.
- Hiring steps shown to the public, as a configurable list: apply online, including reading and agreeing to the safeguarding agreement; the team reviews your CV, experience and results; we contact you about next steps; identity and right-to-work checks; an Enhanced DBS check including the Children's Barred List, arranged by LearnThrive; you sign the tutor agreement, which includes the safeguarding expectations; once every check is complete, you start teaching. No tutor teaches any student before then. Only these steps. Do not add others.
- Response-time text: "We will reply within 5 working days."
- Short-answer prompts for the form (see below).

## Pages and routes

- `/careers`: hub.
- `/careers/[slug]`: role page, statically generated from the roles file. Unknown slugs return the site's not-found page. Closed roles show a clear closed message and offer the general register-your-interest route.
- `/careers/apply`: the application page. Accepts an optional `role` in the query string to preselect a role. Not indexed by search engines.
- `/careers/safeguarding-agreement`: the full text of the current safeguarding agreement, readable before applying, showing its version and date.
- `/safeguarding/reconfirm`: the yearly reconfirmation page for existing tutors (see below). Not indexed, not in the sitemap, linked from the safeguarding agreement page and the tutor-facing text only.
- `/careers/privacy`: the applicant privacy notice.
- `/api/careers/apply`: receives the application.
- `/api/subject-request`: receives a subject request.
- `/api/safeguarding/reconfirm`: receives a reconfirmation.
- `/api/careers/challenge`: issues the human-check challenge (shared by both forms).
- Update the sitemap (hub, role pages that are open, and the agreement page), the footer (add a Careers link), the about page and the safeguarding page (link to careers where it reads naturally), and add a small home page band that appears only while at least one role is open and applications are on. Do not add Careers to the main header unless the owner asks.

## The careers hub, top to bottom

Use the existing page-hero and section styles, ScrollReveal where the site already uses it, subject accent colours for roles, and existing icons (add a small number of matching stroke icons only if needed).

- Hero: eyebrow, headline, short intro, two actions (see open roles, apply). The aside shows a quick-facts card using only confirmed facts: online, self-employed, 10 pounds an hour per student, Year 3 to A Level in Maths, English, Science and 11+.
- What the work involves: plain description of online one-to-one tutoring across the subjects and year groups on the site.
- What to expect: an honest, balanced section covering self-employment, pay, hours depending on student availability, no formal training at present, and progression being developed. It must read as straightforward, not as selling.
- Open roles: role cards, with an empty state when nothing is open that points to the register-your-interest route and the email address.
- Who we are looking for: people who are confident in the subject they want to teach. State how applications are judged: we look at your CV and experience and at your results across GCSE, A Level and any degree (undergraduate or higher), and a strong later result is taken into account even if earlier results were weaker. No fixed number of references.
- How hiring works: the confirmed steps from configuration, and that the team led by Tahasin Hasan and Abdurrahman Mustafa reviews applications and replies within 5 working days.
- Safeguarding: a firm, specific section that links to the safeguarding page and the full safeguarding agreement, names the safeguarding lead (Tahasin Hasan) and deputy (Abdurrahman Mustafa), says every applicant must read and agree to the agreement as part of applying, says tutors must agree to an Enhanced DBS check including the Children's Barred List, arranged by LearnThrive (paid for by LearnThrive unless the applicant already holds a suitable certificate or chooses to pay for their own), says no tutor teaches any student until every check is complete, says tutors reconfirm the agreement every year, and summarises the main commitments tutors agree to in plain language. It does not mention induction, training or refreshers.
- Equal opportunities and adjustments: a short statement and a clear way to ask for adjustments or another way to apply (email or phone, using the existing contact details).
- What families say: the existing home page testimonials, reused from the same data and component, with no edits to their wording.
- Applicant FAQ in the existing accordion: who can apply, pay and hours, how applications are assessed (including degree-level results), how to apply, file types and sizes, what to include, identity and right-to-work documents, DBS and who pays, the safeguarding agreement, references, what happens next, how long data is kept, how to withdraw. Answers must match the confirmed facts and the applicant privacy notice.
- Closing call to action: apply now, or email. Build a careers version of the call-to-action section, because the existing one is fixed to the booking buttons.

## The application form (`/careers/apply`)

One page, one form, divided into numbered sections with a clear heading each ("Section 1 of 8: About you" and so on). Add a sticky section navigation (a compact progress list) with links that jump to each section and a visible complete or needs-attention state for each. It must work on small screens, must not trap focus, and must not rely on colour alone. All state is in memory only. Warn with the browser's standard leave warning if the form has unsent changes.

Follow the patterns in `EnquiryForm.tsx`: controlled fields, plain-language errors, inline error text tied to each field, an error summary at the top that receives focus on a failed submit with links to the fields, a disabled submit button while sending, and a success message that receives focus.

Sections and fields (required unless marked optional):

- Section 1, About you: first name, last name, email, phone, town or city. Autocomplete attributes on all of them. Do not ask for date of birth, photo, nationality, marital status, or any health or disability information.
- Section 2, The role: which role (preselected from the link), which subjects, which year groups (the existing year-group list), exam boards or 11+ formats you are comfortable with (optional), and an optional box: "Other subjects you could teach that we do not offer yet". That box helps the owners match tutor supply to subject requests.
- Section 3, Experience, qualifications and results: highest relevant qualification (select) and subject. Then results in the subjects you want to teach, as separate labelled boxes: GCSE results; A Level results; undergraduate degree (subject, university, classification or expected classification); postgraduate or higher degree (optional). Require at least one of these to be filled in, and say plainly that results at every level are looked at together and that later results are taken into account. Add an optional box, "Anything you would like us to know about your results". Then years of tutoring or teaching experience (select), experience supporting learners with additional needs (select; this is professional experience, not the applicant's own health), experience teaching online (select), and a short list of anything else relevant (optional). Do not ask for referee details at this stage.
- Section 4, Availability and set-up: which times you can teach (weekday after school, weekday evenings, weekends, weekday daytime), hours per week (select), earliest start date, a confirmation that you can teach from a quiet, private space with reliable internet and a working camera and microphone, and whether you are legally able to work, including self-employed work, in the UK (yes, no, not sure). Optionally, whether you already hold an Enhanced DBS certificate that includes the Children's Barred List and whether you are subscribed to the DBS Update Service (yes, no, in progress, not sure). This is a status question only; never ask about convictions or cautions, and tell applicants not to upload a DBS certificate or any DBS information in the form, because the check is handled separately through the DBS process. Include the question (the owner has decided to ask it), and say in your report that its wording should be reviewed together with the rest of the legal text.
- Section 5, Your application: the CV (required file), the cover letter as either a file or pasted text in a box up to 4,000 characters (optional, either or both), and the short-answer prompts from configuration, such as why you want to tutor with LearnThrive (required, with a sensible minimum length) and how you would help a learner who still does not understand a topic after two explanations (optional). Character counters help but must not be the only way to understand a limit.
- Section 6, Supporting documents (optional): up to five files. Each file has a type selector (Qualification or certificate, Identity document, Right-to-work document, Other). Show this text prominently: this is where you can upload your identity and right-to-work documents for now, until we put a separate secure process in place. Uploading them now is optional and you can provide them later when asked. Only upload what is needed, do not send anything else personal, and do not send bank details or health information. State how the documents will be used (to verify identity and right to work), that they are handled by the hiring team, and how long they are kept: while you work with LearnThrive as a self-employed tutor and for 12 months after that, so you do not have to start again if you return, and then deleted (for unsuccessful applicants they are deleted with the rest of the application, as set out in the privacy notice). Also say not to upload a DBS certificate. Use wording the owner must approve (see the privacy section). Show the same text on the privacy notice.
- Section 7, Safeguarding agreement: required. See the next section for its design.
- Section 8, Check and send: a review panel that lists what is missing or invalid with links back to the field, and shows the chosen files and total size. Then the other required declarations: the information is accurate and nothing relevant to suitability has been left out; you agree to an Enhanced DBS check including the Children's Barred List, carried out by LearnThrive, if you are offered a place (state that LearnThrive pays unless you already hold a suitable certificate or choose to pay for your own); you understand tutors are self-employed and that any start is subject to the checks described; you have read the applicant privacy notice (an acknowledgement, not consent). If the talent pool switch is on, a separate unticked optional box. Then the human check status and the submit button.
- Invisible honeypot field and a minimum time-to-submit check (for a long form, around thirty seconds), both ignored by people and assistive technology.

Upload field behaviour:

- Each upload is a real labelled file input, optionally enhanced with a drag-and-drop area. Everything must work with keyboard and screen readers. Show name and size after choosing, let people remove and replace a file, announce changes in an `aria-live` region, and show a running total against the cap.
- Check type, size, empty files, count and total in the browser, with friendly messages that suggest "save as PDF" for unsupported formats. `.doc`, macro-enabled Office files, archives and executables are refused.
- Resize large JPEG and PNG photos in the browser before upload so scans stay small, keeping them legible. Test iPhone photo formats and the iOS file picker, and say what you could not test.
- Applicants who cannot use the form get a visible "apply by email" option that opens an email to the destination address, and the same text shows inside `<noscript>`. Note that applying by email cannot capture the agreement in the same way, so the email route must tell the person that they will be sent the safeguarding agreement to read and confirm before anything else happens.

## The safeguarding agreement, and hardening all safeguarding wording

### The agreement

Write the agreement once, in `src/lib/safeguarding-agreement.ts`, as structured data: a version string, an effective date, a short plain-English introduction, a list of definitions, and clause groups, each with an id, a heading and numbered clauses (each clause with its own id and full wording). Everything else (the public page, the form, the emails, the server checks, the understanding check, the tests) reads from this single source. Keep every earlier version in the repository, never edit a published version in place, and increase the version whenever the wording changes.

The owner wants the agreement to be as explicit and as hardened as possible. Apply these writing rules to every clause:

- One specific, checkable obligation per clause, written as "I will" or "I will not". No escape words such as "try", "where possible", "reasonable", "normally", "generally", or "appropriate" unless the term is defined.
- Where a rule can be stated, state it. Do not leave it to judgement. Give concrete examples.
- State timing exactly: "immediately", "the same day", "before the next lesson".
- Define terms once, in the definitions list, and use them consistently.
- The agreement applies at all times, in lessons and outside them, online and offline, to every LearnThrive student, and, where a clause says so, after lessons or the working relationship end.
- State the consequences of breaking it plainly.
- Plain English that a sixth-former could follow, firm in tone.

Definitions to include: student; family (a student's parent, guardian or any other family member); LearnThrive channels (only the lesson platform and communication routes that LearnThrive provides or approves in writing); contact (any communication of any kind, including voice, video, text, messaging apps, email, social media, gaming platforms, via other people, or in person); safeguarding concern (as set out in the first group below); the safeguarding lead (Tahasin Hasan) and the deputy safeguarding lead (Abdurrahman Mustafa); checks.

Starting draft of the clauses, for the owner to approve. Keep the meaning and make the wording as precise as you can, and add any clause you judge necessary if it fits these rules. Do not weaken any clause.

Part A, Reporting and responding

- A1. The safeguarding lead is Tahasin Hasan and the deputy is Abdurrahman Mustafa. I will report any safeguarding concern to the safeguarding lead immediately, and never later than the same day, using the contact route LearnThrive gives me. If the lead cannot be reached I will report to the deputy. If my concern is about the safeguarding lead I will report it to the deputy, and if it is about both of them I will report it directly to the police or the local authority children's services.
- A2. If a child is in immediate danger I will call 999 first, and then tell the safeguarding lead as soon as it is safe to do so.
- A3. A safeguarding concern includes: a child telling me, or hinting, that they or another child have been hurt, neglected, abused, frightened or are at risk; signs of injury, neglect, distress, self-harm or fear that I see or hear in a lesson; a child saying they feel unsafe or that an adult is behaving in a way that worries them; worrying behaviour by any adult that I see or hear during a lesson, including another adult in the room; signs that a child is being groomed or exploited, online or offline; anyone contacting a child in a way that worries me; any contact request, gift or inappropriate behaviour from a student or family member towards me; and worrying or inappropriate behaviour by any adult connected with LearnThrive, including other tutors and the directors. If I am unsure whether something counts, I will report it.
- A4. When a child tells me something worrying I will listen calmly, I will not ask leading questions, I will not investigate, I will not promise to keep it secret and I will tell them I may need to pass it on to keep them safe, and I will not discuss it with anyone except the safeguarding lead, the deputy or the emergency services.
- A5. I will write down what I saw or heard, in the child's own words where possible, with the date and time, and give it to the safeguarding lead straight away. I will not keep my own copy after I have passed it on unless LearnThrive tells me to.
- A6. I will follow the safeguarding lead's instructions on any safeguarding matter immediately.

Part B, Contact and communication

- B1. I will communicate with students and their families only through LearnThrive channels, and I will teach only on the lesson platform LearnThrive provides.
- B2. I will not contact, or reply to contact from, any student or family member outside LearnThrive channels in any way, including phone calls, texts, WhatsApp or other messaging apps, email, social media, direct messages, gaming platforms, or through friends or relatives. If a student or family member contacts me outside LearnThrive channels I will not engage, and I will report it to the safeguarding lead the same day.
- B3. I will not share my personal phone number, email address, social media or any personal account details with a student or family member, I will not ask for theirs, and I will not follow, befriend, connect with or message them on social media.
- B4. I will not arrange, offer or agree private or unpaid lessons, extra sessions or any tuition outside LearnThrive with any student I meet through LearnThrive, and I will not ask or encourage a student or family to leave LearnThrive.
- B5. I will not send, request or exchange photographs, videos, voice messages, links, files or any other content with a student, other than lesson materials shared through LearnThrive channels.
- B6. I will never ask or tell a student to keep a secret from their parent or guardian or from LearnThrive.
- B7. For as long as a student is under 18, I will not contact that student outside LearnThrive channels after I stop teaching them or after I stop working with LearnThrive.

Part C, Lessons and setting

- C1. Every lesson will take place online on LearnThrive's lesson platform. I will never meet a student in person, arrange to meet one, visit a student's home, or invite a student or family member to mine.
- C2. I will teach from a private, suitable room. Nobody else will be able to see or hear the lesson or the student. If anyone enters the room or I am interrupted, I will pause the lesson immediately and will not resume until the room is private again.
- C3. I will keep my camera and microphone on for the whole lesson, and I will not turn off my video or end the call early unless the lesson platform requires it or a safeguarding reason requires it.
- C4. I will be suitably dressed, my background will be plain and suitable for children, and nothing inappropriate will be visible or audible in my setting.
- C5. I will not record, photograph, screenshot, transcribe or otherwise capture any lesson or any student, and I will not allow anyone else to. I will not use AI note-takers, transcription tools, bots or recording plugins in any lesson.
- C6. I will not teach while unwell in a way that affects my judgement, or while under the influence of alcohol or any drug.
- C7. I will not teach a student I have a personal connection with (a relative, friend, neighbour or any other personal relationship) unless the safeguarding lead has agreed in writing beforehand, and I will tell the safeguarding lead the same day if I find that a student is someone I know.

Part D, Conduct and boundaries

- D1. I will keep my language, content, behaviour, jokes and examples professional and suitable for children at all times. I will not use swearing or discriminatory, sexual, violent, frightening or otherwise unsuitable language or material. Where the curriculum covers a sensitive topic I will handle it factually and in an age-appropriate way.
- D2. I will not form, or try to form, any romantic, sexual, secret or otherwise inappropriate relationship with any student, whatever their age, and I will not say or do anything sexual or flirtatious to or in front of a student.
- D3. I will not give or accept gifts, money, favours or special treatment, other than the agreed payment for tuition made through LearnThrive.
- D4. I will not ask a student about their private life, family, body, relationships, religion, health or home circumstances beyond what I need in order to teach them, and I will not comment on a student's appearance.
- D5. I will treat every student fairly and with respect. I will not shout at, bully, humiliate, threaten or discriminate against any student.
- D6. I will not pressure a student or make them feel uncomfortable or afraid. If a student tells me they are uncomfortable, I will stop that activity immediately.
- D7. If I make any mistake or lapse that breaks this agreement, however small, I will tell the safeguarding lead the same day.

Part E, Information and data

- E1. I will keep all information about students and families confidential. I will discuss a student only with LearnThrive, or with the student's parent or guardian through LearnThrive channels, except where this agreement requires me to report a concern or the law requires me to disclose information.
- E2. I will keep only the student information I need to teach, I will keep it on a password-protected device with up-to-date security, I will not store it in personal cloud, messaging or social media accounts, and I will delete it when I no longer need it or when LearnThrive asks me to.
- E3. I will not share lesson links, login details or any materials that identify a student with anyone.
- E4. I will not post or share anything about LearnThrive students online, including on social media, even without names.

Part F, Checks, honesty and changes

- F1. I agree to an Enhanced DBS check including the Children's Barred List, carried out by LearnThrive, and to every other suitability check LearnThrive carries out, including identity and right-to-work checks. I will give true and complete information promptly and I will cooperate fully.
- F2. I will not teach, or have any contact with, any LearnThrive student until LearnThrive has confirmed in writing that every check is complete.
- F3. I confirm that I am not barred from working with children, that I am not subject to any disqualification, order, restriction or sanction that prevents me from working with children, and that I will not work with children in any role from which I am barred.
- F4. Everything I have told LearnThrive in my application is true and complete, and I have not withheld anything relevant to my suitability to work with children. I understand that false or incomplete information may lead to my application, or my work with LearnThrive, ending immediately.
- F5. I will tell the safeguarding lead immediately, and never later than the same day, if anything changes that could affect my suitability to work with children. This includes a police investigation, arrest, charge, caution, conviction, barring decision or disqualification; any allegation or concern about my conduct towards a child anywhere; and any decision by an employer, school, regulator or other body about my suitability.

Part G, Reconfirmation, cooperation and consequences

- G1. I will reconfirm this agreement every year, and whenever LearnThrive issues a new version, by the date LearnThrive sets. I understand that I must stop teaching if I do not.
- G2. I will cooperate fully, honestly and promptly with any safeguarding review, investigation or request for information, including from LearnThrive, the police, the DBS or the local authority.
- G3. I understand that if I break any part of this agreement LearnThrive may suspend me immediately and without notice, end my work with LearnThrive, and report me to the police, the DBS, the local authority or any other body where required or appropriate.
- G4. I understand that LearnThrive may share information about my conduct, this agreement and my checks where that is needed to protect children.
- G5. These expectations are part of the tutor agreement I will sign. This agreement applies to everything I do as a LearnThrive tutor, at all times, in lessons and outside them, online and offline. I have read this agreement in full and I have read LearnThrive's safeguarding page. If I do not understand any part of it, I will ask the safeguarding lead before I agree.

Mark every clause that goes beyond the rules the owner has confirmed in this prompt (the owner confirmed: reporting to the safeguarding lead and deputy, the DBS check and who pays, no teaching until every check is complete, yearly reconfirmation, safeguarding as part of the tutor agreement, and lessons not recorded by default) with `ownerApproved: false` in the data. List all of them in your report so the owner can approve or remove each. A build-time test must fail if the agreement is marked as approved in configuration while any clause is still unapproved.

The wording is a draft for the owner and for legal review. Several clauses (B7, C3, C5 on AI tools, C6, F3, G3, G4) are firm requirements that need particular care before they are enforced; say so in your report.

### The understanding check

To make careless agreement harder, add a short understanding check to Section 7, after the clause groups and before the typed name. It is not training and must not be described as training. Write six multiple-choice questions taken directly from the agreement, each with one correct answer, for example: who to tell about a concern and by when; what to do first if a child is in immediate danger; what to say if a child asks you to keep something secret; whether you may give a student your personal phone number; where a lesson may take place; and what to do if someone walks into the room during a lesson.

- All six must be answered correctly to continue. Wrong answers show which question needs another look, without revealing the answer, and the applicant can try again as often as needed. Nothing about the attempts is stored.
- The correct answers are checked on the server too, using question and answer ids, so the form cannot be bypassed. Order the answers so the correct one is not always in the same place.
- Accessible radio groups, keyboard operable, with clear error text.
- The record in the email states that the check was passed, not the answers.
- It can be switched off in configuration. It is on for applications and off for reconfirmations by default.

### How the form captures it (Section 7)

Make it hard to agree carelessly and easy to prove afterwards:

- Show the definitions and every clause of every part in full on the page, not hidden behind a link. Each part (A to G) has its own required checkbox, labelled "I have read and agree to every clause in Part X: <heading>". The full text is also at `/careers/safeguarding-agreement`.
- Show the understanding check described above (when enabled).
- Require the applicant to type their full name as their confirmation. The server compares it with the first and last name given in Section 1, ignoring case and extra spaces, and rejects the application if it does not match.
- Show the agreement version on the page and send it with the form. The server rejects a submission made against an out-of-date version.
- The server rejects the application if any part is not confirmed or the understanding check is not passed, so the form cannot be bypassed by editing the page.
- The approval gate applies: while `agreementApprovedByOwner` is false, the form is not offered and the route refuses submissions.
- The server records, in the internal email and the applicant's confirmation email: the agreement version, the typed name, the list of confirmed part and clause ids, that the understanding check was passed, the server time of the submission, and a SHA-256 hash of the exact agreement text that was shown, so there is evidence of what was agreed. Do not record the applicant's IP address.
- The confirmation email to the applicant includes the version, the date and the link to the agreement, and says the applicant will also sign the tutor agreement, which includes the same expectations.
- Treat the typed name as a simple electronic confirmation and flag in your report that the owner should take advice on how strong this is as a record, and on whether to ask applicants to re-sign by another route at the tutor agreement stage.

### Yearly reconfirmation

Tutors reconfirm the agreement every year and whenever a new version is issued. With no login and no database, make this work with a small page and an email record:

- `/safeguarding/reconfirm` shows the current agreement version and every clause group in full, each with its own required checkbox, in the same style as Section 7 of the application form. Fields: full name, email, a required choice between "Nothing has changed that could affect my suitability to work with children" and "Something has changed" (choosing the second shows a clear instruction to contact the safeguarding lead directly and immediately, using the existing contact details, and the submission is marked as a declared change), typed full name as confirmation (must match the full name field), a honeypot, a minimum time, and the shared human check.
- `POST /api/safeguarding/reconfirm` applies the same server rules as the application: origin check, rate limit, current version required, every clause group required, typed-name match, and the human check. It emails the destination address with a reference in the form `LT-RECONF-` plus the date plus six characters, and a subject such as `Safeguarding reconfirmation: <name> - <version> - <reference>` (add a clear marker such as `[CHANGE DECLARED]` when applicable). The body records the version, the typed name, the confirmed clause group and clause ids, the server time and the SHA-256 hash of the agreement text shown. It then sends the tutor a short confirmation with the same record and a link to the agreement. Do not record the IP address.
- The page cannot verify that the person is really a LearnThrive tutor, because there is no login. The owners match each submission against their list of tutors. Say so in a code comment and in the owner notes.
- Add `docs/AGREEMENT_RECONFIRMATION.md` for the owners: a simple yearly process (a spreadsheet of tutors with the date and version last confirmed, a reminder a few weeks before each anniversary, sending the page link by email, checking each submission against the list, and what to do about anyone overdue or who declares a change). Say that when the agreement version changes, every active tutor must reconfirm, and that the owners decide the deadline. Do not publish a specific deadline.
- Retention for reconfirmation records (and the agreement record made at application, for tutors who are engaged): kept while the tutor works with LearnThrive and for 6 years after that, matching the personnel records wording in `legal-faqs.tsx`. Any record connected to a safeguarding concern, allegation or investigation is kept longer, separately and with restricted access, as the safeguarding lead and legal advice require, which the legal FAQ already allows for. State this in the privacy notice.
- The public pages can say tutors reconfirm the agreement every year, because this mechanism makes it true, but the owners must actually run it. Point that out in the report.

### Hardening every safeguarding mention

Search the whole repo (all pages, components, FAQ data, `legal-faqs.tsx`, metadata, emails, `LEGAL_REVIEW.md`) for safeguarding, DBS, induction, training, refresher, code of conduct, vetting and similar wording. For every mention:

- Remove all refresher training wording and any induction wording, including the "annual refresher training" statement and the "safeguarding induction" item in `legal-faqs.tsx`. Replace the induction item with agreement to the safeguarding agreement. Remove or reword "Tutor Code of Conduct" unless a document with that name exists; the safeguarding agreement can take its place, and you should say what you did.
- Where a statement describes something the owner has confirmed, state it firmly and specifically: use "must" and "will", name the roles and people, give the exact route for raising a concern, and remove soft phrases such as "should", "aim to", "where appropriate", "may be asked" and "we try to".
- Where a statement is a "should" working position that the owner has not confirmed as practice, do not turn it into a flat claim. Keep it as it is, or flag it, and list it in your report. Do not make any safeguarding statement firmer than the facts allow.
- Update the DBS wording in `legal-faqs.tsx` (the "appropriate level of DBS check" item) to the owner's decision: an Enhanced DBS check including the Children's Barred List. Keep the existing sentence that LearnThrive must not request DBS information it is not entitled to, and flag the entitlement question.
- Make wording consistent everywhere: the same names, the same description of the DBS check and who pays for it, the same description of the agreement, the same reporting route, and the same position that lessons are not recorded by default.
- Strengthen `src/app/safeguarding/page.tsx` with: who the safeguarding lead and deputy are; what every tutor must agree to before teaching (a plain summary of the agreement, linking to the full text); that no tutor teaches any student until every check is complete; that tutors reconfirm the agreement every year; the DBS check and who pays; how a parent, a student or a tutor raises a concern, with the existing contact details from `site.ts`, and a plain instruction to call 999 if a child is in immediate danger; the relevant national helplines (NSPCC and Childline) only if you verify the numbers and names against the official websites before publishing; and the confirmed facts about how concerns are recorded from `legal-faqs.tsx`. Do not describe any investigation or escalation process that is not already written down in the repo or confirmed by the owner.
- In your report, give a before and after list of every safeguarding statement you changed, tagged as confirmed, flagged, or removed.

## Subject requests on the subjects page

Add a section to `src/app/subjects/page.tsx`, placed after the existing subject content and before the closing call to action, headed something like "Can't see your subject?". It explains, in one or two sentences, that families can ask for a subject LearnThrive does not yet offer, and that if there is enough interest the owners may add it. It must not promise that any subject will be added or give a date or a number.

- Build a `SubjectRequestForm` component in the existing form style, with its own small CSS module.
- Fields: the subject (a select with common options such as Computer Science, Biology, Chemistry, Physics, History, Geography, French, Spanish, Business Studies, Economics, Psychology, Music, and a final option labelled "Other"). When "Other" is chosen, a text box appears directly below, labelled "Which subject?", required, with a sensible length limit (for example 2 to 60 characters). When another option is chosen, the text box disappears and its value is ignored. The new text box must be announced to screen readers, focus must not jump unexpectedly, and the field must work with the keyboard. Then the level (the existing year groups plus "Not sure"); who is asking (a parent or guardian, or a student); an optional note up to 500 characters; and an optional email address with a separate unticked checkbox: "Email me if this subject becomes available". No child names and nothing else personal. Anonymous requests (no email) are allowed.
- On the server, validate the select against the allowed list. If "Other" is chosen, require the text, trim and clean it (remove line breaks and control characters, collapse spaces, cap the length, strip anything that looks like markup), and escape it everywhere it is used.
- Anti-abuse: the same shared human check, honeypot and minimum-time check as the careers form (a shorter minimum time), plus origin check and a rate limit on `/api/subject-request`.
- The route emails the destination address (read from `SUBJECT_REQUEST_EMAIL`, falling back to `ENQUIRY_EMAIL`, falling back to the site email). Use a consistent subject line such as `Subject request: <subject> (<level>)`, and for typed-in subjects `Subject request [other]: <subject> (<level>)`, so the owners can count requests by searching the mailbox. Send a plain, structured body with all free text escaped. If the person gave an email and ticked the box, send one short confirmation that says their interest has been noted and that they will only be emailed if the subject becomes available, with a link to the privacy page. Otherwise send no confirmation. Do not add anyone to a list: the owners handle it by hand.
- Add `docs/SUBJECT_REQUESTS.md` for the owners explaining how to count requests from the mailbox, how to treat typed-in subjects that are spelled differently, suggesting a label or folder and a simple spreadsheet, and noting that the threshold for adding a subject is theirs to decide.
- Provide an accessible fallback if JavaScript is off (an email link shown in `<noscript>`).
- Cover this in the privacy page, `LEGAL_REVIEW.md` and the cookies check as for the careers feature. Retention for subject requests: kept until that subject is added, or 12 months after the request if it has not been added by then, whichever comes first, or sooner if the person asks for deletion. Anonymous requests with no email address contain no personal information. State this in the privacy notice. Optionally add a short FAQ entry "Can you teach a subject that is not listed?" if that fits the existing FAQ structure.

## The subjects page: add each subject's hero card

On `/subjects`, each subject section has a header row with text on one side and a photo on the other (the `subjectHeader` layout, alternating sides), followed by the level cards, then the 11+ section. The owner wants the same hero used on that subject's own landing page (`/maths-tuition`, `/english-tuition`, `/science-tuition`, `/11-plus-tuition`) shown between the text and the image if it fits, or wherever works best.

What the landing-page hero is: `SubjectLandingPage` renders `PageHero` with an aside card (`subject-landing-hero-card`) showing the subject icon, a label such as "Maths tuition", the stage line such as "KS2 to A Level" and a short note, all taken from `subjectLandingPages` in `src/lib/site.ts`.

What to do:

- Extract the hero card into a small shared component (for example `SubjectHeroCard`) that both `SubjectLandingPage` and the subjects page use, taking its content from `subjectLandingPages` so there is one source of truth. Do not duplicate the copy. The landing pages must look and behave exactly as before; compare them in the browser before and after.
- On the subjects page, place the card between the text column and the image in each of the Maths, English and Science sections, keeping the existing alternating left and right layout. On wide screens try a three-part row (text, card, image). Check it at 1440, 1280, 1024, 768 and 390 pixels wide. If the three-part row looks cramped at 1280 or below, use whichever works better: the card as a floating card overlapping the seam between the text and the image, or the card directly under the text with the image beside both. Choose what looks best and say what you chose. On mobile, stack in this order: text, card, image.
- Give the card a link to the subject's own landing page, using the existing `ctaLabel` (for example "Explore Maths Tuition"), so the existing browser checks that look for those links still pass.
- For 11+ Preparation, which has a card instead of a photo, place the 11+ hero card in the same relative position inside or beside the existing 11+ card, again choosing what looks best.
- Restyle the card for the subjects page's own look (it uses its own CSS module and visual style) while keeping it clearly the same card: same icon, label, stage and note. Reuse the existing icon component. No new imagery.
- Keep the jump links, ScrollReveal behaviour, accessibility (heading order, alt text, focus order, the link's accessible name) and reduced motion intact. Do not change the subject text, level cards or photos.
- Extend the browser checks: the cards appear in each section, the links go to the right landing pages, there is no horizontal overflow at 360 pixels, and axe is clean.
- Terminal output of some files in this repo shows garbled punctuation (for example the dashes). The files are valid UTF-8 and are not corrupted; it is only how a terminal displays them. Read and write them as UTF-8 and do not "fix" the characters.

## The human check

Build a self-hosted proof-of-work check, shared by the careers form and the subject request form. No third-party service, no cookies, no storage.

- `GET /api/careers/challenge` returns a random challenge with an expiry time, a difficulty and a signature made with a server secret (`CAPTCHA_SECRET`, at least 32 random bytes, read from the environment, never sent to the browser).
- A Web Worker in the browser finds a value that makes `SHA-256(challenge + value)` meet the difficulty, without freezing the page. Start solving when the visitor reaches the later sections (or the form) or after the page is idle, so the work is usually finished by the time they submit. Show a clear status near the submit button: checking, verified, or could not verify with a retry button. Announce changes with `aria-live`.
- The submit request carries the challenge, signature and solution. The server checks the signature, expiry, the proof, and that the challenge has not been used before (keep used identifiers in memory until they expire; note in a code comment that this is correct for a single Render instance and needs a shared store if the service ever scales to several).
- Tune the difficulty by measurement so it takes about a second on a mid-range phone and stays quick on a laptop. Record the number you chose and the timings you measured.
- If workers or the required browser features are unavailable, fall back to a simple text question generated and signed by the server (for example a short sum) so no one is locked out, and keep the email route visible.
- Rate-limit the challenge endpoint.
- Write it as a small reusable module under `src/lib`. Do not wire it into the existing enquiry form as part of this work.

## The careers server route (`POST /api/careers/apply`)

- Accept multipart form data. Read the declared content length first and reject oversize requests before processing them.
- Verify the origin the same way the enquiry route does (allowed origins from the environment). Apply a stricter per-visitor rate limit than the enquiry route, keep the in-memory limiter as it suits one Render instance, and note it resets on restart. Determine the correct client address header for Render and test it, and never trust a client-supplied value blindly.
- Check the honeypot, the minimum-time value and the human-check proof.
- Re-validate every field on the server, including lengths and that every choice matches the allowed list, that at least one results box is filled in, that every required declaration is present, that every clause group of the safeguarding agreement is confirmed, that the understanding check is passed (if enabled), that the agreement version is current, and that the typed name matches.
- Check what each file actually is, not what it is called. A PDF must begin with the PDF signature. A DOCX must be a zip that contains the expected Word parts, inspected without unpacking whole archives. JPEG and PNG must have the right signatures. Refuse encrypted PDFs, PDFs that contain script or launch actions (a byte scan is enough), macro-enabled content and anything else unexpected. Clean file names: strip paths, restrict characters and length, and handle double extensions. State clearly in a code comment that the route cannot scan for viruses, that attachments are untrusted, and that the destination mailbox filtering is the second layer.
- Create a reference number from a secure random source, in the form `LT-APP-` plus the date plus six characters (leave out confusing characters).
- Send the internal email first, to the destination address, from the existing from-address setting, with `replyTo` set to the applicant. Build the subject only from sanitised values with no line breaks, for example `Careers application: <role> - <name> - <reference>`, and add a clear marker such as `[ID documents attached]` when any identity or right-to-work file is included. The body is an HTML and a plain-text version with all answers laid out clearly, all free text escaped, the file list with types and sizes, the safeguarding agreement record described above, and a short banner that attachments came from a public web form and are untrusted. Identity and right-to-work attachments are flagged as sensitive, with a reminder to delete them once verification is complete and not to forward them.
- Only if that send succeeds, send the applicant confirmation (no attachments, no copy of their answers): the reference, the role, "We will reply within 5 working days", the agreement version and link, how to withdraw or ask for their data, and a link to the applicant privacy notice. If the confirmation fails after the internal email succeeded, still report success and log the outcome without personal data.
- If the internal send fails, return a friendly error and do not send a confirmation, so no one is told their application arrived when it did not.
- Do not use Resend's batch endpoint, which does not accept attachments.
- Logging: reference, outcome, sizes and counts only. Never names, emails, answers or file content.
- Environment variables: `CAREERS_EMAIL`, `SUBJECT_REQUEST_EMAIL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ALLOWED_ORIGINS`, `NEXT_PUBLIC_SITE_URL` (already used) and `CAPTCHA_SECRET` (new). Create the email client at request time through the shared helper. If configuration is missing in production, respond with a clear, friendly failure and make sure the build never needs the keys. Add every variable, commented and without values, to a new `.env.example`.

## Applicant privacy and legal updates

Draft all of this for the owner to approve; do not present it as legally reviewed. Do not claim facts you cannot verify.

- New `/careers/privacy` page in the existing legal-page layout: who is responsible (use the company details already in the repo, taking them from one shared place in `site.ts`, and flag that the owner must verify them at Companies House), what is collected and why (to assess applications and to carry out identity, right-to-work, DBS and other suitability checks for working with children, and to keep records of the safeguarding agreement and its yearly reconfirmation), who receives it (the email provider Resend, the hosting provider Render, and IONOS for the company mailbox), where transfers may occur (use cautious wording and flag for the owner), how long it is kept (use the schedule already in `legal-faqs.tsx`: up to six months after the decision for unsuccessful applications, or 12 months if the applicant ticks the talent pool box; the existing personnel-records wording for tutors who are engaged, except that identity and right-to-work documents are kept while the tutor works with LearnThrive and for 12 months after that, and then deleted, so a returning tutor does not have to start again, and that the safeguarding agreement and reconfirmation records are kept while the tutor works with LearnThrive and for 6 years after that, or longer where linked to a safeguarding concern; for unsuccessful applicants, identity documents are deleted with the application; subject requests are kept until the subject is added, or 12 months after the request, or until the person asks for deletion), applicants' rights, how to withdraw, how to complain to the ICO, that no automated decision-making is used, and that the website itself stores nothing. Include a plain explanation of the identity and right-to-work upload and the option to provide those documents later. State the DBS payment rule as the owner gave it, state that the check is an Enhanced DBS check including the Children's Barred List arranged through the DBS process, and say that DBS certificate information is not collected through this website.
- Update `src/app/privacy/page.tsx` to mention applicant information and subject requests and to link to the new notice, and add the careers pages to the footer legal links if that fits.
- In `src/lib/legal-faqs.tsx` the list of providers names Google Workspace and Gmail for company email. The owner says company email is currently with IONOS. Reconcile this: list IONOS as the email provider and remove Google references unless the owner confirms Google is also used. Flag the change in your report.
- Apply the safeguarding changes described above, update `LEGAL_REVIEW.md` accordingly (it says no named lead was verified), add the careers and subject-request data flows to it, applying its future-change gate: what data each feature receives, purpose, lawful basis to be confirmed, processor roles, transfers, retention, and what was checked after deployment. Record as open items: confirmation that LearnThrive is entitled to request an Enhanced DBS check with the Children's Barred List for its self-employed online tutors (and which route is used), how the DBS payment rule works when an applicant already holds a certificate and what counts as a suitable certificate, the strength of a typed-name agreement, the removal of refresher training with the effect on the safeguarding statements, the 6-year retention of agreement and reconfirmation records and when longer retention applies, and keeping identity documents in a shared mailbox for an engagement plus 12 months.
- Check the existing cookies page. It should remain accurate, since neither feature adds cookies or storage.
- Add `docs/RETENTION_AND_DELETION.md` for the owners: for each kind of data (applications, identity and right-to-work documents, agreement and reconfirmation records, subject requests, enquiries) say where it lives (the info@ mailbox on IONOS, the Resend sending log, and any copies), how long it is kept under the owner's rules, who deletes it and how, and a simple log to keep (for example a spreadsheet noting which tutors have identity documents on file, in which messages, and when they were deleted). Because identity documents stay for the whole engagement plus 12 months, include a clear instruction to delete them, and the message they arrived in, 12 months after a tutor stops working with LearnThrive (or with the application, for unsuccessful applicants), and to check the Resend log too. Note that holding identity scans in a shared mailbox is a security risk that should end when a proper secure store exists.

## Design and accessibility

- Reuse the current tokens, spacing, type, radii, shadows and motion rules. New pieces (role card, process list, file field, form section header, section navigation, upload meter, careers call to action, agreement commitments list, subject request panel) are built from the same tokens in CSS modules, in the style of the book and contact pages.
- Same voice as the rest of the site: warm, clear and plain. Short sentences. The safeguarding agreement is the exception to warmth: it should read as firm and unambiguous, while staying easy to understand.
- Meet the standard the site already meets: a label for every control, fieldsets and legends for grouped questions, visible focus, error text connected to its field, text and non-text contrast, touch targets of at least 44 pixels, no reliance on colour or dragging, reduced motion respected, no horizontal scroll at 360 pixels, usable at 200 per cent zoom, and keyboard-only completion of both forms.
- Do not add imagery that is not already in the repo.

## SEO and structured data

- Titles, descriptions, canonical URLs and social previews through the existing metadata helper. Hub, open role pages and the agreement page in the sitemap. The apply page and the confirmation state are not indexed.
- JobPosting structured data on open role pages only, with accurate title, description, posting date, closing date if any, hiring organisation, remote working, contractor employment type and the 10 pounds per hour pay with the "per student" detail in the description. Check Google's current job posting documentation before adding it, keep it identical to the visible page, and omit it if you cannot make it accurate. Remove it automatically when a role closes.

## Deployment on Render

- Do not deploy anything. Make the code ready and document what is needed.
- Render runs this as a web service (`npm ci && npm run build`, then `npm start`, which uses the `PORT` Render provides). Free instances spin down after about fifteen minutes of inactivity and cold start slowly, so a paid instance is needed for a live site with forms. Add a small health route if one does not exist, and a short `docs/RENDER.md` with the build and start commands, the environment variables, the health check path and the upload-limit test.
- Email: Resend sends through its own verified sending domain records while the company mailboxes stay with IONOS. Write down that the existing IONOS mail records must be left intact when adding Resend's records, that SPF and DKIM and a DMARC policy need setting and testing, and that a test application and a test subject request should be sent end to end after deployment.
- Operational note for the owner in the report: the destination is the main info@ mailbox. Applications with attachments add up (identity scans especially), so mailbox size, a filter or folder for careers and subject-request messages, and a deletion routine matching the retention schedule all need deciding. The emails that hold the signed agreement records and yearly reconfirmations are evidence, so they should be kept for the agreed period and not deleted early.

## Tests and quality gates

- Unit tests for validation and the file-checking code with small real fixtures: valid PDF, DOCX, JPEG and PNG; wrong extension, spoofed content type, empty file, oversize file, double extension, very long and unusual file names, path traversal names, an encrypted PDF, a PDF with script, and a macro-enabled file.
- Tests for the safeguarding agreement: every clause group required, the understanding check (all correct answers needed, checked on the server), the approval gate (applications and reconfirmations refused while the agreement is not marked as owner-approved), typed name must match, name mismatch rejected, outdated version rejected, hash recorded and matching the text, and the single source being used by the page, the form and the emails. For reconfirmation: every commitment required, typed name must match, current version required, declared change flagged, record and hash in the email, confirmation sent, honeypot, human check, rate limit and bad origin.
- Tests for the human check: valid solution, wrong solution, expired, tampered signature, reuse, and the fallback question.
- Route tests with email mocked, for careers: success sends both emails with the right attachments and the agreement record; internal failure sends no confirmation; confirmation failure still succeeds; bad origin; rate limit; honeypot; too fast; bad challenge; missing DBS agreement; missing results; oversize body; missing configuration; and the build working with no email key set. For subject requests: success with and without an email address, "Other" requiring text and ignoring it otherwise, confirmation only when consent is ticked, normalised subject line, invalid choices rejected, honeypot, rate limit, bad origin.
- Extend `scripts/browser-check.mjs`: complete the full careers form with the keyboard only, including every clause group checkbox, the understanding check and the typed name; add and remove files; trigger every error and see the summary take focus; success state focus; the subject request form on `/subjects` completed, including the "Other" text box appearing and disappearing, and submitted against a mocked or test route; a phone viewport; no horizontal overflow; axe clean on every careers page, the agreement page, the reconfirmation page, the safeguarding page and `/subjects`; no cookies, no browser storage and no third-party requests; the no-JavaScript fallbacks; and role pages including a closed role and an unknown slug.
- A repo-wide check, as a test or script, that fails if the words "refresher" or "induction" appear in public copy, so they cannot creep back.
- Run lint, typecheck, tests, build and the browser check at the end and fix anything you broke. Do not weaken any existing test.
- Manual checks to do and report on: a real end-to-end application and a real subject request to a real inbox (use a test address you control), how the emails look in a webmail and mobile client, and iPhone and Android file selection.

## Order of work

- Baseline and branch. Shared email-client helper. Configuration, role data and the single-source safeguarding agreement. File-check, validation and human-check modules with their tests.
- Hub, role pages, the agreement page and the applicant FAQ. Applicant privacy notice.
- The application page and its upload fields, then the route and both emails.
- The site-wide safeguarding wording pass (including `legal-faqs.tsx` and the safeguarding page).
- The yearly reconfirmation page, route and owner notes.
- The subject request form, route and owner notes.
- The subjects page hero cards (shared component, layout checks at the five widths).
- Updates to the footer, home band, about, privacy, legal FAQ provider correction, sitemap and `LEGAL_REVIEW.md`.
- Structured data, accessibility pass, browser checks, the Render notes and `.env.example`.
- Final full run of all checks, then the report.

## Stop and ask the owner if

- You need to add a dependency, or you find a requirement that cannot be met without storing data.
- The existing tests or build break in a way that cannot be traced to your change.
- A piece of copy would need a fact that is not in this prompt or the repo.
- A safeguarding statement cannot be made firmer without claiming something unconfirmed.
- Anything suggests personal data could be logged, cached or exposed.

## Final report

Finish with a short report containing: what was built and the main files; every configuration value you chose and why (limits, difficulty, rate limits); all items marked for owner confirmation (whether online tuition qualifies for the Children's Barred List check, and the approval of the agreement wording; also list every default chosen on the owner's behalf, so the owner can reverse any of them); the full draft agreement for approval, with every clause that goes beyond the owner's confirmed rules listed separately so the owner can approve or remove each one; the provider correction from Google to IONOS; the before and after list of every safeguarding statement changed; what you tested and what you could not test (devices, Render's real upload limit, real email delivery); known limitations (in-memory limits, no virus scanning, manual deletion and manual counting of subject requests, identity documents arriving by email, typed-name agreement strength); and the commands to run the checks.
