# LearnThrive careers: plan for a complete careers page with online applications

Repository: `D:\LearnThrive` (the marketing site: Next.js 16, React 19, strict TypeScript, Resend for email).
Prepared: 9 October 2026, after reading the current site code, `LEGAL_REVIEW.md`, `DEPLOYMENT_PLAN.md` and the working retention schedule in `src/lib/legal-faqs.tsx`. Hosting limits below were checked against current Vercel and Resend documentation on the same day.

> Update, 9 October 2026: the owner has answered the open questions and chosen Render for hosting (so the 4.5 MB Vercel limit below no longer applies; larger limits are used but must be tested on Render). Where this plan and `CAREERS_PROMPT.md` differ, the prompt is the current instruction. Key changes: one scrolling page with numbered sections instead of a wizard, a self-built human check, identity and right-to-work documents accepted in the optional supporting documents step for now, IONOS company mailboxes, applications to info@ for now, and pay and engagement facts from the owner.

## Purpose

Give LearnThrive a careers section that looks and behaves like the rest of the site and works end to end for a visitor: browse the roles, understand the process, and submit a full application with a CV, a cover letter and supporting documents. There is no login, no database and no storage of application data on the website. Whatever the applicant submits has to reach the team some other way, and be removable on schedule.

This is the marketing site only. When the platform (`D:\LearnThriveSoftware`) gets Supabase, the same application can move into a proper applicant tracker and tutor onboarding record. The code here is shaped so that move is a swap, not a rewrite.

## Constraints that shape everything

- The site promises, in its privacy and cookie pages, that it sets no cookies and uses no browser storage. So the form cannot save drafts between visits. Progress lives in memory only, and the form should warn before the visitor leaves with unsent work.
- No database means the application must be delivered by email. The site already sends email through Resend, so the file upload feature will attach the applicant's files to an email sent to a careers inbox.
- Hosting limit that matters (verified today): Vercel caps the request body for Functions at 4.5 MB, for both Route Handlers and Server Actions, and larger uploads fail with a 413 error. Resend caps one email at 40 MB after Base64 encoding and cannot send attachments through its batch endpoint. So on Vercel the practical ceiling is about 4 MB of files in total per application. A CV and cover letter as PDFs are usually a few hundred KB each, so this is workable, but scanned certificates can be larger. The limits live in one config file so they change in one place if the host changes.
- Sending applicants' documents by email means they will also sit in the Resend sending log and in the careers mailbox. Retention and deletion have to cover both. The working schedule already says unsuccessful tutor applications are kept for up to six months after the decision, and the privacy page must say which providers hold the data.
- Everything on the page must be true. No invented pay, benefits, training, accreditations, team size or testimonials. Where this plan needs facts only the founders know, they appear as questions below, and the build uses clearly marked placeholders until answered.

## File handling: the recommended approach and the alternatives

Recommended now: the browser posts the form and files together to a new server route, which checks everything and emails the application, with the files attached, to a careers inbox. Nothing is written to disk or a database. A second email goes to the applicant to confirm receipt, with a reference number.

Alternative for later: upload straight from the browser into object storage (for example Vercel Blob, Cloudflare R2 or Supabase Storage) and email a link. This lifts the size limit but adds a stored-files processor, access control, malware scanning and automatic deletion jobs. It is not what was asked for at this stage, so it is deferred. The code keeps one function, "deliver this application", behind a small interface so the storage version or a Supabase version can replace the email version later.

Fallback for people who cannot use the form: a clear "apply by email" option with the careers address, for large files, assistive technology problems or anyone who prefers it. It is also what the page shows if the visitor has JavaScript turned off.

## Pages and routes

- `/careers`: the careers hub, top to bottom as described below.
- `/careers/[slug]`: one page per role, generated from a typed list of roles. Unknown or closed roles are handled gracefully.
- `/careers/apply`: the application form. It accepts a role in the address (for example `?role=maths-tutor`) so the Apply buttons pre-select it, and a general "register your interest" option.
- `/careers/privacy`: a dedicated notice for applicants, linked from the form, the footer and the privacy page.
- `/api/careers/apply`: the server route that receives the application.
- Updates to existing pages: footer link, a "Careers" entry in the footer (and in the header if the founders agree), a link from About and from the safeguarding page, a hiring band on the home page that only shows while at least one role is open, the sitemap, `LEGAL_REVIEW.md`, and the privacy page.

Roles live in a typed file such as `src/lib/careers.ts`, one entry per role: slug, title, status (open, closed, coming soon), subject, year groups, employment type, location (online or remote), hours, pay if the founders choose to publish it, start date, posted date, closing date, a short summary, what you will do, what we are looking for, nice to have, and how the role is assessed. Changing a role means editing this file and redeploying. That is fine at this scale, and the shape is deliberately close to what a database record would be.

## The careers hub page, top to bottom

- Hero in the existing page-hero style: eyebrow, headline, a short intro, and two actions (see open roles, and apply or register interest). The hero aside can show a quick-facts card using only confirmed facts (online, subjects, year range).
- Why teach with LearnThrive: three or four feature cards in the existing card style, using only what the founders confirm (for example flexibility, support, tools, parent communication). Icons are added in the same stroke style as the current icon set.
- Open roles: role cards using the subject accent colours already defined for Maths, English, Science and 11+, each showing title, type, location, hours and a short summary with a View role button. An honest empty state when nothing is open, with the register-interest route.
- What we look for: the qualities and practical requirements for tutors, written plainly.
- What it is like to work here: a short "a typical week" or "how lessons run" section that matches the tutor guidance the business actually uses, and an optional founders' note. Real tutor quotes only if they are genuine and permission is recorded.
- How hiring works: a step timeline (apply, review, introductory conversation, teaching demonstration or sample lesson if used, references, identity and eligibility checks, enhanced DBS check where eligible, safeguarding induction and code of conduct, first lessons). The steps must match what really happens. The existing "tutor-checks" FAQ is the starting wording.
- Safeguarding and safer recruitment: a short statement that links to the safeguarding page. It describes the process applicants will go through, and must not claim anything the business does not actually do. This respects the standing rule in `LEGAL_REVIEW.md` not to publish blanket DBS or training claims without evidence.
- Equal opportunities and reasonable adjustments: a statement and a named way to ask for adjustments or a different way to apply.
- Applicant FAQ using the existing accordion: eligibility, qualifications, pay and hours (if known), the form, file types and sizes, what happens after applying, timelines, DBS, how long data is kept, withdrawing an application.
- Closing call to action: apply, or register interest. This needs a careers variant of the current CTA section, because the existing one is fixed to the booking buttons.

## Role detail pages

Each role page uses the same hero and section styles and contains the full description, requirements, process and key facts, an Apply button (repeated as a sticky bar on small screens), related roles and a link to the applicant FAQ. A closed role shows a clear "no longer accepting applications" message with the register-interest route. Open roles carry JobPosting structured data (see SEO below).

## The application form

Shape: a guided form with clear sections and a final review step, built in the same visual language and with the same patterns as the enquiry form (controlled fields, plain-language errors, an error summary that receives focus, a success message that receives focus). The founders can choose between a step-by-step version and a single long page. The step version is recommended for phones. Progress is kept in memory only.

Sections and fields (data minimisation applies throughout; collect only what is needed to decide whether to progress someone):

- About you: first name, last name, email, phone, town or city and country. No date of birth, photo, nationality, marital status or health questions.
- Eligibility: confirmation that the applicant is 18 or over (founders to confirm the minimum age), and a right-to-work or eligibility-to-provide-services question worded to suit how tutors are engaged (see questions).
- The role: which role, which subjects, which year groups and levels, which exam boards and 11+ formats they are comfortable with.
- Experience and qualifications: highest relevant qualification and subject, qualifications relevant to the subjects they want to teach, years of tutoring or teaching experience, ages taught, experience supporting learners with additional needs (their professional experience, not their own health), experience teaching online, and an optional list of other relevant training.
- Availability: days and times, hours per week, earliest start date, and any term-time or exam-season limits.
- Online set-up: confirmation of a suitable device, camera, headset and reliable connection, and a quiet private space for lessons.
- Short answers: two or three prompts of a few hundred characters each, such as why they want to tutor, and how they would help a learner who still does not understand a topic after two explanations. The founders approve the prompts.
- Documents: CV (required), cover letter (upload a file, or paste text, or both; the founders decide whether it is required), and optional supporting documents such as degree or qualification evidence.
- Declarations: the information is accurate; any offer is subject to the checks described; they have read the applicant privacy notice (an acknowledgement, not the lawful basis); optionally, a separate unticked box to keep their details for future roles for a stated period.
- Hidden anti-spam field and a minimum time-to-submit check, invisible to people.

Things deliberately not asked at the application stage: criminal convictions or cautions, DBS certificate contents, ID or passport copies, bank details, photos of the applicant, referee contact details, or any health or disability information. Those belong to later, secure steps handled by the safeguarding lead. The form can ask whether the applicant already holds an enhanced DBS and whether they are on the Update Service, as that is a status question, but the exact wording needs the owner's and legal review. A visible note on the documents step tells people not to send ID, DBS certificates, bank details or anything sensitive.

Upload field specification:

- Accessible file fields: each upload is a real labelled file input, with an optional drag-and-drop area layered on top. It must work with keyboard and screen readers, show file name and size after choosing, let the person remove and replace a file, announce changes in an `aria-live` region, and show a running total against the size cap.
- Defaults (all adjustable in one config): CV up to 1.5 MB, cover letter up to 1 MB, up to two supporting documents up to 1 MB each, all together under about 4 MB. Accepted types: PDF and DOCX for CV and cover letter; PDF, DOCX, JPG and PNG for supporting documents. Older `.doc`, macro-enabled Office files, archives and executables are refused, with a friendly message suggesting "save as PDF".
- Large phone photos are resized in the browser before upload so scans stay small. Test iPhone photo formats (HEIC) and the iOS file picker.
- Clear messages for every failure: wrong type, too big, empty file, too many files, over the total, and a server rejection.

## Server route behaviour (`/api/careers/apply`)

- Accepts a multipart form post. Reads the declared size first and rejects anything over the limit before processing it.
- Re-checks everything the browser checked, because browser checks can be bypassed: required fields, lengths, email format, allowed values for every choice, file count, file sizes and total size.
- Checks what each file actually is, not what it is called: a PDF must start with the PDF signature, a DOCX must be a zip containing the expected Word parts, and JPEG or PNG must have the right signatures. Do this without unpacking whole archives (to avoid decompression attacks). Refuse PDFs that look encrypted or contain embedded scripts or launch actions, using a simple byte scan, and refuse macro-enabled or unexpected content. Clean file names (strip paths and odd characters, limit length, handle double extensions). The route cannot scan for viruses itself; attachments are untrusted, and the email says so. Gmail's own scanning is a second layer. Anything stronger (a malware scanning service) is a later decision because it sends files to another company.
- Protections: origin check (same pattern as the enquiry route), a stricter rate limit than the enquiry form, the honeypot and time checks, and a platform-level rate rule on the host, because in-memory counters do not hold across serverless instances. A CAPTCHA or Cloudflare Turnstile is optional and is the owner's decision because of its privacy and cookie implications.
- Creates a reference number from a secure random value, for example `LT-APP-` followed by the date and six characters, so correspondence can refer to it without any database.
- Sends the internal email first. Subject lines are built from sanitised values only (no line breaks), the body lists the structured answers in a clean table with all free text escaped, and the files are attached. The reply-to address is the applicant's. If this send fails, the route returns an error and does not send a confirmation, so nobody is told their application arrived when it did not.
- Then sends the applicant confirmation (no attachments, no copy of their answers): the reference, the role, what happens next, only with timings the business has confirmed, how to withdraw or ask for their data, and a link to the applicant privacy notice. If this second email fails after the first succeeded, the application still counts as received.
- Logging records the reference, outcome and sizes only, never names, contact details or file content.
- The Resend client must be created inside the request handler, never when the file loads (the existing enquiry route has this defect, see `DEPLOYMENT_PLAN.md`). Missing configuration in production produces a clear, friendly failure, and the build must not need the key.
- New settings: a careers inbox address (falling back to the enquiry address), the from address, allowed origins and the site URL. All are added to the example environment file with comments.

## Applicant privacy, legal and safeguarding

All of this needs the founders' confirmation and, where marked, professional review. It is planning, not legal advice.

- Applicant privacy notice (new page): who the controller is (the confirmed company details), what is collected and why (assessing suitability and meeting safer recruitment duties), the lawful basis (to be confirmed with advice), who receives it (the email provider, the hosting provider and Google Workspace, with transfer wording to be settled), how long it is kept (the existing schedule of up to six months after the decision for unsuccessful applications; a separate, consent-based period if a talent pool is offered; longer records only for people who are engaged), applicants' rights, how to withdraw, how to complain to the ICO, and that no automated decision-making is used.
- Update the main privacy page to mention applicant data and link to the new notice. Update `LEGAL_REVIEW.md` with the new data flow, and apply its future-change gate: record what data the new feature receives, where it goes, the lawful basis, children's-data impact (none expected, applicants are adults, but the checks relate to working with children), retention and security. Re-audit the live site after deployment.
- Equality: avoid discriminatory questions and wording; offer reasonable adjustments and an alternative way to apply. Whether discrimination law protects someone depends on how they will be engaged, so this is a question for advice and should not change the safe practice above.
- Right to work and DBS: what the page may say depends on whether tutors are employees or self-employed. Since January 2026 eligible self-employed tutors have been able to apply for their own enhanced DBS check through an umbrella body, so the page and process must reflect how LearnThrive actually does it and who pays. The site must not ask for a level of DBS information the business is not entitled to.
- Safer recruitment: the hiring steps shown to the public must be steps the business really carries out, with a named person responsible for them. The existing legal FAQ names identity, qualifications where relied upon, references, right to work where applicable, DBS eligibility, safeguarding induction, a tutor code of conduct and annual refresher training. The code of conduct and induction must exist before the page mentions them.
- The existing "lessons are not recorded by default" position stays consistent across the careers copy.

## Design and accessibility

- Same design language: the current colour tokens, spacing, type, radii, shadows and motion rules; PageHero, SectionHeading, FeatureCard, FaqList and ButtonLink; page-level CSS modules like the book and contact pages; ScrollReveal only where the rest of the site uses it; subject accent colours for roles. New pieces (role card, process timeline, file field, form section, upload meter, careers CTA) are built from the same tokens and documented alongside the existing components.
- No new photography is invented. If the founders want imagery, they supply real photos with permission.
- Accessibility to the standard the site already meets: a labelled input for every field, grouped questions in fieldsets, visible focus, errors tied to fields with an error summary that takes focus, text and non-text contrast, 44 px touch targets, no reliance on colour or drag-and-drop, reduced-motion respected, zoom to 200 per cent, no horizontal scroll at 360 px, and sensible autocomplete values for personal details. The browser checks already run axe, so the careers routes are added to them.
- Plain English throughout, short sentences, and an obvious way to ask for help or another format.

## SEO and structured data

- Careers hub and role pages get titles, descriptions, canonical URLs and social previews in the existing metadata pattern, and are added to the sitemap (open roles only).
- JobPosting structured data on open role pages only, with accurate title, description, date posted, closing date, hiring organisation, remote working details and employment type; pay only if published. Check Google's current job posting documentation before shipping, keep the data in step with the visible page, and remove it when a role closes. Treat this the way the site treated FAQ markup: only add it if it is verified to be valid and useful.
- The apply page is marked so search engines do not index the form itself. There is no analytics on the site, and none is added.

## Running recruitment without a database

Until the platform exists, the careers inbox is the applicant tracking system, so the plan includes the working practice:

- A shared careers address (an alias or Google Group), with named people who can access it.
- A simple label scheme per role and stage, and a spreadsheet or the mailbox search to track status.
- Template replies for acknowledgement, invitation to an introductory call, further information, unsuccessful, and offer.
- A recurring reminder to delete unsuccessful applications on schedule, including from the Resend sending log, with the deletion recorded.
- Who reviews applications, how fast, and who is the named safeguarding contact for the later checks.

## Testing and quality gates

- Unit tests for the validation and file-checking code, using small real fixtures: valid PDF, valid DOCX, JPEG and PNG; wrong extension, spoofed type, empty file, oversize file, double extension, strange or very long names, path traversal names, encrypted or script-bearing PDF, macro-enabled file.
- Route tests with email mocked: success path sends both emails with the right attachments, internal failure sends no confirmation, confirmation failure still succeeds, bad origin, rate limit, honeypot, too-fast submission, missing configuration, and oversize body. Confirm the build works with the email key unset.
- Browser checks added to the existing script: complete the whole form with keyboard only, add and remove files, see every error message, success state focus, a phone viewport, no horizontal overflow, axe clean, no cookies, no browser storage, no third-party requests, and the JavaScript-off fallback showing the email option.
- Manual checks on real devices: iPhone and Android file pickers, cloud-drive files, and a real application sent through to a real inbox, including how both emails render in Gmail, Apple Mail and Outlook.
- Everything stays green at each commit: lint, typecheck, tests and build. No test is weakened to get a pass.

## Sequencing and dependencies

- The deployment blockers in `DEPLOYMENT_PLAN.md` come first or alongside: lazy Resend client, passing lint and tests, corrected privacy wording, committed work, confirmed company details. The careers work should be done on its own branch from a clean, committed `main`, because the working tree currently has many uncommitted changes.
- Order of work: decisions and content first; then the roles data, validators and file checks; then the hub and role pages; the applicant privacy notice; the form and uploads; the server route and both email templates; the privacy, footer, sitemap and legal updates; hardening; full testing; a staging run with a real send; launch.
- The feature ships behind a simple switch so the hub can go live with "register your interest by email" while the form is being finished, and applications can be turned off again without a deployment of new code if something goes wrong.

## When the platform arrives

The application payload, role data and reference format are designed to become records in `D:\LearnThriveSoftware`: an Applications area for admins, role management, status tracking, document storage with automatic deletion, and a hand-off into tutor onboarding (identity, references, DBS, safeguarding training, policy acknowledgement). At that point the email delivery function is replaced by one that stores the application, the careers inbox becomes a notification, and equal-opportunities monitoring can be added properly, which cannot be done safely without a database.

## Questions for the owner

Answers marked as blocking decide how the build works. Everything else has a recommended default, shown in brackets, so work can start.

Roles and engagement
- Which roles go live first? (Maths, English, Science and 11+ tutors, plus a general register-your-interest.) Any non-teaching roles? [blocking]
- Are tutors self-employed contractors or employees? This changes the wording of the page, right-to-work questions, pay display and the structured data. [blocking]
- Will you publish pay, a rate range, hours or guaranteed minimum hours? Anything on training, resources or progression that is genuinely offered? (Only what is true and agreed.)
- Must tutors be based in the UK, and is a UK right to work or eligibility required? (UK-based, online.)
- Minimum age and minimum qualifications, and what is preferred (degree, A levels, teaching qualification, exam-board experience)? (18 or over.)

Process and people
- What are the real hiring steps and who does each one? Do you use a sample lesson, and is it paid? How many references, and when are they requested? [blocking for the process section]
- What response time can you promise? (The enquiry auto-reply says five working days; reuse only if applications will really be handled that fast.)
- Who is the named safeguarding lead, who reviews applications, and which inbox receives them? Can we create a careers address? (careers@learnthrivetuition.co.uk as an alias or group.) [blocking]
- Do the Tutor Code of Conduct, safeguarding induction and annual refresher training exist in practice? Are you happy to describe them publicly?
- Who pays for or reimburses an enhanced DBS check, and do you want applicants who already hold one to say so on the form?

The form
- Cover letter: upload only, paste only, or both? Required or optional? (Both allowed, optional.)
- Which short-answer prompts do you want? (Why tutoring; how you help a learner who is still stuck; optional extra.)
- Step-by-step form with a review step, or one long page? (Step-by-step.)
- Spam protection: honeypot and timing only, or add a CAPTCHA such as Cloudflare Turnstile? (Honeypot and timing, plus host rate limits.)
- Talent pool: keep unsuccessful applicants for future roles if they opt in, and for how long? (Opt-in only, twelve months; otherwise the existing six months.)
- Equal-opportunities monitoring: leave out for now because it needs a database? (Leave out until the platform.)

Hosting and technical
- Where will the site be hosted? Vercel's 4.5 MB request limit sets the upload cap; another host may allow more. If you would rather allow big files now, are you willing to add file storage (a new supplier holding applicants' documents)? (Stay with email attachments and a four-megabyte total.)
- Is it acceptable that applications and documents will pass through Resend and sit in the careers mailbox, with deletion handled manually on schedule? Resend's retention of message content needs checking before launch. [blocking for legal sign-off]

Content and brand
- Careers in the header navigation, or footer only? (Footer, plus a home-page band while roles are open.)
- Do you have real tutor or team photos with permission, and any genuine tutor testimonials with written consent?
- Tone of the page: the same warm, clear voice as the rest of the site? Any wording you must include or avoid?
- Who approves the final copy and the applicant privacy notice, and is professional legal review planned before launch?

## Ground rules for whoever does the work

- No invented claims: no pay, benefits, accreditations, team numbers, awards, tutor quotes or results.
- No analytics, advertising pixels, embeds, cookies or browser storage, and no new third-party service, without updating the privacy and cookie pages first.
- No new dependency unless it is clearly justified. Validation, file checks and the form use plain code and the existing patterns.
- Keep changes small, reviewable and covered by tests. Do not touch `D:\LearnThriveSoftware`.
- Read `AGENTS.md` and the installed Next.js docs before changing routing, metadata, request handling or headers, because this version differs from older ones.

## Done means

- A visitor can browse the careers hub and role pages, read the process, apply with a CV, cover letter and supporting documents on a phone or a computer with or without a mouse, and see a clear confirmation with a reference.
- The careers inbox receives a clean email with every file attached; the applicant receives a confirmation; a failure never shows false success.
- File limits, types and content checks work on the server, not only in the browser.
- The applicant privacy notice, privacy page, footer and `LEGAL_REVIEW.md` accurately describe the feature, and the founders have signed off the copy and the legal wording.
- Every claim on the pages is true and confirmed by the owner.
- Lint, typecheck, tests, build and the browser and accessibility checks pass, a real end-to-end application has been received in a real inbox, and the live site has been audited after deployment for headers, cookies, storage and third-party requests.
- The deletion routine for unsuccessful applications is written down and has an owner.
