# Deployment readiness — public site

Pass/fail checklist for shipping the **public marketing site and its enquiry form** to production before Supabase (plan 15 Wave 12). How to deploy is in [DEPLOYMENT.md](DEPLOYMENT.md). Status as of 2 October 2026, against a local production build (`next build` + `next start`).

Legend: **PASS** verified, with the evidence named · **OWNER** blocked on something only the owner can supply or decide · **NOT RUN** not done, with the reason · **EXCEPTION** a known issue, accepted and recorded.

## 16.1 Production boot

| Requirement | Status | Evidence |
| --- | --- | --- |
| `next build` then `next start` with `NODE_ENV=production`; every public route 200 | **PASS** | `npm run test:prod-smoke`: 17 routes, each 200 with an `<h1>`. |
| No console errors, no hydration/CSP violations on any public route | **PASS** | The same tests fail on any `console.error`, uncaught exception or `securitypolicyviolation` event. |
| Nothing in production needs `apps/web/server.ts` | **PASS** | The smoke suite runs against `next start`; `server.ts` is the development wrapper only (DEPLOYMENT.md). |
| Runs with only the production environment variables | **PASS** locally, re-checked by CI | CI builds and starts with no `.env` and no email credentials. (A local `apps/web/.env` is read by `next start`; its contents were not inspected.) |
| Portal (login, dashboard, classroom, auth API) disabled in production through one flag, branded page, header/footer reflect it | **PASS** | `proxy.ts`, `lib/portal.ts`; smoke tests: `/login`, `/dashboard`, `/dashboard/lessons`, `/403` land on "Portal opening soon" (noindex); `/api/auth/*` 404; no Login link and no `/api/auth/` request from the header. Dev/test behaviour unchanged (full e2e suite). |
| Dev-only surfaces unreachable in production | **PASS** | `/dev/motion`, `/dev/classroom`, `POST /api/dev/reset` are 404 (smoke). The motion debug overlay renders nothing in production. Dev-account hints live on `/login`, which is closed. Storybook is not part of the build. |

## 16.2 Security headers and hardening

| Requirement | Status | Evidence |
| --- | --- | --- |
| Content-Security-Policy, compatible with Next's inline scripts, the theme script, JSON-LD, framer-motion, WebGL, `next/font` | **PASS** (enforced) | `src/lib/securityHeaders.ts`; zero violations across all 17 routes in Chromium (smoke); `tests/securityHeaders.test.mjs`. Allows `'unsafe-inline'` scripts/styles (documented trade-off, DEPLOYMENT.md); no `eval`, no third-party origin. Use `CSP_REPORT_ONLY=1` for a staging soak. |
| HSTS | **PASS**, `preload` withheld | `max-age=31536000; includeSubDomains`. Adding `preload` is **OWNER** (confirm the domain is permanently HTTPS). |
| Cross-Origin-Opener-Policy; existing headers kept | **PASS** | Smoke + `tests-e2e/security-headers.spec.ts` (camera/microphone `(self)` comment re-checked and kept). |
| Zero third-party requests on public pages | **PASS** | Smoke records every request host on each of the 17 routes: only the site's own origin. Fonts are self-hosted by `next/font`. |
| `npm audit --omit=dev` reviewed | **EXCEPTION** | 9 findings (2 high, 7 moderate), all transitive through `@excalidraw/excalidraw` (`nanoid`, `lodash-es` via mermaid/chevrotain/langium). Excalidraw is used only by the classroom whiteboard, which is unreachable in production while the portal is closed, and none of it is in any marketing route's JavaScript (checked). The offered fix downgrades Excalidraw to 0.17.6 (breaking). Revisit before the portal opens. |
| Lockfile committed; Node engines honoured | **PASS** | `package-lock.json` is tracked; CI pins Node 22.12.0 against `engines`. |

## 16.3 Enquiry endpoint

| Requirement | Status | Evidence |
| --- | --- | --- |
| Honeypot field and minimum-time check, no CAPTCHA | **PASS** | `EnquiryForm.tsx`, `api/enquiry/route.ts`; `tests/enquiry.test.mjs` (8 new cases) and smoke. A third-party CAPTCHA/Turnstile is **OWNER** (decision). |
| Rate limiting that works across instances | **OWNER** | The in-memory limiter stays as the second layer. The first layer is a host firewall rule on `POST /api/enquiry` (DEPLOYMENT.md), which depends on the host the owner chooses. |
| Double-submit protection; idempotent feedback; clear error states | **PASS** | Client in-flight guard plus server duplicate suppression (same enquiry within 60 s answers success once, one email pair); a failed send does not block the retry (unit tests). |
| Fails closed when `RESEND_API_KEY`, `ENQUIRY_EMAIL` or `RESEND_FROM_EMAIL` is missing in production | **PASS** | Unit tests: 503 with the friendly "email us directly" message, no send. |
| Structured logging, no personal data | **PASS** | One JSON line per outcome; a unit test asserts no name, email or message text appears. |
| `.env.example` lists every variable the code reads | **NOT DONE** | Access to `.env*` files is blocked in the environment this was written in; the full, commented table is in DEPLOYMENT.md for pasting. |
| `ALLOWED_ORIGINS` and site URL for production (and www) | **PASS** | Defaults cover `www` and the bare domain; apex redirects to `www`. |
| Deliverability: verified Resend domain, SPF, DKIM, DMARC; a real staging send | **OWNER** / **NOT RUN** | Checklist in DEPLOYMENT.md. No real send was made: there are no staging credentials, and none were used. |

## 16.4 SEO, indexing and metadata

| Requirement | Status | Evidence |
| --- | --- | --- |
| `robots.ts` allows public routes, disallows `/dashboard`, `/api/`, `/dev`, `/login`; noindex headers on app routes | **PASS** | Smoke + `tests/site.test.mjs`; `X-Robots-Tag` on `/login`, `/403`, `/dashboard/**`, `/api/**`. |
| `sitemap.ts` lists every public route | **PASS** | Added `/tuition-terms`, `/complaints`, `/accessibility` (were missing); a unit test fails if a `(public)` page folder is missing; smoke checks all 17. |
| Canonical host and www redirect; `metadataBase` | **PASS** | Bare domain → `www` 308 with path and query kept (verified with a Host-header request); canonical `<link>` correct on all 17 routes (smoke); `metadataBase` is `siteConfig.url`. |
| Every page's title/description/canonical/OG verified | **PARTIAL** | Canonical verified on every route; per-page OG cards exist for every route (Wave 10); titles and descriptions were not re-read one by one in this pass. |
| Favicons and manifest; `security.txt` | **PASS** / **OWNER** | Icon set, manifest and `/.well-known/security.txt` served (smoke). The security contact currently reuses the public `info@` address: confirm or replace (**OWNER**). |

## 16.5 Performance and Core Web Vitals

| Requirement | Status | Evidence |
| --- | --- | --- |
| Marketing routes do not load app/classroom/Excalidraw/FullCalendar code | **PASS** | Scanned all JavaScript fetched by 8 marketing routes: no Excalidraw, FullCalendar, Socket.IO or auth-provider code (the word "Whiteboard" there is a label inside the product-story mock-up). |
| Fonts: swap, only needed weights | **PASS** | `next/font` with `display: "swap"`, weights 600/700/800, 400–700 and 400/500, latin only. Variable-axis payload (opsz/wdth) was not measured. |
| Image pipeline applied | **PASS** | Wave 8 (see the audit). |
| Production Lighthouse (mobile and desktop) per route, with budgets | **NOT RUN** | Lighthouse is not installed here and installing it is a download that was not authorised. Motion profiles (`npm run profile:motion`) were measured instead — see the completion report. Run Lighthouse on staging. |
| INP checked by interacting (menu, accordion, form, palette, theme toggle) | **NOT RUN** | The interactions are exercised by the e2e suites; INP itself was not measured. |
| Firefox and WebKit Playwright projects | **PASS** (configured) / **NOT RUN** locally | `playwright.prod.config.ts` adds Firefox, WebKit and an iPhone profile with `PW_CROSS_BROWSER=1`; CI installs and runs them. The browsers are not installed on the author's machine, so they have not been run. |
| Safari/iOS behaviour of Lenis, View Transitions, WebGL, `backdrop-filter`, `animation-timeline` | **NOT RUN** | No Safari/iOS device or engine was available. Each enhancement is feature-gated and degrades to the static or native behaviour (Lenis is fine-pointer only). Do a manual pass on an iPhone and a Mac before launch. |

## 16.6 Reliability and operations

| Requirement | Status | Evidence |
| --- | --- | --- |
| `/api/health` | **PASS** | `{"status":"ok"}`, `Cache-Control: no-store`, no secrets (smoke). |
| Global error boundaries | **PASS** | `error.tsx` and `global-error.tsx` (Wave 10); branded 404. |
| Optional error-reporting hook behind env | **OWNER** | Not added: no vendor without the owner's decision. |
| CI workflow | **PASS** (written) / **NOT RUN** on GitHub | `.github/workflows/ci.yml`; its commands are the ones run locally. It has not yet executed on GitHub. |
| `docs/DEPLOYMENT.md`: hosting, realtime not deployed, rollback, smoke checklist | **PASS** | Written. The hosting target itself is **OWNER**. |

## 16.7 Privacy, legal and accessibility

| Requirement | Status | Evidence |
| --- | --- | --- |
| Cookie/privacy pages factually describe what the site stores | **PASS** pending review | The Cookie notice now describes `lt-theme` (local storage, only on an explicit Light/Dark choice) and the search "recent" list (session storage). The wording is **OWNER / legal review** (see `apps/web/LEGAL_REVIEW.md`); the page's reviewed-on date was not changed. |
| No non-essential cookies or analytics | **PASS** | No cookies are set; no analytics. Analytics yes/no is an owner decision. |
| Accessibility suite: axe, keyboard, 200% zoom, 360 px reflow, reduced motion, both themes | **PARTIAL** | axe (WCAG 2 A/AA), keyboard and zoom suites pass on every public route in light; 360 px reflow checked by the smoke suite; dark-theme contrast scanned on every public and app route (no sub-AA text). A dark-theme axe run is in `tests-e2e/accessibility-dark.spec.ts`. No screen-reader pass by a human has been done. |
| `docs/PRODUCTION_GAPS.md` matches reality | **PASS** | Corrected in this pass. |

## 16.8 Repo hygiene

| Item | Status |
| --- | --- |
| Scratch scripts, `artifacts/`, `assets-src/` ignored; no large originals committed | **PASS** |
| `plan14.md` and `plan15.md` are untracked and not in `.gitignore` | **OWNER** — ignore them, or move plans into `docs/plans/`? |

## Verdict

The public site is **ready to deploy to a staging environment now**. It is **not yet cleared for production** until the owner-blocked items below are done: host and DNS, a verified Resend domain with a real staging send, the host's firewall rate-limit rule, the cookie-notice sign-off, the `security.txt` contact, and a Lighthouse plus real-Safari pass on staging.
