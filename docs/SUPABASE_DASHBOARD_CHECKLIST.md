# Supabase dashboard checklist (the owner applies these by hand)

Plan20 section 6 and 7. Code and the migrations cannot change dashboard settings, so this is the list of every one the project needs, with the value, where to find it (names follow the dashboard and drift a little between versions), and **what confirms it**:

- **probe** = `npm run supabase:verify` (read only, run it after you apply the settings; the id is the line it prints);
- **local** = the same setting in `supabase/config.toml` is exercised by a real-stack test (`npm run test:realstack`), which proves the *behaviour*; the hosted value must still be set here;
- **dashboard only** = nothing outside the dashboard can see it. Look at it yourself, and tick it.

Project: `learnthrive-prod`, ref `vwsjvdpkgjhwmqmufmrh`, organisation "LearnThrive Tuition" (Pro plan), London (`eu-west-2`), Postgres 17. API `https://vwsjvdpkgjhwmqmufmrh.supabase.co`.

## Decisions (plan20 section 7)

The owner answers these in chat; **where an answer is missing, the safest default below was used, and it is flagged as a default** so nothing is silently decided. Change a row, then change the setting it feeds.

| Decision | Value used | Basis |
| --- | --- | --- |
| Account creation | **Closed until the Library is opened, then open.** Families create their own accounts, so when `LIBRARY_ENABLED` is flipped, switch sign-ups on in the same step. Until then the site's routes are closed and the dashboard switch is off. | **Default** (not yet answered). Open sign-ups at launch is the site's design; closed before launch is the safe state. `supabase:verify -- --expect-signup closed` until then, `open` after. |
| Staff multi-factor authentication | **Required for every dashboard member** (organisation setting). **For the website's own administrators it is NOT built**: no multi-factor sign-in exists in the site yet. Until it does: very few administrators, strong unique passwords, and the controlled way to make one (`docs/AUTHENTICATION.md`). | **Default**, and a gap to close. |
| Session length and inactivity | JWT expiry 3600 s; time-box sessions to **30 days**; inactivity timeout **7 days** (Pro plan features). The site's own session cookies end when the browser closes. | **Default** (the figures plan19 suggested). |
| Sender for authentication emails | Custom SMTP through **Resend**, from a LearnThrive address on a domain you verify with SPF and DKIM, for example `accounts@<your domain>`. Use a **separate Resend API key** for Auth (so it can be rotated alone). | **Default**: the address and domain are yours to choose; nothing here can verify them. |
| Social login | **None.** | Plan default. |
| Password rules | **12 characters minimum, no composition rules, leaked-password protection ON.** (Supabase also refuses over 72 bytes; the site refuses first.) | Plan default; matches the site's own rule. |
| Backups and point-in-time recovery | **Daily backups on** (included with Pro). **Point-in-time recovery: recommended on**, a small add-on, because it shortens the window of lost work to minutes. | **Default** (a recommendation, not yet answered); note the retention days on the privacy page (`apps/web/LEGAL_REVIEW.md`). |
| Spend cap | **On** (the Pro plan's default): usage beyond the included quotas is blocked, not billed. Turn it off only deliberately. | **Default**. |
| Data API | Kept **on, `public` only**, as plan20 states. **Consider turning it OFF**: the site never uses PostgREST (its server talks to Postgres through the pooler and to Auth and Storage by their own APIs), so switching it off removes the whole surface the browser keys could reach. The probes still pass (every table then answers 404). | **Recommendation**, owner's call. |

## Authentication

| Setting | Value | Dashboard path | Confirmed by |
| --- | --- | --- | --- |
| Allow new users to sign up | Off now; **on at launch** (see Decisions) | Authentication, Sign In / Providers, User Signups | probe `signup` (use `--expect-signup`) |
| Confirm email | **On** | Authentication, Sign In / Providers, Email | probe `confirm-email`; local: the unconfirmed-sign-in test |
| Allow anonymous sign-ins | **Off** | Authentication, Sign In / Providers | probe `providers`; local test "no anonymous sign-in" |
| Email provider | On; **every other provider off** (Google, Apple, GitHub, phone, and the rest) | Authentication, Sign In / Providers | probe `providers` |
| Allow manual linking | Off | Authentication, Sign In / Providers | dashboard only |
| Secure email change / secure password change | **On** (re-authentication for a password change) | Authentication, Sign In / Providers, Email | local config `secure_password_change`; dashboard only for hosted |
| Minimum password length | **12** | Authentication, Sign In / Providers, Email, Password requirements | local: password test (12 accepted, 11 refused) |
| Password requirements (characters) | **None required** | same | local: lower-case-only 12-character password accepted |
| Prevent use of leaked passwords | **On** (Pro) | Authentication, Attack Protection | dashboard only; **cannot be tested locally** |
| CAPTCHA | **Off**: its providers load third-party scripts the Content Security Policy forbids; the site has its own server-side check | Authentication, Attack Protection | dashboard only |
| JWT expiry | **3600** s | Project Settings, JWT Keys / Authentication, Sessions | local config `jwt_expiry` |
| Refresh token rotation | **On**, reuse interval **10** s | Authentication, Sessions | local test: a token several generations old is refused |
| Time-box user sessions / inactivity timeout | **30 days / 7 days** (Pro) | Authentication, Sessions | dashboard only |
| Rate limits | At or below the defaults; email sent per hour as low as the site needs (needs custom SMTP) | Authentication, Rate Limits | dashboard only |
| Custom SMTP | **On**, Resend, from your verified domain | Authentication, Emails, SMTP Settings | dashboard only; send a real test message |
| Email templates, **Confirm signup** and **Reset password** | Use `supabase/templates/confirmation.html` and `recovery.html`: the link is `{{ .SiteURL }}/account/confirm?token_hash={{ .TokenHash }}&type=signup` (and `type=recovery`), **not** Supabase's own `{{ .ConfirmationURL }}`. The site's confirm page spends the token with a button press, so a mail scanner opening the link cannot use it up | Authentication, Emails, Templates | local test reads the real email and checks the link; **smoke step 3 checks it on the hosted project** |
| **Site URL** | **`https://www.learnthrivetuition.co.uk`**. The templates build their links from it, so a wrong value breaks every email | Authentication, URL Configuration | **smoke step 3** (the link host is shown); dashboard only otherwise |
| Redirect URLs | Exactly `https://www.learnthrivetuition.co.uk/account/confirm` and `/account/reset`. **No wildcard** in production (an open-redirect risk). Staging hosts only on a staging project | Authentication, URL Configuration | dashboard only |
| Multi-factor (TOTP / phone) | Not used by the site; leave off | Authentication, Multi-Factor | dashboard only |

## Data API

| Setting | Value | Dashboard path | Confirmed by |
| --- | --- | --- | --- |
| Exposed schemas | **`public` only.** `private`, `auth`, `storage`, `graphql_public` must never be listed | Project Settings, Data API, Exposed schemas | probe `schemas`, `openapi`; local tests |
| GraphQL | **Off** | Project Settings, Data API (and the `pg_graphql` extension) | probe `graphql` (`--expect-graphql`) |
| Extra search path | Default (`public, extensions`) | Project Settings, Data API | dashboard only |
| Max rows | 1000 | Project Settings, Data API | dashboard only |
| Data API enabled | On with `public` only; consider **off** (see Decisions) | Project Settings, Data API | probe `anon-tables` either way |
| Anonymous access to tables | **None** except the published catalogue, which holds no file path | (set by migrations `0005`) | probe `anon-tables`, `no-paths`, `anon-file-paths`, `anon-write`; local: the full row level security suite |

## Storage

| Setting | Value | Dashboard path | Confirmed by |
| --- | --- | --- | --- |
| Buckets `library` and `chat-uploads` | **Private** (Public bucket off). Created by migration `0007`, with the limits: library PDF only, 25 MB; chat-uploads JPEG, PNG or PDF, 15 MB | Storage, Buckets | probe `storage`; local: bucket, MIME and size tests |
| Storage policies for `anon` or `authenticated` | **None.** Do not add one in the dashboard: the real-stack test fails if one appears | Storage, Policies | local test "no storage policy exists for any role" |
| Public URLs | Never used | n/a | probe `storage` |
| S3 protocol | Off | Storage, S3 Connection | dashboard only |
| Global upload size limit | At least 25 MB (so the bucket limit decides) | Project Settings, Storage | dashboard only |

## Database

| Setting | Value | Dashboard path | Confirmed by |
| --- | --- | --- | --- |
| The site's connection | The **transaction pooler**, port **6543**, as **`learnthrive_server.<project ref>`**, never `postgres` | Connect (pooler, transaction mode) | `npm run check:env -- --env production` (it refuses `postgres`, a direct connection and a local address) |
| The narrow role | Created with `scripts/create-server-role.mjs`; password from the owner, in one shell session. Re-run after a migration adds a table | n/a | `supabase db push`, then the role script, then the smoke test |
| Postgres password (`postgres`) | Long, random, kept only by the owner; **not** in Render | Project Settings, Database | dashboard only |
| SSL enforcement | **On** | Project Settings, Database, SSL Configuration | dashboard only |
| Network restrictions | Restrict direct access to Render's outbound addresses if the plan allows | Project Settings, Database, Network Restrictions | dashboard only |
| Backups | **Daily on**; point-in-time recovery per the decision | Database, Backups | dashboard only |
| Advisors | **Zero security warnings** after the push; resolve each in a new migration | Database, Advisors (Security, Performance) | dashboard or CLI; record the result |
| Extensions | Only what the migrations need | Database, Extensions | dashboard only |

## API keys

| Setting | Value | Dashboard path | Confirmed by |
| --- | --- | --- | --- |
| Keys the site uses | A **publishable** key (`sb_publishable_...`) as `SUPABASE_ANON_KEY` and a **secret** key (`sb_secret_...`) as `SUPABASE_SERVICE_ROLE_KEY`, in Render's environment only | Project Settings, API Keys | `npm run check:env -- --env production` (it rejects the wrong kind in each slot); the smoke test |
| Legacy `anon` and `service_role` keys | Keep until the new keys are proven in production, then **disable them** | Project Settings, API Keys, Legacy | dashboard only |
| Where the secret key lives | **Only** Render's environment and one shell session for the smoke test. Never the repository, a log, a document or a report; a test checks the built site has no trace of it | n/a | `npm run check:bundle` |

## Billing, spend cap and the organisation

| Setting | Value | Dashboard path | Confirmed by |
| --- | --- | --- | --- |
| Spend cap | **On** | Organisation, Billing | dashboard only |
| Members | **Named accounts only, no shared logins**; remove people who leave the same day | Organisation, Team | dashboard only |
| Multi-factor for members | **Required** (Pro) | Organisation, Security | dashboard only |
| Data processing agreement | Accepted and filed | Organisation, Legal documents | dashboard only (`apps/web/LEGAL_REVIEW.md`) |
| Billing alerts and usage notifications | On | Organisation, Billing | dashboard only |

## After you apply them

1. `npm run supabase:verify` with the project URL and the **publishable** key (read only). It must show no FAIL. Notes are explained in its output.
2. The smoke test (`docs/SUPABASE_REAL_STACK.md`, "The hosted project") proves the email link and the Site URL end to end.
3. Tick this list in the repository's issue or in your own notes; the dashboard keeps no history of who changed what here.

**Not verifiable from outside the dashboard**: the leaked-password check, session time-box and inactivity, rate limits, the email sender and its SPF and DKIM, MFA, backups, the spend cap, SSL enforcement and network restrictions. These rely on you.
