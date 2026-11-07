# Owner answers: Tahasin's handover answers (7 November 2026)

**Source.** `LearnThrive_Tahasin_Handover_Answers.docx`, the editable response copy for Brian and Alvi. It follows sections B to I of [TAHASIN_HANDOVER.md](TAHASIN_HANDOVER.md) (2 Nov 2026) and records Tahasin Hasan's updates of 7 Nov 2026. Section A (the Stripe account) is not in it: see item 4 below.

**How to read this file.** Every item has a status:

- **DECIDED**: stated as a rule. Build to it.
- **WORKING**: the answer is a working interpretation or a draft ("under the draft rules"). Build it behind a setting that is easy to change, and do not publish it.
- **OPEN**: the document says "confirm". Do not build or publish anything that depends on it.

The document itself says: *confirm the open points before implementing the associated rules.* This file follows that. It is a record of what was said and what it changes in the repo. **It is not legal advice**; the family wording is a draft for the solicitor review planned for mid-December 2026.

**Personal data.** The document includes a phone number for safeguarding. It is **not copied here or anywhere in the repo** until the full 11-digit number is confirmed (D2).

---

## 1. What this changes about the 2 Nov decisions

| # | 2 Nov 2026 decision (in [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) Phase 0) | 7 Nov 2026 answer | Effect |
| --- | --- | --- | --- |
| 1 | **Lessons are not recorded.** | **Record all lessons for safeguarding** (D6), "subject to the recording privacy and implementation decisions in F". | Reverses it. **Nothing may be recorded and the public pages must not change until F5 is done** (impact assessment, notices, access, storage, retention, deletion, processor for the recordings). The public site today says the opposite: see section 4. |
| 2 | **DPIA: decided not needed.** | **Reopened** (F5): assess the children's portal and routine recording first, and complete a DPIA where required. | The earlier note in the checklist (a short DPIA is cheap insurance) is now a requirement before recording is enabled. |
| 3 | **Parents pay for lessons through Stripe** (task 3.10). | **Bill monthly in arrears for lessons delivered** (B1). **The family payment method is still to be confirmed** (B1, B13, B19). PayPal is excluded. | The charging model is now known, the collection method is not. Stripe is **not confirmed** as the way families pay. Task 3.10 (card checkout, prepaid Checkout, Stripe subscriptions) should be redesigned around statements and invoices, with collection added when the method is chosen. |
| 4 | **Stripe account:** Tahasin does not hold one; the company must open it (section A). | Not answered in this document. | A1 to A9 are still open. Treat the account as not opened until Tahasin says so. |
| 5 | No private tutor-to-child messaging was a suggested control. | **Decided** (D6): no private tutor-to-child messages. | Matches the safeguarding agreement and public page; keep it. |
| 6 | Terms: Tahasin will provide them. | Family terms **draft v0.2 (7 Nov 2026)**, for internal and solicitor review. | Drafted. Not publishable. See [FAMILY_TERMS_DRAFT_v0.2.md](FAMILY_TERMS_DRAFT_v0.2.md). |
| 7 | Safeguarding lead Tahasin; deputy not named. | **Abdurrahman Mustafa is deputy** (D1). | Update the safeguarding policy and page once the phone numbers and cover hours are confirmed. |

---

## 2. Answers, section by section

### B. Charging rules

| Item | Answer | Status | What it changes in the repo | Still to confirm |
| --- | --- | --- | --- | --- |
| B1 Billing | Monthly **in arrears** for lessons delivered, plus any chargeable missed lessons (B6, B7). Parents may pay for a lesson after it has taken place. Statement and email reminder at month-end showing payments received and the balance. | DECIDED | Task 3.10 data model: a lesson is chargeable when delivered; a monthly statement per family; no payment needed to book. | The family payment method. |
| B2 Rates | Tutor pay **£5 to £45 an hour**, negotiated by tutor level. The family price is set separately and is higher. | DECIDED (principle) | Two separate rates: what a tutor earns and what a family pays. Never one field. | The family rate schedule and who sets rates. |
| B3 Price protection | Keep the agreed parent rate fixed for the annual contract. | DECIDED | A rate has a start date and cannot change inside a contract year. | When a renewal price takes effect, and the notice families get. |
| B4 Sibling discount | **10% off monthly lesson charges for every enrolled sibling** in an eligible family, **including the first enrolled child**. | DECIDED (wording unclear) | A discount line on the statement. | Whether "including the first enrolled child" means a family needs two or more children for any of them to qualify; how eligibility is recorded. |
| B5 Taster | Free **30-minute** first taster session. | DECIDED | The enquiry and booking wording. | Whether the website's "free consultation" stays separate from the taster. |
| B6 Parent cancellations | 24 hours' notice or more is free. **Each child's first late cancellation is waived.** A repeat late cancellation can be charged. | DECIDED, fee open | A per-child counter and a charge rule. | The repeat fee, and when the allowance resets. |
| B7 No-shows | **First no-show per child is waived** (working interpretation); repeat no-shows are charged in full. | WORKING | Per-child counters, tracked **separately** from late cancellations. | Whether one shared allowance per child was meant instead. |
| B8 Tutor cancels | Reschedule with the parent or guardian. | DECIDED | A tutor cancellation never charges the family. | The rescheduling deadline, and the remedy if the family cannot take the replacement. |
| B9 Make-up lessons | Not available as a routine. A tutor-cancelled session is a reschedule (B8). Statutory remedies still apply. | DECIDED | No make-up credit object. | none |
| B10 Prepaid lessons | **Six months** to use them, measured from purchase (draft). Unused lessons expire with no discretionary refund. Statutory rights continue. | WORKING | Prepaid blocks would need a purchase date and an expiry date. | The solicitor must review the expiry wording, including when LearnThrive cannot deliver. **Contradiction to resolve:** B1 bills in arrears, so are prepaid lessons sold at all? |
| B11 Refunds | **Tahasin Hasan approves refunds.** | DECIDED | Refund action restricted to the approver; every refund logged. | Discretionary criteria, turnaround, payment route, and whether a second approval is needed over a threshold. |
| B12 Overdue | **No late fees.** Unpaid charges accrue. **Pause lessons once payment is more than one month overdue.** Send the month-end reminder. **Keep automated suspension off** until the trigger is confirmed. | DECIDED | Overdue is a flag for a person to act on. No automatic lesson block. | When the overdue clock starts, and who authorises a pause. |
| B13 Disputes | Owner, escalation route and response target to be agreed with the payment method. | OPEN | none yet | Everything. |
| B14 Mid-month start | The first month-end bill covers lessons delivered since the learner started, plus any missed-lesson charges, less payments received. | DECIDED | No pro-rating: charges follow lessons delivered. | none |
| B15 Who pays | Parents or guardians pay. A school-funded arrangement is a separate contract (Tahasin), invoiced by Abdurrahman Mustafa. | DECIDED | One payer per family account. | How two guardians split a bill or receive invoices. |
| B16 Invoices | Monthly bill and reminder go to the linked email at month-end. It shows: invoice number, date, billing period, delivered lessons, missed-lesson fees, payments received, outstanding balance, company details. | DECIDED | Statement layout for task 3.10.13. | Tax wording, whether a PDF is needed, how receipts are sent. |
| B17 Tutor access | **Tutors never see amounts charged to or paid by families.** | DECIDED | Hide invoices, refunds, balances and discounts in tutor screens, messages and exports. Add a test that a tutor session cannot read them. | none |
| B18 Tutor pay | LearnThrive pays tutors **by bank transfer**. | DECIDED | Tutor pay is outside the app (no Stripe Connect). | none |
| B19 Family payment methods | **PayPal is excluded.** | PayPal DECIDED; the rest OPEN | none yet | The accepted monthly method, and whether cash or manual bank transfers from families are allowed. |

### C. Family and tutor agreements

| Item | Answer | Status | Still to confirm |
| --- | --- | --- | --- |
| C1 Family terms | **Draft v0.2, 7 Nov 2026**, internal and solicitor review only. | WORKING | Open billing rules, annual contract and termination terms, legal wording. |
| C2 Enrolment agreement | The parent accepts the rate and monthly payment terms, authorises a separate learner account linked to their email, and gets the lesson-recording privacy information **before enrolment**. Record the terms version, the date and the payer. Acknowledging the recording information is separate from the choice of lawful basis. | DECIDED | none |
| C3 Tutor terms | not answered | OPEN | Employment status, a separate tutor contract, who owns it, and how the careers safeguarding agreement fits. |
| C4 Solicitor | **Pending**, planned mid-December 2026. | OPEN | Name, review and approval dates. |
| C5 Consumer rights | Include the **14-day distance-contract cancellation** information and an express request for paid tuition to start inside that period. Credit for another tutor is the proposed service recovery. Rights to repeat performance, a price reduction or a refund stay. | WORKING | The solicitor confirms the notice, the cancellation form, early-start charges and reimbursement wording. |
| C6 Complaints | `info@learnthrivetuition.co.uk` is the first contact. Tahasin and Abdurrahman handle complaints. Escalation: review by the director who did not handle the first response. | WORKING | Reply target; the two directors' mailbox addresses. (The complaints page already says 2 working days to acknowledge and 10 to respond: confirm.) |
| C7 Schools and councils | Tahasin handles school contracts, Abdurrahman invoicing. **No council arrangement exists**; a separate agreement if one is agreed. | DECIDED | none |

### D. Safeguarding

| Item | Answer | Status | Still to confirm |
| --- | --- | --- | --- |
| D1 Reporting | `info@` is the monitored inbox. **Tahasin is lead, Abdurrahman is deputy.** The policy proposes prompt triage. | DECIDED | Cover and monitoring hours. |
| D2 Phone | A replacement number was supplied. It has **10 digits, so it is incomplete** for a UK mobile. | OPEN | The full 11-digit number, the branch and deputy numbers, and approval to publish. **Do not publish or store it yet.** |
| D3 Process | Make the child safe, record what was said or seen, tell the lead or deputy immediately, refer externally where indicated, document decisions. 999 for immediate danger. LADO within one working day for allegations meeting the threshold. | DECIDED | none |
| D4 Policy | Separate policy **draft v0.2, 7 Nov 2026**. Tahasin is approver. | WORKING | Approval, effective date, first review date. |
| D5 Training | Tutors complete one-to-one safeguarding training with Tahasin and Abdurrahman before teaching. | DECIDED | Their own credentials, refresher frequency, who records completion. |
| D6 Online controls | **Record all lessons** (see section 1, row 1). **No private tutor-to-child messages.** | WORKING / DECIDED | The authorised classroom, chat rules, camera settings, recording-failure procedure. |
| D7 Observation | A parent or guardian may sit silently in the room. | DECIDED | Whether the lead or deputy may observe through the portal, and how families are told. |
| D8 Case records | Directors keep them, in a **separate restricted safeguarding store**. | DECIDED | The system, named access, access review, retention. |
| D9 Learner accounts | Each learner under 18 has their own username. Parent supervision at any age. Learners may join independently if the family is comfortable. | DECIDED | How the youngest learners reach the supervised view. |
| D10 Usernames | Generated usernames with no real names or school details are **proposed**. | OPEN | Explicit sign-off on the format and the age rule. |

### E. Careers and tutor onboarding

| Item | Answer | Status | Still to confirm |
| --- | --- | --- | --- |
| E1 Clause review | Get the latest `apps/web/src/lib/safeguarding-agreement-v1.ts`. Reconcile **lesson recording** and the private-messaging rule. Mark every clause approved, amended or removed. | OPEN | Clause-by-clause review. |
| E2 Launch approval | **Keep the tutor application form closed** until sign-off. | DECIDED | Final approval and date. |
| E3 DBS | Start at onboarding; verify the appropriate check **before teaching**. Tutors pay for their own. | WORKING | Enhanced check and Children's Barred List eligibility per role, the umbrella body or Update Service route, the minimum to record. |
| E4 Identity and right to work | not answered | OPEN | Status, process, acceptable evidence, checker, retention. Do **not** apply a generic six-month deletion to checks with a different legal retention requirement. |
| E5 to E9 | not answered | OPEN | References, interviews, applications mailbox and the five-working-day reply (`careers-config.ts`), annual reconfirmation, subjects and year groups at launch. |

### F. Privacy and data handling

| Item | Answer | Status | Still to confirm |
| --- | --- | --- | --- |
| F1 Lawful bases | Tahasin and Abdurrahman review [LAWFUL_BASES.md](LAWFUL_BASES.md) with Alvi. **Update it for learner accounts and lesson recording**, including any sensitive data and the lawful basis and conditions. | OPEN | Approval. |
| F2 Contact | `info@` for privacy requests, complaints and breach reports. Tahasin and Abdurrahman jointly. Sensitive reports go to a restricted case file. | DECIDED | none |
| F3 Data requests | **Proposed.** Log and date; check identity proportionately; confirm a parent's authority before releasing a child's data; consider the child's understanding and best interests; Tahasin or Abdurrahman owns it; normally one month for access requests. | WORKING | Approval. |
| F4 Breach plan | **Proposed.** Report to the directors promptly; contain and preserve evidence; log facts, time of awareness, risk, actions; tell the ICO where required within 72 hours where feasible; tell people at high risk; record every breach. | WORKING | Approval. |
| F5 Impact assessment | **Reopened.** Before recording is enabled, assess the portal and recording; set purpose, basis, settings, access, storage, retention, deletion, case holds; update notices; explain how recording issues are handled. | OPEN, blocks recording | The assessment itself. |
| F6 Health and SEND | Proposed: keep sensitive details out of the enquiry form; collect only what is needed later, through a restricted route. | WORKING | Legal basis and the special-category condition. |
| F7 Retention | Periods for finance, safeguarding cases, recordings, DBS logs, agreements, complaints, enquiries, unsuccessful applications and subject requests are **proposals**. | OPEN | Approval of each. |
| F8 Purge delay | Proposed 30 days, with holds and retention exceptions overriding automated deletion. | WORKING | Confirmation. |
| F9 Processors | not answered | OPEN | Agreements and an owner for Render, Supabase, Resend, Cloudflare, the email provider and **whatever will host recordings**. |
| F10 Appropriate policy document | not answered | OPEN | Whether one exists for safeguarding and DBS processing. |
| F11 ICO fee | The handover says it was paid. | WORKING | Registration number and renewal date before they go on the privacy notice. |
| F12 Legal review | not answered | OPEN | Scope and date for cookies, privacy, accounts, payments and portal text in `apps/web/LEGAL_REVIEW.md`, including recording. |

### G. Company and invoicing

| Item | Answer | Status | Still to confirm |
| --- | --- | --- | --- |
| G1 Accountant | **None appointed yet.** | DECIDED | Appoint one. |
| G2 VAT | **Not VAT registered**, per Tahasin. | DECIDED | The tuition VAT treatment and invoice wording with a qualified adviser. |
| G3 Company | **LearnThrive Tuition Ltd**, company number 16680738, registered in England and Wales; registered office 71-75 Shelton Street, Covent Garden, London, United Kingdom, WC2H 9JQ (as listed by Companies House). | DECIDED | none (already in `apps/web/src/lib/site.ts`) |
| G4 Export | Agree format, frequency and fields once the accountant is appointed. | OPEN | |
| G5 Insurance | **In place**, per Tahasin; Abdurrahman is responsible. | WORKING | Policy types, cover and wording **before** claiming public liability or professional indemnity on the site. (The site makes no insurance claim today.) |

### H. People and family accounts

| Item | Answer | Status | Still to confirm |
| --- | --- | --- | --- |
| H1 Staff | Separate logins. Tahasin, Abdurrahman and Alvi are admin and tutor; **Brian is admin only**. Limit billing access to authorised admin duties. | DECIDED | Usernames and reset emails, privately. |
| H2 to H4 | Launch tutors, launch families and current family rates are supplied **privately**, over a secure route. | OPEN | The data. Nothing about real people goes in the repo. |
| H5 Family communication | Tahasin tells parents about the move. | WORKING | The rollout date. The draft guide is in [FAMILY_TERMS_DRAFT_v0.2.md](FAMILY_TERMS_DRAFT_v0.2.md). |
| H6 Password resets | Use the reset link sent to the linked email. | DECIDED | Which admin handles the fallback, identity checks, how temporary credentials are issued. |
| H7 Old systems | not answered | OPEN | TutorCruncher and the old marketing site: migration, cutover, retention dates. |

### I. Public contact and launch

| Item | Answer | Status | Still to confirm |
| --- | --- | --- | --- |
| I1 Public contact | `info@learnthrivetuition.co.uk` is monitored and takes general enquiries. | DECIDED | Phone numbers, inbox owners, monitoring, the five-working-day auto-reply. |
| I2 Security reports | `security.txt` lists `info@`. | WORKING | Who owns triage and escalation. |
| I3 Company email | Google Workspace is the working assumption. | WORKING | The provider, and who may authorise sending-domain changes. |
| I4 Site wording | Align public wording with monthly billing, the 10% sibling offer, the free 30-minute taster and the recording decision. **Verify safeguarding numbers, tutor checks and insurance claims before publication.** | OPEN | See section 4. |

---

## 3. What can be built now, and what is blocked

**Can start (decided, and not waiting on a legal or payment decision):** items 1 to 4 are **built** (see [TUITION_BILLING.md](TUITION_BILLING.md)); item 5 is not.

1. **Charging data model for monthly arrears** (task 3.10 rework): a family rate and a separate tutor rate, each with start dates; chargeable-lesson rules (delivered, late-cancelled, no-show); **per-child** counters for the waived first late cancellation and the waived first no-show, kept **separately**; the 10% sibling line; a monthly statement showing the B16 fields. Keep the repeat fee, the reset rule and the sibling-eligibility rule as settings that are blank until confirmed.
2. **Tutor-side hiding of money** (B17): a test that no tutor screen, message or export exposes an amount, invoice, refund, balance or discount.
3. **Overdue as a flag, not an action** (B12): show "more than one month overdue" to admins; no automatic suspension.
4. **Refund action restricted to one named approver** (B11), logged.
5. **Parent sign-in guide** screens, once Brian checks them (H5).

**Blocked until answered:**

- **Collecting money**: the family payment method (B1, B13, B19) and the Stripe account (A1 to A9).
- **Recording lessons**: F5 (impact assessment), F9 (who hosts recordings), F7 (retention), D6 (settings and failure procedure), the privacy notice and enrolment text.
- **Publishing any of the new wording** (I4): the solicitor review in mid-December, and the safeguarding numbers.
- **Opening tutor applications**: E1, E2.
- **Loading real people and rates**: H2 to H4, over a secure route.

---

## 4. Where the repo still says the old thing

These are **not changed** by this file. Change them only when the decision behind each is closed (section 3), and keep safeguarding, enrolment, privacy and careers wording consistent.

| Where | Says today | Conflicts with |
| --- | --- | --- |
| `apps/web/src/app/(public)/safeguarding/page.tsx` (about lines 30 and 139) | "LearnThrive lessons are not recorded by default" and no lesson-recording system | The 7 Nov recording decision (D6). Do not edit until F5 is done. |
| `apps/web/src/lib/legal-faqs.tsx`, FAQ `lesson-recordings` (about line 308) | "No. LearnThrive lessons are not recorded by default", and lists what the company must establish **before** recording is enabled | Same. That list is a good start for F5. |
| `apps/web/src/lib/legal-faqs.tsx` (about line 191) | "Invoices may be issued in advance, including on a monthly basis" | B1: monthly **in arrears**. |
| `apps/web/src/lib/faqs.ts` (about lines 31 to 46, 148) and the booking pages | "free consultation" | B5: a free **30-minute taster**. Open whether the two stay separate. |
| `apps/web/src/lib/safeguarding-agreement-v1.ts` | the careers agreement text | E1: reconcile recording and private messaging, clause by clause. |
| `docs/LAUNCH_CHECKLIST.md` Phase 0 and 3.10 | "no lesson recording", "DPIA not needed", "parents pay through Stripe" | Section 1. Annotated on 7 Nov 2026. |
| `docs/LAWFUL_BASES.md` | no learner accounts or recording | F1. |
| `docs/RETENTION_AND_DELETION.md` | no retention period for recordings | F7. |

---

## 5. Questions to send back to Tahasin (all of them, in priority order)

1. **Billing.** What is the family payment method (not PayPal)? Are cash or manual bank transfers allowed? What are the family rates, and who sets them? What is the repeat late-cancellation fee and when does the allowance reset? When exactly does the "more than one month overdue" clock start, and who authorises a pause?
2. **Prepaid.** B1 bills in arrears but B10 describes prepaid lessons. Are prepaid blocks sold at all? If yes, how do they sit with the monthly bill?
3. **Sibling discount.** Does a family need two or more enrolled children before any child gets the 10%? How is eligibility recorded?
4. **No-shows.** One waived no-show per child (as drafted), or one shared allowance for the child's account?
5. **Taster.** Does the website's free consultation stay separate from the free 30-minute taster?
6. **Recording.** Who hosts the recordings? Who may watch them, for how long are they kept, and what happens if recording fails? When will the impact assessment be done? (Nothing is recorded until it is.)
7. **Safeguarding numbers.** The full 11-digit number, and the branch and deputy numbers. May they be published? What are the cover and monitoring hours for `info@`?
8. **Careers.** Send the clause decisions on the agreement; confirm the DBS route, identity and right-to-work checks, references, interviews, and who triages `info@` for applications.
9. **Privacy.** Approve or amend the data-request and breach plans, the retention periods, the purge delay, and the processor agreements. Is there an appropriate policy document? What are the ICO registration number and renewal date?
10. **Company.** Appoint an accountant. Which insurance policies, what cover? Confirm the email provider and who authorises sending-domain changes. What happens to TutorCruncher and the old site, and when?
11. **Launch.** The rollout date, and a secure route for the launch tutors, families and their contracted rates.
12. **Stripe.** Is the company opening a Stripe account, and if so who and when (A1 to A9 in the 2 Nov handover)? Or will a different method be used?
