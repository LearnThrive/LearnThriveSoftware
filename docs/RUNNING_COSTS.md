# What it costs to run LearnThrive Tuition

For Tahasin Hasan's approval before the website goes live. Written 14 November 2026. Tahasin asked for every cost: hosting, database, payment processing, video, email, subscriptions, and anything ongoing or one-off.

**How to read this.** Prices were looked up on 14 November 2026 from each supplier's own pricing page where the search reached it, and otherwise from third-party guides (each is marked). **Nothing here has been checked against a real invoice**: none of these services has been billed for the live site yet. Suppliers price in US dollars; the pounds shown use an **assumed £0.78 to the dollar**, and the real rate on each bill will differ. UK VAT at 20% may be added to the dollar-priced services, and because the company is not VAT registered it could not reclaim it (not verified; ask the accountant). Figures below are before any VAT.

## The short answer

| | Per month | Per year |
| --- | --- | --- |
| **Expected, at launch** (about 40 students, bank-transfer payments, no recording) | **about $50, roughly £39** | **about $600, roughly £470** |
| Plus the domain name | about £1 | about £12 |
| Plus company email (Google Workspace), which already exists and is not caused by the website | £5.90 to £7 for each mailbox | depends on how many mailboxes |
| **Card payments** | £0 at launch (parents pay by bank transfer) | £0 |

The two lines that make up the $50 are the website host (**$25**) and the database (**$25**). Everything else is on a free allowance at this size. **Nothing needs a one-off payment to launch**, apart from the solicitor's review and an accountant, which are the owners' own arrangements and are not priced here.

## Recurring costs

| What it does | Supplier and plan | Cost | Notes |
| --- | --- | --- | --- |
| Runs the website and the online classroom's signalling | **Render**, Standard web service, 2 GB memory, one instance | **$25 a month** (about £19.50) | Render's own pricing lists Standard at $25 and Starter at $7 (512 MB). I recommend Standard: the site and the classroom run in one process, and 512 MB is likely too small, but that has not been tested. Billed by the second, so a month is a month. The free workspace plan is enough for one service; the Pro workspace plan is a further $25 and is not needed. **Check:** one source says Render cut the bandwidth included with each plan in 2026 and charges about $0.15 per GB beyond it; the figure is unverified, and a site this size should stay within any such allowance, but check the live pricing page |
| Database, sign-in, stored files, backups | **Supabase**, Pro plan | **$25 a month** (about £19.50) | This is already paid for: the project `learnthrive-prod` is on Pro. Pro includes $10 a month of compute credit, which covers the small database size (Micro) in use, so the database itself adds nothing. Includes daily backups, 8 GB of database and 100 GB of file storage (storage figure unverified). Extra only if the database or traffic outgrows those |
| Email the website sends (enquiry replies, safeguarding notices, tutor applications) | **Resend**, Free plan | **$0** | 3,000 emails a month, up to 100 a day. The paid plan is $20 a month for 50,000. At about 40 families the free plan is enough; the 100 a day limit is the one to watch in a busy week |
| Video and audio relay for the classroom | **Cloudflare** Realtime (SFU and TURN) | **$0 at this size** | Billed per gigabyte sent out, at $0.05 per GB after the **first 1,000 GB each month, which is free** (Cloudflare's own pricing). A one-hour lesson between a tutor and one student is about 0.6 GB. 175 such lessons a month (40 students, one a week) is about 110 GB, so well inside the free amount. A whole class of 10 students is the heavy case at about 35 GB an hour; Cloudflare's alert should be set before launch |
| The web address | **IONOS**, `.co.uk` domain | about **£12 a year** including VAT | Third-party figure (renewal about £10 plus VAT); IONOS has said renewal prices will rise in 2026. Already registered, so this is a renewal, not a new cost |
| Company email | **Google Workspace**, Business Starter | **£5.90** per mailbox per month on a year's commitment, **£7** if billed monthly | From Google's UK pricing page. **Already in use for the company, so not a cost of the website.** Listed so nothing is hidden |
| Checking that the site is up | An uptime monitor | **$0 to a few dollars** | Not chosen yet. Free plans exist for a check every few minutes; unverified which one will be used |

### Total at launch

| Line | Per month |
| --- | --- |
| Render, Standard | $25 |
| Supabase, Pro | $25 |
| Resend, Free | $0 |
| Cloudflare, within the free 1,000 GB | $0 |
| Uptime monitor, free plan | $0 |
| **Total** | **$50, about £39** |
| Domain, spread over the year | about £1 |

If lessons are mostly one-to-one and the database stays small, this is the whole bill. If something outgrows its free allowance the likely first one is **email** (to $20 a month) and then **Render** (a larger instance from $85 a month, which would not be needed at this size).

## Payment processing

- **At launch: £0.** Parents transfer the amount into the company bank account. An administrator records each payment in the billing screens, and the system works out what each family owes. There is no card handling and no fee. Whether the bank charges for receiving transfers is for the company's bank to say.
- **Later, if parents pay by card on the website (not part of launch).** Stripe's UK rate is **1.5% plus 20p** for an ordinary UK consumer card and **1.9% plus 20p** for business and American Express cards (Stripe's UK pricing page), with no monthly fee. Example: a £120 monthly bill costs about £2.00 to collect. Stripe would be a new supplier receiving parents' payment details, so it needs the privacy page and the supplier agreements updated first.

## Costs that depend on a decision not yet made

| Item | Cost | Why it is not in the total |
| --- | --- | --- |
| **Recording lessons** | **Not known** | The recording system is not built, and nobody has chosen where recordings are stored. They would be kept for 30 days, so the cost is video storage for about a month of lessons plus the impact assessment. It cannot be priced until it is designed; it will come back to Tahasin for approval separately |
| **Point-in-time database recovery** (restore to any minute rather than last night) | Extra monthly cost, **unverified** | Daily backups are included. This is a choice for the owners (checklist 0.6) |
| **Solicitor's review** of the terms and privacy pages | The solicitor's fee | The owners' own arrangement, planned after launch |
| **Accountant** | The accountant's fee | Not appointed yet |
| **DBS checks** | £0 to the company | Tutors pay for their own for now; the company may reimburse later, which would be a cost per tutor |
| **Safeguarding training, tutor pay** | Not website costs | Tutors are paid from the business account on the 15th of each month; this is lessons delivered times the tutor's rate, not a running cost of the site |
| **Time** | Not priced | Brian's and Alvi's work building and maintaining the site is not counted |

## What would change the bill

| If | Then |
| --- | --- |
| Families grow from 40 to about 200 | Email probably moves to the $20 plan; Cloudflare stays inside 1,000 GB unless classes are large; Render may need a bigger instance |
| Classes of 10 students become common | Video becomes the first line to watch: 35 GB an hour means about 28 such hours a month fit in the free allowance, and each extra hour is about $1.75 |
| Parents pay by card on the site | Card fees of about 1.5% plus 20p on each payment, plus the supplier and privacy work |
| Recordings are switched on | A new storage cost, to be priced when it is designed |

## For Tahasin to confirm

- [ ] I approve a running cost of about **$50 a month (about £39)** plus about £12 a year for the domain, as set out above.
- [ ] I understand parents pay by **bank transfer** at launch and there is **no card processing fee**.
- [ ] Recording, point-in-time recovery, the solicitor and the accountant are **separate costs** that will come to me for approval before they are started.
- [ ] Which company card or billing email each account uses (Render, Supabase, Resend, Cloudflare, IONOS): ______________________

Name: ______________________   Date: ______________________

## Sources

Prices checked on 14 November 2026. Where a third-party page was the only one reached, it is marked "unverified" in the text and should be checked on the supplier's own page before relying on it.

- Render: [render.com/pricing](https://render.com/pricing), [compute plans](https://render.com/docs/compute-plans), [new workspace plans](https://render.com/docs/new-workspace-plans)
- Supabase: [supabase.com/pricing](https://supabase.com/pricing.md)
- Resend: [resend.com/pricing](https://resend.com/pricing.md)
- Cloudflare Realtime: [SFU pricing](https://developers.cloudflare.com/realtime/sfu/pricing), [Realtime pricing](https://developers.cloudflare.com/realtime/pricing/)
- Google Workspace UK: [workspace.google.com/pricing](https://workspace.google.com/intl/en_uk/pricing?region=GB)
- Stripe UK: [stripe.com/gb/pricing](https://stripe.com/gb/pricing?locale=fr)
- IONOS .co.uk renewal: [365i, the real cost of cheap UK domains](https://www.365i.co.uk/news/2025/10/15/the-real-cost-of-cheap-uk-domains/) (third party)
