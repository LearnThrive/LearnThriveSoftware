# Owner answers, round 2: Tahasin's decisions of 14 November 2026

**Source.** Tahasin Hasan's reply to the second handover ([TAHASIN_HANDOVER_ROUND2.md](TAHASIN_HANDOVER_ROUND2.md)), passed on by Alvi, with one change of Alvi's own: **the website launches without Stripe. Parents pay by bank transfer for now, and the system tracks lessons and prices.** It adds to the answers of [7 November](OWNER_ANSWERS_2026-11-07.md); where the two differ, this file wins.

Statuses: **DECIDED** built to it · **ASSUMED** the answer did not say, so a default was chosen and must be confirmed · **DEFERRED** decided, but not part of the first launch · **OPEN** still needs an answer · **APPROVAL** needs a legal, safeguarding or technical sign-off before it goes live.

## What was asked before anything goes live

> *"Before launching the website, please send me a complete breakdown of all costs ... I want to review and approve the total cost before the website goes live."*

Written as [RUNNING_COSTS.md](RUNNING_COSTS.md): about **$50 a month (roughly £39)** plus about £12 a year for the domain, with a tick-box for Tahasin to approve. **The website must not go live until he has approved it.** This is a gate in the [launch checklist](LAUNCH_CHECKLIST.md).

## 1. Website and launch

| Item | Answer | Status | What was done |
| --- | --- | --- | --- |
| Launch now, solicitor later | Launch now; the solicitor's review comes later | DECIDED, **APPROVAL (legal)** | Public pages updated only where a statement was plainly wrong (below). Every other legal page is unchanged and unreviewed; the review is still needed |
| Free taster | A free 30-minute session that includes the initial consultation: one service, not two | DECIDED | The booking page now says the free consultation is the free 30-minute taster. The button text "Book a free consultation" is left as it is (renaming it everywhere is optional) |
| Safeguarding contacts | Tahasin Hasan and Abdurrahman Mustafa; their numbers to be given privately | DECIDED; numbers **OPEN** | Not stored or published. `SAFEGUARDING_LEAD_EMAILS` should list both of their linked emails |
| Email | Enquiries, complaints and safeguarding correspondence all go to `info@learnthrivetuition.co.uk` | DECIDED | Already the published address |
| DBS | All necessary checks and requirements completed before tutors teach | DECIDED | Matches the careers pages and the tutor safeguarding agreement |
| Costs | Full breakdown to be approved before going live | **APPROVAL (Tahasin)** | [RUNNING_COSTS.md](RUNNING_COSTS.md) |

## 2. Payments, pricing and cancellations

| Item | Answer | Status | What was done |
| --- | --- | --- | --- |
| Payment method | Parents pay by card on the website; a payment provider keeps a card on file | **DEFERRED** | **First launch: bank transfer.** Parents see how to pay on a new **Fees** page and an administrator records each payment. Card payment (and a card on file, which needs a payment provider such as Stripe) comes later. **Tahasin has to be told: his answer assumed cards at launch** |
| Hourly rates | Tahasin and Abdurrahman set them together | DECIDED | Rates are entered per family on the billing screens. Who may see billing is still open (round 2, question 2.18) |
| Contracts | No fixed 12 months. An initial minimum of three months, then one month's notice | DECIDED | A family's rate now runs **until a newer one replaces it** (migration `0024`), and a change of price can start today or later, never backdated. The three-month minimum and the month's notice are **terms**, not software: they are in the family wording draft v0.3 and are not enforced by the system |
| Late cancellation | First one free for each child; later ones charged | DECIDED; amount **ASSUMED** | The answer did not say how much. A repeat late cancellation is charged at the **lesson's own price** (as a repeat no-show is). A fixed fee can be set instead on the billing rules page. **Confirm** |
| No-shows | A tutor waits 15 minutes from the scheduled start before marking a no-show | DECIDED | Enforced: a student cannot be marked absent until 15 minutes after the start, in the software and on the screen |
| Sibling discount | 10% | DECIDED | Already built (set per family by an administrator). Whether a family needs two children before any gets it is still open |
| Invoices | Monthly, for lessons already delivered, payment collected through the website | DECIDED; collection **DEFERRED** | Monthly statements in arrears are built. Public FAQ wording "invoices may be issued in advance" corrected to monthly in arrears |
| Refunds | Tahasin Hasan only; no other administrator may approve | DECIDED | Enforced by the system, not by trust: set `TUITION_REFUND_APPROVER_EMAILS` to **Tahasin's linked email only** and nobody else can approve or reject (every attempt is logged) |
| Overdue | More than a month outstanding: lessons paused until resolved | DECIDED; method **ASSUMED** | **A person pauses them, with a reason, from the family's billing page; the system does not do it by itself.** It marks the family's assignments Paused and no new lessons can then be scheduled on them. Automatic pausing is not built: a child must not lose lessons by a calculation nobody looked at. Lessons already booked are left for an administrator to cancel. **Confirm** this is acceptable |
| Tutor payments | From the business bank account on the 15th of each month | DECIDED | A **pay run** page and a CSV for each month list what every tutor is owed (completed lessons, at their hourly pay on the day). It adds up; it moves no money |

## 3. Safeguarding and lesson recordings

| Item | Answer | Status | What was done |
| --- | --- | --- | --- |
| Launch without recording | The site launches whether or not recording is ready; recording is switched on after the privacy and safeguarding assessments are approved | DECIDED, **APPROVAL (legal, safeguarding)** | **Nothing is recorded and no recording system is built.** The public pages still say lessons are not recorded by default, which stays true until it is switched on |
| Who is recorded | Tutors and students, when the system is active | DECIDED | Needs the privacy notice and the enrolment wording to say so first (a parent must get the recording information before enrolling) |
| Retention | Deleted automatically after 30 days, unless needed for safeguarding or legal reasons | DECIDED | Recorded for when it is built. A safeguarding hold overrides the deletion |
| Recording fails | The tutor may use their discretion whether to continue, under the approved safeguarding procedure; any failure is reported and logged | DECIDED, **APPROVAL (safeguarding)** | The procedure does not exist yet and must be written and approved by the safeguarding leads. The failure log is to be built with the recording system |
| Training | By Tahasin and Abdurrahman before teaching | DECIDED | Recorded on the tutor's checks card once seen (the tutor checks register has a safeguarding-training line) |
| Serious concerns | Handled by Tahasin and Abdurrahman, with escalation where needed | DECIDED | The concern log in the dashboard is read only by named leads. With `SAFEGUARDING_LEAD_EMAILS` unset it stays closed |

## 4. Tutors and recruitment

| Item | Answer | Status | What was done |
| --- | --- | --- | --- |
| Employment status | Self-employed, under appropriate contracts | DECIDED, **APPROVAL (legal)** | A tutor contract has still to be drafted and reviewed (round 2, question 4.1) |
| DBS cost | Tutors pay at first; LearnThrive may reimburse later, subject to approval | DECIDED | Public careers, safeguarding and legal pages and the application's DBS tick-box now say so. They no longer say LearnThrive arranges or pays |
| Tutor application form | A dedicated form on the website; Alvi to prepare it for review before it opens | DECIDED | **It already exists**: eight sections, uploads, stored in the database, reviewed by administrators. It is closed, and stays closed until the 60 unapproved clauses of the safeguarding agreement are approved (`agreementApprovedByOwner`). Ready for Alvi's review |
| Agreement and checks | All checks, training and agreements completed before a tutor starts lessons | DECIDED | Matches the application and the tutor checks register |

## Still needs approval, by kind

**Legal (solicitor, after launch)**: the family terms (three-month minimum, month's notice, bank transfer, lessons paused when overdue, the repeat late-cancel charge); the privacy notice and enrolment wording for recording; the tutor self-employed contract; the 14-day distance-contract notice; the public pages the solicitor has not seen (cookies, privacy, accounts, payments, the portal).

**Safeguarding (Tahasin and Abdurrahman)**: the safeguarding agreement clause by clause; the recording-failure procedure; the impact assessment before any recording; the training content; who reads concerns and whether the in-app concern log is wanted.

**Technical (Brian and Alvi, with the owners where money or data is involved)**: Tahasin's approval of the running costs; the bank details and wording on the billing rules page (so parents can pay); the environment variables for the refund approver and the safeguarding leads; applying migrations `0022`, `0023` and `0024` to the hosted database (each needs the owner's go-ahead); the Render, Resend and Cloudflare accounts and keys; a recording system, when it is wanted (its host and cost are undecided); card payment, when it is wanted.

## Not answered, and needed soon

From the second handover and not covered above: who may see billing amounts (2.18); when statements go out and in what form (2.16); refund criteria and turnaround (2.12); what happens to billing records when someone leaves (2.20); the accountant; the source of the real family and tutor data and a secure way to send it (5.2, 5.3); staff usernames; the ICO number; the full safeguarding phone numbers, privately.
