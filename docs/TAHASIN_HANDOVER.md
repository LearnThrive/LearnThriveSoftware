# What we need from Tahasin

**Answered 7 November 2026 for sections B to I:** see [OWNER_ANSWERS_2026-11-07.md](OWNER_ANSWERS_2026-11-07.md) (section A, the Stripe account, was not answered). The questions below are the original 2 Nov text.

Written 2 November 2026 from LearnThrive's launch checklist and lawful-bases draft. Tahasin Hasan supplies the terms and the charging rules, is safeguarding lead and (with Abdurrahman) handles the data. LearnThrive has **no Stripe account yet that Tahasin holds**, so section A is a set-up guide: the company has to open one. Brian cannot finish the payments work, the legal pages or the careers launch without what is below.

How to use it: Alvi or Brian sits with Tahasin, fills the **Answer** lines, and gives the finished copy back to Brian. Anything marked **Blocks** stops that piece of work until it is answered. Where a question has a recommended answer it is shown, so "yes, go with that" is a valid reply. Never send passwords, API keys or the Stripe secret in chat or email: use a password manager.

**Where something is also for Abdurrahman** (he shares the data and privacy role, and is deputy safeguarding lead) it says so.

---

## Priority order

| # | What | Blocks |
| --- | --- | --- |
| 1 | Open and verify the company's Stripe account (section A) | All tuition payments (checklist 3.10); verification can take days, so start first |
| 2 | Charging rules (section B) | Designing and building payments |
| 3 | Terms and the enrolment agreement (section C) | The terms page, payment wording, learner accounts |
| 4 | Safeguarding contact details and procedure (section D) | `/safeguarding`, `/careers`, the privacy page |
| 5 | Careers agreement approval (section E) | Opening the tutor application form |
| 6 | Privacy, breach and data-request contacts (section F) | Privacy, complaints and cookie pages |
| 7 | Accountant, VAT and company details (section G) | Invoices and tax |
| 8 | Real people and families (section H) | Creating accounts, loading data |

---

## A. Stripe account (blocks all of checklist 3.10)

Decided 2 Nov 2026: parents pay for lessons through Stripe. **Tahasin does not hold a Stripe account**, so LearnThrive Tuition Ltd has to open one. This section says how. Stripe's screens change, so follow what Stripe shows and treat the steps below as the checklist of what it will ask for.

**Who opens it.** Someone with authority over the company: a director, so Tahasin or Abdurrahman (or both are added). Open it with a **company email address**, not a personal one, and as the company (LearnThrive Tuition Ltd), not as an individual or sole trader. The account is the company's, so it survives if a person leaves.

**The shortest path:**

1. **Sign up** at stripe.com with the company email, choose the **United Kingdom** as the country, and turn on **two-step sign-in** at once (an authenticator app, not text messages).
2. **Use test mode first.** A new account comes with a test (sandbox) mode that works immediately and needs no verification. Brian builds and rehearses everything there. No real money moves in test mode.
3. **Activate the account (go live)** by completing Stripe's business verification. Start this early because Stripe can ask for more documents and it can take several days. It will ask for:
   - Company name, number (16680738), registered office address, and company type (private limited company).
   - The business website (the new LearnThrive site, or the current one) and a plain description of what is sold: private tuition for children from Year 1 to A Level, paid by parents.
   - Details of each **director** and anyone who owns 25% or more: full name, date of birth, home address, and an ID document (passport or driving licence). Each person may have to verify in person on their own device.
   - A **UK business bank account in the company's name** (sort code and account number) for payouts.
   - Public details customers see: business name, statement descriptor, support email, support phone.
4. **Turn on the payment methods** chosen in A5.
5. **Give the builders their own logins** (A6), not the director's.
6. **Create the keys later**, when Brian asks (A7). Not now.

**Things to know before starting:**
- **Fees.** Stripe charges a percentage plus a fixed amount per successful card payment, and the rate differs for UK and non-UK cards. Check the current figures on Stripe's pricing page and let the accountant factor them into the prices (B2). LearnThrive can absorb them or build them into the fee.
- **Payouts.** Stripe pays out to the bank account on a schedule (the first payouts are slower). Choose automatic daily or weekly payouts.
- **Parent pays, never the child.** The paying customer is always the parent or guardian. No child's details are needed by Stripe beyond an internal reference.
- **Tutor pay stays outside Stripe** (assumed in B18). If the answer to B18 is Stripe Connect instead, tell Brian now: that needs a different account type and identity checks for every tutor.
- **Test and live are separate.** Tests never use real cards. Real money only moves after the checks in the launch checklist (3.10.14).
- **Do not share logins or send keys in chat.** Each person gets their own named user.

Please fill in the answers as you go:

- [ ] **A1. Who will open the account (a director), and on what date?**
  Answer:
- [ ] **A2. Company email address used for the account** (a shared mailbox such as `payments@...` is best, so it survives staff changes):
  Answer:
- [ ] **A3. Is the account opened and in test mode** (screenshot of the dashboard with the "Test mode" switch, no keys visible)?
  Answer:
- [ ] **A4. Business verification submitted** (date), and **complete** (date)? Stripe will not pay out until it is complete.
  Answer:
- [ ] **A5. Public details to set.** Business name as it should show on cards; statement descriptor (max 22 characters, for example `LEARNTHRIVE TUITION`); support email; support phone; logo and brand colour. Also the payment methods: cards only? Apple Pay and Google Pay? Direct Debit (Bacs)? Direct Debit is cheaper for recurring payments but needs mandates and takes days to clear.
  Answer:
- [ ] **A6. Add Brian and Alvi as named users** (Settings, then Team, then invite) with their own logins and two-step sign-in, never the director's login. Suggested role: Developer for the person building, Analyst for finance views, not Administrator. Confirm the roles and the email each person uses:
  Answer:
- [ ] **A7. Keys, when Brian asks.** A **restricted** API key (not the full secret key) and a webhook signing secret, one set for test mode and one for live. Brian puts them in Render's dashboard; they never go in chat or email. Confirm who creates them (a director or an Administrator on the account):
  Answer:
- [ ] **A8. Who gets payment alerts, dispute notices and payout emails** (an address that is read daily)?
  Answer:
- [ ] **A9. Payout bank account.** Confirm the company bank account to use, and who at the bank or accountant can confirm it matches the company name.
  Answer:

## B. Charging rules (blocks the design; these are product decisions)

These are the questions in checklist 0.1a to 0.1h. Please answer all of them before any payment code is written, because changing them later means rebuilding.

- [ ] **B1. How do parents pay?** Choose one:
  1. Pay per lesson when it is booked
  2. Prepaid blocks or packages of lessons
  3. A monthly invoice in arrears for lessons delivered
  4. A fixed monthly fee per child's tuition
  Answer:
- [ ] **B2. Rates.** Is the price per hour set per tutor, per subject, per level (Year 1 to A Level), or per student? Who sets it and can change it? What are the current prices? (A table is fine.)
  Answer:
- [ ] **B3. Mid-term price changes.** When a rate changes, when does the new rate start, and what notice do parents get?
  Answer:
- [ ] **B4. Sibling discount or concessions.** Any? How much? How are they recorded?
  Answer:
- [ ] **B5. First lesson or trial.** Free, discounted (how much), or full price? Does the enquiry form's "free consultation" stay free and separate from a trial lesson?
  Answer:
- [ ] **B6. Cancellation by the parent.** How much notice is free (for example 24 hours)? What is charged for a late cancellation, as a percentage or an amount?
  Answer:
- [ ] **B7. No-shows.** Is a missed lesson charged in full?
  Answer:
- [ ] **B8. Tutor cancels or is ill.** Free rescheduled lesson, credit, or refund? How long does the parent have to take a make-up lesson?
  Answer:
- [ ] **B9. Make-up lessons.** Allowed? How many? Do they expire?
  Answer:
- [ ] **B10. Prepaid lessons: how long are they valid?** And what happens to unused lessons if the child leaves (refund, credit, or lost after a set time)?
  Answer:
- [ ] **B11. Refund rules.** What can be refunded, how fast, back to the original card? Who approves a refund? Is there a limit on what staff can refund without a second person?
  Answer:
- [ ] **B12. Failed or late payment.** How many retries, how many reminders, over what days? **Recommended:** never cut a child off from lessons automatically; show a notice and let an admin decide. Agree?
  Answer:
- [ ] **B13. Disputes and chargebacks.** Who handles a card dispute in Stripe and within what time (Stripe gives about 7 to 21 days to respond)?
  Answer:
- [ ] **B14. Mid-month start.** Is the first month pro-rated, or charged by lessons actually held?
  Answer:
- [ ] **B15. Who may pay?** Parent or guardian only (a child never pays). If there is a second payer, such as a separated parent or a school paying, how do we handle it?
  Answer:
- [ ] **B16. Invoice email (decided).** The system emails the client an invoice when a payment succeeds, to their linked email. Confirm what it must show beyond the standard (number, date, lessons or period, amount, tax, company name, number and registered office, a link to the receipt): any wording, a PDF attached, a payment reference?
  Answer:
- [ ] **B17. Can tutors see any amounts** (what a family pays), or never? **Recommended:** never.
  Answer:
- [ ] **B18. Tutor pay.** Assumed: LearnThrive pays tutors outside Stripe (bank transfer or payroll). Confirm. The alternative, Stripe Connect, adds identity checks for every tutor and a much larger build.
  Answer:
- [ ] **B19. Manual payments.** Will bank transfer or cash ever be accepted for some families? If yes, an admin records it by hand with a reason.
  Answer:

## C. Terms and agreements (blocks the terms page and every payment screen)

Decided 2 Nov 2026: Tahasin provides the terms.

- [ ] **C1. Terms and conditions for parents and families.** Please supply the final text (or tell us where the document is). It must cover fees, cancellation, refunds, make-up lessons, and the points in B above. Date it and tell us the version number or date.
  Answer:
- [ ] **C2. Enrolment agreement.** The page the parent agrees to when their child is enrolled. It must say that **the parent agrees to the child having their own account** (all learners are under 18) and that **lessons are not recorded**.
  Answer:
- [ ] **C3. Terms for tutors.** Is this the careers safeguarding agreement plus a separate tutor contract (employed or self-employed)? Who supplies the contract, and is the tutor treated as self-employed? (This changes the legal basis for right-to-work checks.)
  Answer:
- [ ] **C4. Has a solicitor reviewed the terms?** Name and date, or "not yet".
  Answer:
- [ ] **C5. Consumer-rights wording for online sales.** Has anyone checked the cancellation and 14-day cooling-off wording for distance contracts? (A solicitor should.)
  Answer:
- [ ] **C6. Complaints procedure text.** Who is the first contact, the reply time, and the second stage? One short page is enough.
  Answer:
- [ ] **C7. Anything about school or council invoicing?** If a school or local authority ever pays, do we need a separate agreement?
  Answer:

## D. Safeguarding (Tahasin is lead; Abdurrahman is deputy)

The site's pages currently show placeholders instead of real contact details for the lead and the deputy.

- [ ] **D1. A monitored email for safeguarding concerns.** Who reads it, and how fast? (For example `safeguarding@...`.)
  Answer:
- [ ] **D2. A phone number for the lead (Tahasin) and for the deputy (Abdurrahman).** Which numbers may be shown publicly on the site?
  Answer:
- [ ] **D3. What happens after a concern is reported?** Write the steps in plain English: who is told, within what time, when the police or the local authority designated officer (LADO) or children's social care is contacted, how it is recorded, how the concerned person is protected.
  Answer:
- [ ] **D4. Safeguarding policy document.** Does one exist? Please supply it, with the date it was last reviewed and who approved it. The site's safeguarding page and tutor agreement must match it.
  Answer:
- [ ] **D5. Safeguarding training.** Which safeguarding training does the lead have, and what do tutors have to complete before teaching?
  Answer:
- [ ] **D6. Compensating controls now that lessons are not recorded** (decided). Choose or add: a parent may sit in or be nearby; no private messaging between tutor and child; the classroom chat is not stored; tutors only teach through the LearnThrive classroom; two tutors present for some situations; cameras on. Which apply?
  Answer:
- [ ] **D7. Can a parent or the safeguarding lead observe a lesson?** If yes, how (a silent join, or the parent in the room)?
  Answer:
- [ ] **D8. Where are safeguarding records kept?** They must be stored separately from the normal records with restricted access (checklist 0.4). Which system, who has access, how long are they kept?
  Answer:
- [ ] **D9. Learners' age rule.** All learners are under 18 and have their own username. **Do the youngest children (Year 1 and 2, ages 5 to 7) sign in themselves, or only through the parent's supervised view?** The supervised view stays available either way.
  Answer:
- [ ] **D10. Does Tahasin sign off the learner age rule** and the rule that a child's username is a short generated name with no real name or school in it (for example `fox-4821`)?
  Answer:

## E. Careers and tutor onboarding (blocks opening the application form)

The tutor application form stays **closed** until the safeguarding agreement is approved. Seven clauses are marked approved so far (including A1, F1, F2, F4, G1 and G6); the rest need a decision. The agreement text is in `apps/web/src/lib/safeguarding-agreement-v1.ts` and shown on `/careers/safeguarding-agreement`.

- [ ] **E1. Read every clause of the safeguarding agreement and mark each one approved, changed (give the new wording) or removed.** Brian can print the page for you.
  Answer:
- [ ] **E2. Final sign-off:** "the agreement is approved and the careers form may open." Date and who:
  Answer:
- [ ] **E3. DBS.** Tutors pay for their own DBS (decided). Which level (Enhanced with the Children's Barred List is assumed)? Which route: a new check through which umbrella body, or the DBS Update Service for tutors who already have a certificate? What do we record (suggested: that the certificate or Update Service result was seen, by whom and when, never a copy)?
  Answer:
- [ ] **E4. Identity and right-to-work checks.** Which documents are accepted, who checks them, and do we keep scans? (Suggested: record "identity seen", delete scans once verified, in 6 months at the latest.)
  Answer:
- [ ] **E5. References.** How many, from whom, and who contacts them?
  Answer:
- [ ] **E6. Interview process.** Who interviews, and what are the stages from application to first lesson? (This sets the statuses admins use: new, reviewing, interview, accepted, rejected, withdrawn.)
  Answer:
- [ ] **E7. Mailbox for new applications** and who reads it. The page promises a reply within 5 working days. Confirm.
  Answer:
- [ ] **E8. Yearly reconfirmation of the agreement** (clause G1). How is it sent, and who chases tutors who do not respond?
  Answer:
- [ ] **E9. The roles listed on the careers page.** Which subjects and levels are actually recruiting right now? Anything to add or remove?
  Answer:

## F. Privacy, data and complaints (Tahasin and Abdurrahman together)

You two control and handle the data, privacy requests, complaints and breaches (decided).

- [ ] **F1. Review and approve the lawful-bases table** in [LAWFUL_BASES.md](LAWFUL_BASES.md). Alvi has confirmed it; you must confirm it too, because the privacy notice repeats it. Note any changes.
  Answer:
- [ ] **F2. An email address for each of:** privacy and data requests (access, deletion, correction), complaints, and data breaches. Each may be the same address if one mailbox is watched.
  Answer:
- [ ] **F3. How to verify a data request** from a parent for their child, and from a child (or former student) for themselves? Who decides, and in how many days (the law gives one month)?
  Answer:
- [ ] **F4. Breach plan.** A short written plan: who decides if a breach is reportable, who tells the ICO within 72 hours, who tells families, and where the incident is logged. Please write it, or ask Brian to draft it from your answers.
  Answer:
- [ ] **F5. DPIA.** Decided: not needed. Before we publish, will you run the ICO's own DPIA screening checklist (children's data and live online lessons are on its list of things that can make one necessary)? If it says "likely high risk", a DPIA is legally required. Answer: done on (date) / will do / not doing.
  Answer:
- [ ] **F6. Special category data (health, SEND).** Option 1 (recommended): tell families not to put health or SEND detail in the enquiry form, and collect it later only with explicit consent. Option 2: collect it deliberately. Which?
  Answer:
- [ ] **F7. Retention periods the owners must set** (the rule is: records are purged when someone leaves, except these):
  - Financial records: how many years? (6 is typical; the accountant confirms.)
  - Safeguarding records: how long?
  - DBS record after a tutor leaves: how long?
  - Safeguarding agreement and reconfirmations after a tutor leaves: how long?
  - Complaints: suggested 6 years after resolution.
  - Enquiries that never became tuition: 12 months. OK?
  - Unsuccessful tutor applications: 6 months (12 months if they agree to be kept). OK?
  - Subject requests: until the subject is added, or 12 months.
  Answer:
- [ ] **F8. Purge delay.** When a student or tutor is marked as having left, do we wait (suggested 30 days) before the purge runs, so a mistake can be undone? Or purge at once?
  Answer:
- [ ] **F9. Data processing agreements.** Do you hold a signed data processing agreement (or accepted online terms) with each of: Render, Supabase, Resend, Stripe, Cloudflare, and the email provider? Who keeps them?
  Answer:
- [ ] **F10. Appropriate policy document** for safeguarding and DBS data (a UK GDPR requirement for this kind of data). Does one exist?
  Answer:
- [ ] **F11. The ICO fee** is paid (decided). When does it renew? Date and the registration number to show on the privacy page:
  Answer:
- [ ] **F12. Legal review of the website pages.** Has a solicitor read the cookie, privacy, accounts, payments and portal text? The review file is `apps/web/LEGAL_REVIEW.md`; it needs a signed-off date.
  Answer:

## G. Company, accountant and VAT

- [ ] **G1. Accountant's name and contact.** Brian will need to talk to them about VAT, invoices and what to export.
  Answer:
- [ ] **G2. VAT.** Is LearnThrive Tuition Ltd VAT registered? Is private tuition treated as VAT-exempt (the accountant decides)? If registered, the VAT number.
  Answer:
- [ ] **G3. Confirm the company details used on invoices and the site** against Companies House: LearnThrive Tuition Ltd, company number 16680738, England and Wales, and the **registered office address** that must appear on invoices.
  Answer:
- [ ] **G4. How does the accountant want the data?** A monthly export of payments, refunds and payouts (CSV)? Which columns?
  Answer:
- [ ] **G5. Business insurance.** Public liability and professional indemnity in place? The site or terms may mention it.
  Answer:

## H. People and families (for creating accounts)

Decided: LearnThrive creates every account by hand; people sign in with a username; every account is linked to a real email (a child's to the parent's).

- [ ] **H1. The four staff, for the first accounts.** For each, a name, a **real email** for resets, and a username to agree with them. Alvi, Tahasin and Abdurrahman are admin and tutor; Brian is admin only.
  Answer:
- [ ] **H2. Other tutors starting at launch.** Name, real email, subjects and levels, and whether their DBS has been seen.
  Answer:
- [ ] **H3. Families starting at launch.** For each: the parent or guardian's name, **real email**, phone, each child's first name, year group and subjects, the tutor, the weekly lesson time. Where is this list kept today (a spreadsheet, TutorCruncher)? Please share it by a secure route, not in chat.
  Answer:
- [ ] **H4. Current lesson prices per family** (for the first invoices; may differ from the standard rate).
  Answer:
- [ ] **H5. Who talks to each family about the move to the new system**, and when? Parents need a short guide: how to sign in with a username and temporary password, change it, find their child's lessons, join a class, and who to contact.
  Answer:
- [ ] **H6. If a family forgets their password,** an emailed reset link goes to the linked email, and an admin can issue a new temporary password after confirming identity. Who is the admin on call for that, and how do they confirm a parent's identity (a phone call to a known number)?
  Answer:
- [ ] **H7. Old system.** What happens to TutorCruncher and the old marketing site after launch, and when?
  Answer:

## I. Everyday contact details the site shows

- [ ] **I1. Public contact email (`info@`) and phone**, and who watches them. The auto-reply promises a reply within five working days. Confirm.
  Answer:
- [ ] **I2. `security.txt` contact.** It currently lists the public `info@` address. Is that monitored and acceptable?
  Answer:
- [ ] **I3. Company email provider.** Who hosts the company mailboxes? (Probably Google Workspace.) Brian needs admin access to add the records that let the site send email from the domain without it going to spam.
  Answer:
- [ ] **I4. Any wording on the site you want changed before launch** (prices, bios, FAQ, claims such as "DBS checked" or "fully insured")? Every claim must be true on launch day.
  Answer:

---

## Not for Tahasin (so he does not get asked)

These sit with Alvi or Brian: the Cloudflare keys, the Render service, Supabase settings and the DNS records at IONOS. They are listed in the launch checklist.
