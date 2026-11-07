# Lawful bases and retention

Drafted 2 November 2026 from what LearnThrive does according to the code and docs, and **confirmed by Alvi Hossain on 2 November 2026** (with the decision that records are purged when people leave, below). It is not legal advice; Tahasin Hasan and Abdurrahman Mustafa, who control and handle the data, keep it under review, ideally with a solicitor. The privacy and careers notices must say the same thing before anything is published.

**Update 7 Nov 2026: this draft is out of date on two points** ([OWNER_ANSWERS_2026-11-07.md](OWNER_ANSWERS_2026-11-07.md), F1 and F5). It was written when lessons were not recorded; they are now to be recorded for safeguarding, so it must add the recording (including any sensitive data it captures, the lawful basis and the special-category condition) and the separate learner accounts before Tahasin and Abdurrahman approve it. Until the impact assessment is done nothing is recorded, and the privacy and careers notices must keep saying what is true.

Scope: the tuition side only. LearnThrive AI and the Library have their own bases and are not covered.

## Who we are to the data

- **Controller:** LearnThrive Tuition Ltd (company number 16680738, England and Wales), through Tahasin Hasan and Abdurrahman Mustafa, who handle privacy requests, complaints and breaches.
- **Processors (they act on our instructions):** Render (hosting), Supabase (database, sign-in and file storage, London region), Resend (sending email), Stripe (payments), Cloudflare (relays classroom video and audio when needed), Google Workspace (the company mailboxes). Each needs a data processing agreement on file and a line in the privacy notice. IONOS is the domain registrar and DNS only and does not see personal data.
- **Everyone we teach is under 18.** The ICO's Children's code (Age Appropriate Design Code) is relevant to an online service used by children. The contracting party is the parent or guardian (the client), who also controls the child's account.

## The table

Article 6 bases: (a) consent, (b) contract or steps before a contract, (c) legal obligation, (d) vital interests, (f) legitimate interests.

| What we do | Data | Basis | Special rules | Kept |
| --- | --- | --- | --- | --- |
| **Enquiry form and free consultation** | Parent's name, email, phone, child's year group, subject, free-text message | **(b)** steps at the person's request before a contract | If a message contains health or SEND detail, see "Special category data" | Up to 12 months after last contact if it did not become tuition |
| **Tuition contract and delivery** | Parent and child names, year group, subjects, schedule, tutor assignment, fees | **(b)** the contract with the parent | Child's data is processed to deliver the lessons the parent bought | While the student is enrolled |
| **Accounts and sign-in** (parent, learner, tutor, admin) | Name, username (sign-in is by username, 2 Nov 2026), role, sign-in security records, session cookie; each account is linked to a real email (a child's to the parent's) for resets, notices and invoices | **(b)** and **(f)** keeping accounts secure | Accounts are created by LearnThrive; no marketing use | While enrolled or working with us |
| **Live lessons in the classroom** | Live video and audio, whiteboard and chat during the lesson | **(b)** | **Not recorded.** Chat and boards are not stored. Video is relayed through Cloudflare only to connect the call | Not kept |
| **Attendance, lesson reports, progress, tutor notes** | Who attended, report text, progress, internal notes | **(b)**; internal tutor notes **(f)** for quality and safeguarding | Parents see approved reports, never internal notes | While enrolled |
| **Payments** | Amounts, invoice and payment status, Stripe references. Card details go to Stripe only and never touch our site | **(b)**; keeping tax records **(c)** | Financial records have a legal minimum retention | Financial records: 6 years (confirm with the accountant) |
| **Safeguarding concerns and records** | What was reported, who, what was done | **(f)** protecting children; **(d)** in an emergency | Can include health or other sensitive detail: use the substantial-public-interest condition for safeguarding of children (UK GDPR Art. 9(2)(g), Data Protection Act 2018 Schedule 1) and keep an **appropriate policy document** | As the safeguarding lead and legal advice require; stored separately with restricted access |
| **Tutor applications** (CV, cover letter, answers, identity documents) | Contact details, history, identity documents | **(b)** steps before a contract; **(f)**; **(c)** for right-to-work checks if the tutor is an employee (confirm employee or self-employed) | Prefer recording "identity seen" over keeping scans | Unsuccessful: up to 6 months after the decision (12 if they agreed to be kept; identity documents still 6); tutors: while they work with us |
| **DBS** | That a check was seen, its date and outcome | **(f)** (and **(c)** if a legal duty applies); criminal-offence data also needs a condition in DPA 2018 Schedule 1 (safeguarding of children, or preventing unlawful acts) and an appropriate policy document | **Tutors pay for their own DBS.** Record only that the certificate or Update Service result was seen, by whom and when; never keep the certificate | While the tutor works with us, then short (owners confirm) |
| **Safeguarding agreement and reconfirmations** | Signed agreement, yearly reconfirmation | **(b)** and **(f)** evidence | Keep as evidence | While the tutor works with us, plus the period the owners set |
| **Subject requests** ("can't see your subject") | Subject, level, optional email | **(f)**; **(a)** for the optional "tell me when it is available" email | Anonymous requests are fine | Until the subject is added, or 12 months |
| **Website security** | IP address (held briefly in memory for rate limits), outcome logs with no personal data | **(f)** | No analytics, no advertising cookies | Not stored beyond the request, logs carry no personal data |
| **Complaints** | Complainant, child, details | **(f)**; **(c)** where a duty applies | Handled by Tahasin and Abdurrahman | Owners set (suggest 6 years after resolution) |

## Special category data (health, SEND)

The site does not ask for health or special educational needs information, but the enquiry message and tutors' reports could contain it. **Decide:** (a) tell families not to put health or SEND detail in the form and collect it only on request later, with **explicit consent** (Art. 9(2)(a)); or (b) collect it on purpose with explicit consent and an appropriate policy. Option (a) is simpler.

## Retention

**The rule (decided 2 Nov 2026): when a student or a tutor leaves, their records are purged.** Until then, a student's data is kept while they are enrolled and a tutor's while they work with LearnThrive.

The purge has the short, defined exceptions in the table above, which are also confirmed: **financial records** (usually 6 years for tax; the accountant confirms the period), **safeguarding records** (kept separately with restricted access, for as long as the safeguarding policy and legal advice require), **unsuccessful applications** (up to 6 months after the decision, or 12 if the applicant agreed to be kept; identity documents 6 months), and **enquiries that never became tuition** (12 months). These exist because the law or child protection requires them, not as a way of keeping people's data: everything else is removed.

The purge is built as a tool (launch checklist 3.7, **built and proven on a real Supabase stack on 4 November 2026**; migrations `0018` and `0019`, and `docs/RETENTION_AND_DELETION.md`): the record is first **marked as left**, which deletes nothing and can be undone; **30 days** later it can be purged, and an administrator may bring that date forward but never push it back. The screen then shows what will go and what stays and why, and the purge runs on a typed confirmation, in one transaction, leaving a log with the date, the administrator, the kind and row counts and **no personal data at all** — so the log cannot say who was purged. Backups keep a purged record until they age out, which the privacy notice says, along with the fact that deletions are re-applied after a restore.

**Still for the owners:** whether 30 days is the pause they want, and the financial-records period the accountant sets (the privacy notice currently says "the period required for tax" rather than naming six years).

## Children's rights and parents

- A child has their own data rights; a parent can exercise them for a young child. Decide how a request from a child or a parent is verified.
- Parents see each of their children's lessons and approved reports separately (`dashboard/children`, `dashboard/progress/<child>`). They cannot see another family's data, and internal tutor notes are never shown.

## What must be true before this is published

1. Tahasin and Abdurrahman review and approve this table, and the privacy notice says the same.
2. A data processing agreement is on file with each processor.
3. An appropriate policy document exists for safeguarding and DBS data.
4. A breach procedure exists (the ICO must be told within 72 hours of becoming aware of a reportable breach).
5. `RETENTION_AND_DELETION.md` is updated to match the purge rule above (it still describes email-only handling and the older periods).
6. **DPIA:** you decided one is not needed. It is worth running the ICO's screening checklist first, because the service handles children's data and live online lessons; if the checklist says "likely high risk", a DPIA is required.
