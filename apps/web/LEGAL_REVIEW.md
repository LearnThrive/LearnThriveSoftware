# LearnThrive Tuition legal and safeguarding review

**Last checked:** 20 October 2026  
**Status:** Internal decision record. This is not legal advice or professional certification of compliance.

## Verified position

The verified public business details include the trading name **LearnThrive Tuition**, `https://www.learnthrivetuition.co.uk`, `info@learnthrivetuition.co.uk`, Tahasin Hasan's telephone number `+44 7459 839595`, Abdurrahman Mustafa's telephone number `+44 7883 745337`, and the social links in `src/lib/site.ts`. No registered legal entity, registered number or office, or controller's legal identity, or DPO has been verified. The owners have confirmed that **Tahasin Hasan is the safeguarding lead and Abdurrahman Mustafa the deputy**; that decision is now published.

The site is a marketing, enquiry and recruitment site. Form values exist only in React memory until a visitor submits. A submission is emailed through Resend to the company mailbox hosted with IONOS, and the site is hosted on Render. There is no database, file storage, CRM, payment service or portal. The public Library and pricing pages (coming soon) add one more email-only flow, the Library waitlist, described below. The repository contains no analytics, advertising pixels, cookies, external embeds or external font service; its only browser storage is the three small user-initiated items listed below. Instagram, LinkedIn, and tutor-login services are contacted only if a visitor follows their external links.

## Decisions required now

1. **Legal identity and controller.** Confirm whether the operator is a sole trader, partnership, limited company, or other entity; its full legal name; a service/contact address; and which person or entity is the UK GDPR controller. If it is a limited company, provide the registered number, registered office, jurisdiction of registration, and full “Limited” or “Ltd” name for the website disclosures. Decide who owns privacy requests, complaints, and personal-data-breach assessment. A DPO should be named only if one is actually appointed or legally required.

2. **Real data map and suppliers.** Identify where sent enquiry emails and later tuition records actually go, who can access them, and every provider used for hosting, email, document storage, communications/video lessons, scheduling, accounting, and any tutor or customer management. Confirm processor terms, security responsibilities, storage locations, and any international transfers and safeguards. The public privacy notice currently describes provider *categories* because none of these facts is verified.

3. **Lawful bases and children's information.** Confirm and document the lawful basis for each real activity, including enquiries, contract administration, progress records and safeguarding records; review marketing separately if introduced. Complete a legitimate-interests assessment where legitimate interests is relied upon, giving children's interests particular weight. Decide whether special-category information (for example health or SEND information) will be collected, why it is necessary, the Article 9 condition, and the safer collection route. Assess Children's Code scope and whether a data protection impact assessment is needed for the current site as well as future services. A parent-directed enquiry does not itself exclude the site from the Code.

4. **Retention and rights handling.** Approve a retention schedule for unsuccessful enquiries, customer correspondence, contracts and financial records, learner/progress records, safeguarding records, and tutor/personnel records. Assign a person and process for access, correction, erasure, restriction, objection, identity/authority checks, complaints, and breach recognition, escalation, documentation, and notification. Replace the public notice's general “only as long as necessary” wording with periods or clear criteria once these decisions exist.

5. **ICO fee.** Complete and retain the result of the ICO data-protection-fee self-assessment for the actual controller and processing activities; pay/register if required, or record the exemption relied upon.

6. **Tuition contract terms.** Before publishing comprehensive service terms or accepting bookings, approve prices and invoicing/payment timing; how and when a contract is formed; cancellation and cooling-off rights; refunds; missed or late lessons; tutor cancellation/replacement; rescheduling; lesson length/location; minimum commitments or subscriptions; ending tuition; complaints; liability wording; and the governing law/jurisdiction appropriate to the operator and customers. Terms must be prominent, fair, and transparent. The current facts do **not** justify a separate cancellations page: create one only if the agreed rules are substantial enough to need it, otherwise include them clearly in the service terms and booking journey.

7. **Safeguarding ownership and procedure.** The safeguarding lead (Tahasin Hasan) and deputy (Abdurrahman Mustafa) are now named and published. Still to do: confirm the monitored concern channel, and approve procedures for receiving, recording, sharing, escalating, and securely retaining concerns. The procedure must cover immediate danger, referrals to children's social care/police, allegations about a tutor or staff member, confidentiality limits, and relevant local-authority/LADO contact routes. Confirm the jurisdiction(s) in which services operate, since referral arrangements differ across the UK.

8. **Online-session safety and workforce controls.** Decide and document parent/guardian expectations, communication channels and boundaries, one-to-one online-session rules, conduct standards, use of personal accounts/devices, and what happens if a child discloses a concern. Confirm the actual role-by-role vetting and safer-recruitment checks (including eligibility and level of DBS check), reference/identity checks, supervision, and responsibility for self-employed or agency tutors. The published rule is now: every tutor agrees to an Enhanced DBS check including the Children's Barred List, passes identity and right-to-work checks, and does not teach or have any contact with a student until every check is complete. Induction and refresher training were removed from public copy at the owners' direction (see below). Do not publish further DBS or training claims until evidence and ownership exist.

9. **Recording.** Decide whether lessons, calls, chat, or screenshots are prohibited or permitted. If any recording is planned, define purpose, necessity, lawful basis, access, security, retention/deletion, notices and permissions, child-welfare controls, and supplier processing before enabling it.

10. **Testimonials.** Confirm that every published testimonial is genuine and that LearnThrive has permission to publish its wording and attribution. Record the permission, any edits, whether the name is real or anonymised, and withdrawal handling—especially where a child could be identifiable.

## Privacy and cookie page audit

The current Privacy and Cookie notices are substantive and broadly match the repository implementation. In particular, they accurately distinguish temporary in-page form state from a user-sent email and do not invent analytics, advertising, storage, or a database.

Outstanding factual qualifications:

- The identity of the controller and its contact/service address are missing because the business identity is unverified. “LearnThrive Tuition” alone may be insufficient once the operator is confirmed.
- Provider categories, retention principles, lawful bases, transfer wording, and safeguarding disclosure language cannot be final until the data map and responsibilities above are approved.
- The source and local production-browser checks found no cookies, local/session storage or third-party requests. This does not verify the live hosting/CDN configuration. Audit response headers, deployed scripts, consent-exempt storage, and third-party requests on the live domain before publication and after each hosting or feature change.
- Re-check both notices before adding analytics, pixels, embeds, chat, booking, payment, CRM, portals, video platforms, or recording. Non-essential storage/access must not run before any required consent or other control is implemented.
- The Privacy and Cookie pages now display **20 October 2026** as their last-reviewed date (the Library waitlist change, below), and the Safeguarding page displays **9 October 2026** (the careers, safeguarding-agreement and subject-request changes). These are editorial review dates, not evidence of company or professional legal approval.

## Browser storage added by plan 15 (for legal review)

The Cookie notice used to say, accurately, that the site used no browser storage. Plan 15 added three small, user-initiated uses (a theme choice, a motion choice and the search recents), so the notice's "What this website currently uses" and "Why there is no cookie banner" sections were changed to describe them factually. **The wording needs the owner's and a legal reviewer's approval; the reviewed-on date on the page was deliberately not changed at that time (it moved to 20 October 2026 with the Library waitlist change, below).**

| What | Where | When it is written | Contains | Leaves the browser? |
| --- | --- | --- | --- | --- |
| `lt-theme` | `localStorage` | Only when a visitor picks Light or Dark. Choosing System removes it. | `light` or `dark` | No |
| `lt-motion` | `localStorage` | Only when a visitor chooses Reduce motion. Choosing System removes it. | `reduce` | No |
| `lt-palette-public:recent` | `sessionStorage` | When a visitor opens a page from the site search (Ctrl/Cmd+K). | Up to 5 page identifiers (for example `page:/safeguarding`) | No; cleared when the tab closes |

Notes for the reviewer:

- Neither is a cookie, neither identifies a person, neither is read by the server, and the site works without them (private windows and blocked storage are handled).
- Whether a persistent, user-chosen appearance preference needs consent or is covered by the exemption for something the user has asked for is a legal question this repository cannot answer. If the answer is "needs consent", the lowest-impact option is to keep the preference for the session only (change `lib/theme.ts` to use `sessionStorage`).
- The signed-in app (not live in production) keeps its own sidebar state in `localStorage` (`learnthrive:sidebar-collapsed`), and the app palette planned for Wave 11 will keep a recent-items list; re-check this notice before the portal opens.
- The smooth-scroll code reads a `lt-smooth` key if one exists; nothing on the site ever writes it (it is a developer switch).

## Careers, safeguarding agreement and subject requests

Added on `feature/careers`, 9 October 2026, to the owners' brief (`CAREERS_PROMPT.md`). Everything is email-only: no database, no file storage, no cookies or browser storage, no third-party requests and no new dependencies. This section is the record the future-change gate below asks for.

| Flow | What it collects | Where it goes | Kept for |
| --- | --- | --- | --- |
| Tutor application, `POST /api/careers/apply` | Contact details; role; experience, qualifications and results; age and right-to-work status; optional DBS **status** only (never a certificate); availability; CV, cover letter and supporting documents (which may include identity documents); the safeguarding agreement record | One email with attachments to `CAREERS_EMAIL`, sent through Resend to the IONOS mailbox. The applicant's confirmation email is sent only if that one succeeds | Unsuccessful: 6 months, or 12 if the talent-pool box is ticked; identity documents are always deleted at 6 months. A tutor's identity and right-to-work documents: while they work with LearnThrive plus 12 months |
| Agreement record (part of an application, and of every reconfirmation) | Agreement version, typed full name, parts and clauses confirmed, understanding-check result, server time (UTC), SHA-256 of the canonical agreement text. **The visitor's IP address is never recorded** | The same email | A tutor's: while they work with LearnThrive plus 6 years, longer, kept separately with restricted access, if linked to a safeguarding concern. Unsuccessful applicant's: with the application |
| Yearly reconfirmation, `POST /api/safeguarding/reconfirm` | Name, email, whether anything has changed, the agreement record | Email to `CAREERS_EMAIL` | As the agreement record |
| Subject request, `POST /api/subject-request` | Subject, level, who is asking, optional note; an email address only if the separate, unticked box is ticked. No child's name | Email to `SUBJECT_REQUEST_EMAIL` | Until the subject is added, or 12 months |
| Human check, `POST /api/careers/challenge` | Nothing personal. A signed, expiring, one-use SHA-256 proof of work, run in a Web Worker | Nowhere | Not stored |

Controls: the origin check rejects a present-but-wrong `Origin` or `Sec-Fetch-Site: cross-site`; request bodies are read with a size limit; uploads are inspected (file signature, PDF active features, DOCX macros/embeddings/zip bombs/encryption) and attachment names sanitised; there are in-memory rate limits per client and per route; logs carry no personal data; and every route fails closed with a 503 when the email credentials are missing. The form pages and routes refuse submissions until `agreementApprovedByOwner` is set (see below).

### For the owners and a legal reviewer

1. **Barred List entitlement.** Confirm that LearnThrive may request an Enhanced DBS check *including the Children's Barred List* for these self-employed, online, one-to-one roles. The site says every tutor must agree to one; it does not say what role-based entitlement rests on.
2. **Who pays for the DBS check.** The published rule is that LearnThrive arranges and pays unless the applicant holds a suitable certificate or chooses to pay. "Suitable" is defined on the site as an Enhanced certificate including the Children's Barred List, subscribed to the Update Service, which LearnThrive decides whether to accept. Confirm both the rule and the definition.
3. **Strength of the typed-name acceptance.** The agreement is accepted by ticking each part and typing the full name, with the record described above. That is an acknowledgement record, not a qualified electronic signature. Confirm it is enough evidence for the owners' purposes.
4. **Induction and refresher training removed.** At the owners' direction no public page mentions induction or refresher training any more, and the agreement promises none. Safeguarding guidance for tutors generally expects training, so confirm this with an adviser.
5. **Retention periods.** Agreement and reconfirmation records are kept while the tutor works plus 6 years; a tutor's identity and right-to-work documents while they work plus 12 months. Confirm these against the advice you rely on, particularly for right-to-work evidence for self-employed workers.
6. **Identity documents in a shared mailbox.** Applicants may attach identity documents, and they arrive by email in the company mailbox. Limit who can read that mailbox, delete on schedule (`docs/RETENTION_AND_DELETION.md`), and consider a secure document route before volumes grow. The form tells applicants not to upload a DBS certificate.
7. **Lawful bases and notices are drafts.** `/careers/privacy` and the main privacy notice give lawful bases for applications, agreement records and subject requests (legitimate interests; consent for the optional "email me if this becomes available" box). They have not been through a legitimate-interests assessment.
8. **Unapproved agreement clauses.** Only clauses the owners decided are marked `ownerApproved: true` in `src/lib/safeguarding-agreement-v1.ts`. The agreement therefore ships as a draft: `agreementApprovedByOwner` is `false`, the agreement page shows a draft notice, and the apply and reconfirm routes refuse submissions. Review the extra clauses, then change the flag and the version date.
9. **Google Workspace corrected to IONOS.** Earlier FAQ text named Google Workspace, Gmail, Drive, Docs, Sheets and Meet as LearnThrive's providers. It now names IONOS (company email), Resend (email delivery) and Render (hosting). The Google Meet reference became "the lesson platform LearnThrive provides"; confirm the platform and say so if you want it named.
10. **Hosting limits.** Render's request-size limit and client-IP header are not documented well enough to rely on; `docs/RENDER.md` has the probes to run on the deployed service before applications open.

## Library waitlist (plan19 phase B2)

Added on `feature/library`, 20 October 2026, to the owners' brief (`plan19.md`, Phase B2). **All of the copy below, on `/privacy`, on `/cookies` and in the waitlist confirmation email, is a DRAFT for the owners and a legal reviewer.** It has not been through a legitimate-interests or consent review, and the reviewed-on dates now shown on the Privacy and Cookie pages (20 October 2026) are editorial dates, not evidence of legal approval. The Library is not open: the public pages say only that it will hold company-made worksheets, exam-style papers, mark schemes and notes, that it is included for enrolled students, that a paid subscription for anyone else is planned, and that it is coming soon. Nothing else is claimed. As with the careers flows, everything is email-only: no database, no file storage, no cookies or browser storage, no third-party requests, no analytics and no new dependencies.

| Flow | What it collects | Where it goes | Kept for |
| --- | --- | --- | --- |
| Library waitlist, `POST /api/library-waitlist` (the form on `/library` and `/pricing`) | An email address, and a separate, unticked consent box ("Email me once when the Library launches"). No name, no child's details, nothing else | One email to `LIBRARY_WAITLIST_EMAIL` (then `ENQUIRY_EMAIL`, then the site address), sent through Resend to the IONOS company mailbox. The person's short confirmation is sent only after that email has gone, and carries a removal line | Until the launch email has been sent, or 12 months, whichever is sooner; deleted on request |
| Human check, `POST /api/careers/challenge` (shared with the careers forms) | Nothing personal. A signed, expiring, one-use SHA-256 proof of work, run in a Web Worker | Nowhere | Not stored |

Purpose: one email, sent once, when the Library launches. Lawful basis: consent, given by ticking the separate box and withdrawn at any time by replying to the confirmation or writing to the company address. Recipients: Resend (delivery) and the company mailbox on IONOS; Render hosts the site and sees only request information. The same controls as the subject request apply: origin check, in-memory rate limits per client and per route, a honeypot, a minimum fill time (production only), the human check, a size-limited body, no personal data in logs, and a 503 with "email us" when the email credentials or `CAPTCHA_SECRET` are missing. The form has a no-JavaScript email fallback.

Prices: `LIBRARY_PRICE_MONTHLY` and `LIBRARY_PRICE_ANNUAL` are display only (pounds, read when the site is built). A price appears only if the owner sets one. Nothing is sold, taken as a deposit or pre-ordered, and no structured data for products or offers is published.

### For the owners and a legal reviewer (Library waitlist)

1. **Consent wording and record.** The box reads "Email me once when the Library launches". The site keeps no record of the consent beyond the email that arrives in the mailbox (the address, the time it was sent, and the fact that the box was ticked). Confirm that is enough evidence of consent, or decide to keep a dated log.
2. **One launch email, by hand.** The launch email is a single message to people who ticked the box, sent by a person from the mailbox. Decide who sends it and how, so that addresses are not shown to one another (individual messages or blind copy) and so that it carries its own removal line. Any further marketing needs a fresh consent and a new review.
3. **Retention period.** Until the launch email has been sent, or 12 months, whichever is sooner, then deleted. Confirm the 12 months (it appears as `retentionMonths` in `src/lib/library-config.ts`, in the privacy notice and in `docs/RETENTION_AND_DELETION.md`; change all three together) and who deletes, using the monthly log in that document.
4. **Resend's log.** Resend keeps a copy of each email it sends, so a waitlist address also sits in its sending log. Check its retention setting and what can be deleted from its dashboard (not verified here), and delete there as well as in the mailbox.
5. **Removal requests.** The confirmation email tells people to reply or write to the company address and says the address will be deleted. Confirm that the mailbox is monitored and that a request is dealt with promptly, in the mailbox, deleted items and Resend. Sign-ups go to `LIBRARY_WAITLIST_EMAIL` if it is set, but the no-JavaScript and "email us" fallbacks open a message to the site address (`info@`), so check both mailboxes when deleting.
6. **Sign-ups by someone else.** Anyone can type any address into the form, and there is no double opt-in (the plan has none). The confirmation email is the safeguard: a person who did not sign up can ask for removal. Decide whether that is acceptable for a single launch email.
7. **Children.** The form asks for no name and no age. Confirm that the privacy notice wording is enough, and consider whether the Children's Code applies to a one-email waitlist.
8. **Copy about the Library.** The pages say only what the owners confirmed: company-made worksheets, exam-style papers, mark schemes and notes; included for enrolled students; a paid subscription planned for anyone else; coming soon. They carry no price unless one is configured, no counts, no claims about quality, results or exam boards, and no sample previews. Approve the page copy, the FAQ answers and the confirmation email.
9. **Pricing, VAT and terms are not done.** Before anyone can pay (plan19 Phase E) the owners and an accountant must settle the prices, the VAT treatment of a digital subscription, subscription terms, a content licence, cancellation and cooling-off wording and refunds, and this review must be extended for accounts and billing (Supabase, Stripe, session cookies). None of that is part of the waitlist.
10. **Static pages need a redeploy.** The phase and prices are read when the site is built, so a change to `LIBRARY_PHASE` or either price needs a new deploy. Only `info` is built so far: any other value behaves as `info`.

## Future-change gate

Before deploying a new provider or feature, record what data it receives, purpose, lawful basis, children's-data impact, processor/controller role, transfer mechanism, retention, security/access, and whether privacy information or storage/access choices must change. Repeat the production audit after deployment. This is particularly important for analytics, CRM, booking/payment, portals, lesson platforms, chat, and recording. Any new field, attachment type, provider or retention period in the careers, agreement or subject-request flows must also update `/careers/privacy`, the main privacy notice, `docs/RETENTION_AND_DELETION.md` and the table above. The same applies to the Library and its waitlist: any new field, a database or account, a payment or subscription (Stripe), a sign-in or session cookie, a different email provider, a launch-email tool, analytics, any stored sample or download, any use of an assistant or voice, or a change to the 12-month period must update `/privacy`, `/cookies`, `docs/RETENTION_AND_DELETION.md`, `docs/LIBRARY.md` and the Library waitlist section above before it is deployed, and the production audit must be repeated afterwards.

## Authoritative sources consulted

- ICO, [Individual rights guidance and the right to be informed](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/)
- ICO, [Children and the UK GDPR](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/), updated 15 May 2026
- ICO, [Guidance on storage and access technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/), finalised 29 April 2026
- ICO, [Data protection fee self-assessment](https://ico.org.uk/fee-checker)
- Department for Education, [Working Together to Safeguard Children 2026](https://www.gov.uk/government/publications/working-together-to-safeguard-children--2), updated 18 March 2026 (applies to England)
- NSPCC Learning, [Safeguarding and child protection for tutors](https://learning.nspcc.org.uk/safeguarding-child-protection/tutors), updated 2 April 2026
- GOV.UK, [Report child abuse](https://www.gov.uk/report-child-abuse)
- Competition and Markets Authority, [Unfair contract terms guidance](https://www.gov.uk/government/publications/unfair-contract-terms-cma37), updated 22 July 2026
- GOV.UK, [Limited-company website and promotional-material disclosures](https://www.gov.uk/running-a-limited-company/signs-stationery-and-promotional-material)
- ICO, [What privacy information should we provide?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/) — used to make the right to object explicit and separate in the public notice.

## FAQ search decision

No FAQPage structured data was added. [Google Search Central's documentation updates](https://developers.google.com/search/updates) record that FAQ rich results stopped appearing on 7 May 2026 and the documentation was removed on 15 June 2026. The visible FAQ remains indexable with standard metadata and a sitemap entry.
