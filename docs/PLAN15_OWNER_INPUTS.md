# Plan 15 — what only the owner can supply or decide

Kept current as plan 15 progresses. Status: **open** (needed), **blocked-by-owner** (work is built
around the gap), **decided**.

| # | Item | Why it matters | Status |
| --- | --- | --- | --- |
| 1 | **Original founder photos**, minimum 1200×1200 (or 1200×1500 portrait), well lit, face centred with headroom. Replace `apps/web/public/images/abdurrahman-mustafa.jpg` and `tahasin-hasan.jpg` (currently 320×320). | The founder portraits are now undistorted and uncropped, but a 320 px file is ~1.25× upscaled on a 2× screen and cannot carry a larger, editorial founder section. The premium section (plan15 §5.1f) is built once these exist. | open |
| 2 | **Higher-quality, owner-approved photography or illustration.** Weakest current images: the four `subject-*.jpg` photos (generic classroom stock; three are 2-6 MB originals cropped into 668×132 strips on the home page, and `subject-elevenplus.jpg` is a *portrait* photo shown as a landscape strip) and the hero photo, which reads as stock. Code cannot make stock feel authentic. | Imagery craft is the lowest-scoring bar criterion in the audit. | open |
| 3 | Production domain(s) (and `www`), hosting account, DNS access, the Resend sending domain and from-address, `ENQUIRY_EMAIL`, the production environment variables. | Needed for `metadataBase`, canonical host, `ALLOWED_ORIGINS`, email deliverability (SPF/DKIM/DMARC), the first real deploy. | open |
| 4 | Confirmation the domain is permanently HTTPS. | Required before HSTS `preload`. | open |
| 5 | `security.txt` contact address. | `/.well-known/security.txt` needs a real monitored address. | open |
| 6 | Any real accreditations, DBS/vetting statements, awards, press or school partners the owner is happy to publish, **with evidence**. | The trust hub stays factual and minimal without them. Nothing is invented. | open |
| 7 | Legal review of the cookie/privacy wording describing browser storage (theme and motion preference, if/when stored). | The code may add factual storage text for approval only; it does not edit legal wording. | open |
| 8 | Decisions: CAPTCHA/Turnstile vs honeypot + time-trap only; analytics yes/no and which; error-reporting vendor yes/no. | Each has privacy/cookie implications; plan 15 defaults to honeypot only, no analytics, no vendor. | open |
| 9 | Decision: what `/login` and the portal look like in production before Supabase. | Default: a branded "Portal opening soon" page, noindex. | open |
| 10 | Decision: ignore or relocate `plan14.md` and `plan15.md` (earlier plans are gitignored; these two are untracked and not ignored). | Repo hygiene; not decided unilaterally. | open |
| 11 | Hands-on feel test of smooth scrolling and the hero sequence on your own machine: mouse wheel and precision touchpad, ideally at your display's real refresh rate (the machine reports 165 Hz), plus Safari/iOS if available. | An automated browser cannot judge scroll feel. Wave 4 ships Lenis behind a flag and says so if it fails. | open |
| 12 | Decision on the home-page stats strip's 3 px left divider (`home.module.css` `.statFirst` / `.statOther`), which a design linter flags as an overused "side-tab" accent: restyle it, or add a narrow ignore. | Pre-existing; unchanged until you choose. | open |
