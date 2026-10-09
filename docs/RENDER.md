# Deploying the public site on Render

How to put `apps/web` (the public site, including the careers section, the safeguarding reconfirmation page and the subject-request form) on Render. It adds to [DEPLOYMENT.md](DEPLOYMENT.md), which stays the general guide; this page is the Render-specific part, and the checks that the careers work needs. Nothing here has been deployed: the code is ready, and this is what has to be done and tested on the real service.

## The service

| Setting | Value |
| --- | --- |
| Type | Web Service (Node) |
| Root directory | the repository root (it is an npm workspace) |
| Build command | `npm ci && npm run build --workspace=apps/web` |
| Start command | `NODE_ENV=production npm run start --workspace=apps/web` (Render sets `PORT`; `next start` reads it) |
| Health check path | `/api/health` |
| Node | 22 (`^22.13`), or any version in the `engines` field |
| Instance | **A paid instance.** Free instances spin down after about fifteen minutes without traffic and answer the next request slowly. A visitor who has spent ten minutes on the application form must not meet a cold start when they press send. |

The build needs outbound network access once, for the fonts `next/font` downloads at build time.

## Environment variables

Set these in the Render dashboard. **Never commit values.** (`apps/web/.env.example` is the in-repo list; if it is missing a variable here, add it there too.)

| Variable | Needed? | What it does |
| --- | --- | --- |
| `RESEND_API_KEY` | **Yes.** Without it the careers application, the reconfirmation and the subject request answer with a friendly "email us" message and send nothing. | Resend API key. |
| `RESEND_FROM_EMAIL` | **Yes** in production (the shared `onboarding@resend.dev` sender is never used in production). | A sender on the domain you verified in Resend. |
| `ENQUIRY_EMAIL` | **Yes** (the enquiry route fails closed without it). | Where enquiries go. Also the fallback destination for the other forms. |
| `CAREERS_EMAIL` | No. Falls back to `ENQUIRY_EMAIL`, then to `info@learnthrivetuition.co.uk`. | Where applications and reconfirmations go. Set it when a careers address exists; no code change is needed. |
| `SUBJECT_REQUEST_EMAIL` | No. Falls back to `ENQUIRY_EMAIL`, then to the site address. | Where subject requests go. |
| `CAPTCHA_SECRET` | **Yes.** At least 32 characters: use 64 hex characters (`openssl rand -hex 32`). Without a valid one, production refuses to issue the "are you a person" check, so the three forms cannot be sent and offer email instead. | Signs the human-check challenges. Never sent to the browser. Rotating it only invalidates challenges that are in flight. |
| `ALLOWED_ORIGINS` | No. The site's own addresses (www and the bare domain, plus `NEXT_PUBLIC_SITE_URL`) are always allowed. | Extra origins that may post the forms, for a staging host. |
| `NEXT_PUBLIC_SITE_URL` | No. | The public address, if it is not `https://www.learnthrivetuition.co.uk`. Build time. |
| `CLIENT_IP_HEADER` | No, but read the section on addresses below. | Name of a header that carries the visitor's address, once a test shows it is present and cannot be forged. |
| `TRUSTED_PROXY_HOPS` | No (default `1`). | How many proxies of the host sit in front of the service, for reading `X-Forwarded-For` from the right. |
| `CAREERS_OPEN_FOR_TESTING` | **Never set this in production.** | Opens the application forms while the agreement is a draft, in development and tests only. A production build ignores it. |

The site's other variables (the portal flag, the kill switches, the CSP report-only switch) are in [DEPLOYMENT.md](DEPLOYMENT.md).

## Before the application form can go live

The application and the reconfirmation page stay closed, whatever the variables say, until the owner approves the safeguarding agreement in code (`agreementApprovedByOwner` in `src/lib/careers-config.ts`; see [AGREEMENT_RECONFIRMATION.md](AGREEMENT_RECONFIRMATION.md)). Until then the pages show how to apply by email and the routes answer `503`. So the first deploy is safe to make before the wording is approved.

## Test the real upload limit

Render's documentation does not state a maximum request size, and one community report describes a `413` returned before the app. The limits in `careersConfig.limits` (3 MB a file, 12 MB in all, a 12.5 MB request ceiling) are deliberately cautious, but they must be proved on the deployed service:

1. With the gate closed the app answers `503` without reading the body, so a large POST tests only the edge. Send bodies of increasing size and compare:

   ```bash
   for mb in 1 4 8 12 13; do
     head -c "${mb}000000" /dev/zero > /tmp/body.bin
     printf '%s MB -> ' "$mb"
     curl -s -o /dev/null -w '%{http_code}\n' -X POST \
       -H 'Content-Type: multipart/form-data; boundary=x' \
       --data-binary @/tmp/body.bin https://YOUR-SERVICE/api/careers/apply
   done
   ```

   `503` (the app's closed answer) up to 12 MB means the edge lets a full application through. A `413` from Render's proxy below 12 MB means the limit in `careers-config.ts` must come down; lower `totalBytes` and the per-file limits until a full-size request is answered by the app.
2. Once the agreement is approved, send one real full-size application from a browser (a 3 MB CV, a 3 MB cover letter file, supporting documents up to 12 MB in all) to an address you control, and check that every file arrives intact.

## The visitor's address (rate limiting)

The routes limit each visitor and the route as a whole (`careersConfig.rateLimits`). The visitor is identified by address, and Render does not document which header carries it or how many proxies sit in front of a service; community reports disagree, and some say a visitor's own `X-Forwarded-For` is kept and appended to. So the code never trusts the left-hand entry. It reads `X-Forwarded-For` from the right, skipping `TRUSTED_PROXY_HOPS` entries (default 1), or uses `CLIENT_IP_HEADER` if you name one. Test it once on the deployed service. The challenge endpoint allows 40 requests per visitor per 15 minutes, which makes a safe probe:

```bash
# Forged left-hand entries must NOT earn a fresh allowance: expect 200s and then 429s.
for i in $(seq 1 45); do
  curl -s -o /dev/null -w '%{http_code} ' -H "X-Forwarded-For: 198.51.100.$i" https://YOUR-SERVICE/api/careers/challenge
done; echo
```

- Forty `200`s and then `429`s: the visitor is identified correctly. Done.
- Forty-five `200`s: the limit follows the forged value. Try `CLIENT_IP_HEADER=true-client-ip` (or `cf-connecting-ip`) if the host sends one, or raise `TRUSTED_PROXY_HOPS`, and repeat.
- `429` from the first request: every visitor shares one bucket (the address could not be read). Set one of the two settings above.

The counts live in the server's memory: they reset on a restart or deploy and are not shared between instances. That is right for one instance. If the service ever runs several, move the counters (and the used-challenge list in `src/lib/human-check.ts`) to a shared store, or put a rate rule at the edge.

## The human check's difficulty

`careersConfig.humanCheck.difficultyBits` is 17: the browser must find a number that gives a SHA-256 hash with 17 leading zero bits, about 130,000 tries on average, in a Web Worker. Measured on the development machine in Chromium (41 runs each; the time to solve varies a lot, because the number of tries is random):

| CPU | median | 90th percentile |
| --- | --- | --- |
| normal | 0.25 s | 1.3 s |
| slowed 4x | 0.30 s | 1.8 s |
| slowed 6x | 0.42 s | 1.2 s |

(18 bits: median 0.87 s, 0.75 s and 0.83 s, 90th percentile about 2.3 s, so 17 was kept.) The check starts when the page is idle, so it is nearly always finished long before the visitor reaches the send button. A real mid-range phone was not available to measure: the throttled figures are a stand-in. If real phones are slow, lower the number by one; each bit halves the work.

## Email

Resend sends through its own verified sending domain, while the company mailboxes stay with IONOS.

- **Leave the existing IONOS mail records untouched** when adding Resend's. A domain may have only ONE SPF record, so merge Resend's `include:` into the existing SPF text rather than adding a second record, and use the exact values each provider shows. Add Resend's DKIM records as given. Add a DMARC record starting in monitoring mode (`p=none` with a report address), and tighten it later.
- After deploying, send **a test application, a test reconfirmation and a test subject request end to end** to an address you control (see "Before the form can go live" for the application), and check that both emails of each arrive, are not in spam, and read well in a webmail client and on a phone. The applicant's confirmation must not carry attachments or a copy of the answers.
- The destination is the main `info@` mailbox for now. Applications with attachments add up (identity scans especially): decide a mailbox size, a filter or folder for careers and subject-request messages, and a deletion routine ([RETENTION_AND_DELETION.md](RETENTION_AND_DELETION.md)). The emails that hold the signed agreement records and the yearly reconfirmations are evidence: keep them for the agreed period and do not delete them early.

## After every deploy

`npm run build && NODE_ENV=production npx next start -p 3200` then `npm run test:prod-smoke` against it (and against the live address with `PROD_BASE_URL`). Then look at the live site itself rather than assuming: response headers, that no cookie is set and nothing is written to browser storage by the careers pages, that no request leaves the site's own origin, the sitemap and robots files, social previews, and a pass through the careers pages on a phone and a desktop. Record the result in `LEGAL_REVIEW.md` ("What was checked after deployment").
