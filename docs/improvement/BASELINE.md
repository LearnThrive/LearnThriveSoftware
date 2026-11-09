# Baseline: the repo before the overhaul

Measured on 9 November 2026 on branch `improve/fable-overhaul` at commit `59b3a1d` (`main` at `dbae792` plus one docs commit). Windows 11, Node v26.10.0, npm 11.13.0. Each command was run once, in this order, from the repo root, on a machine doing nothing else. Nothing failed at baseline.

| Check | Command | Result | Time |
| --- | --- | --- | --- |
| Install | `npm install --no-audit --no-fund` | exit 0 | 9 s |
| Lint | `npm run lint` | exit 0: **0 errors, 9 warnings** (unused variables in tests and scripts) | 53 s |
| Typecheck | `npm run typecheck` | exit 0 (all four workspaces) | 24 s |
| Unit and contract tests | `npm test` | exit 0 (table below) | 119 s |
| Production build | `npm run build` | exit 0 (classroom, realtime typecheck, web) | 82 s |
| Dependency audit | `npm audit --omit=dev` | exit 1: **12 findings (2 low, 1 moderate, 9 high), 0 critical**, all in the Excalidraw chain (katex, lodash-es, nanoid, mermaid) | 4 s |
| Accessibility suites | `npx playwright test tests-e2e/accessibility.spec.ts tests-e2e/accessibility-dark.spec.ts tests-e2e/accessibility-zoom-keyboard.spec.ts` (in `apps/web`) | exit 0: **99 passed** (axe WCAG 2 A/AA in light and dark, keyboard-only, 200% zoom) | 191 s |

## Tests by workspace

| Workspace | Runner | Tests | Passed | Failed | Skipped |
| --- | --- | --- | --- | --- | --- |
| `apps/web` | `node --test tests/*.test.mjs` (108 files) | 1087 | 1087 | 0 | 0 |
| `packages/data` | `tsx --test src/*.test.ts` | 429 | 428 | 0 | 1 |
| `apps/realtime` | vitest (4 files) | 93 | 93 | 0 | 0 |
| `apps/classroom` | vitest (5 files) | 40 | 40 | 0 | 0 |
| **Total** | | **1649** | **1648** | **0** | **1** |

## Size

| Measure | Value | How |
| --- | --- | --- |
| Browser JavaScript, whole app | 11,257,646 bytes in 252 files; **3,688,989 bytes gzipped** | every `.js` under `apps/web/.next/static` after the build, gzip level 6 |
| Largest single chunk | 1,819,556 bytes | same |
| CSS, whole app | 555,428 bytes in 11 files; 97,950 gzipped | same |
| Database migrations | 21 (`0001`–`0021`) | `supabase/migrations` |
| End-to-end specs | 65 files in `apps/web/tests-e2e` | `git ls-files` |
| Source files over 500 lines | 15 (largest 1,246) | `apps/web/src` and `packages/data/src`, tests and generated files excluded |

These totals are the whole application, not what one page downloads.

## Not run at baseline, and why

| Check | Why not |
| --- | --- |
| Full end-to-end suite (`npm run test:e2e`, about 45 to 70 minutes) | Too slow to run before and after each item; CI runs it on `main`. The three accessibility specs from it were run |
| Real Supabase stack (`npm run test:realstack`, `test:e2e:realstack`) | Docker is not running on this machine (`docker ps` cannot reach the engine). The same contracts run on PGlite inside `npm test` |
| Production smoke suite (`test:prod-smoke`) | Needs a served production build; CI runs it on every pull request |
| Lighthouse | Not run. No per-page performance number is claimed anywhere in these documents |
| Manual screen-reader pass, real iPhone and Safari, real classroom devices | Need a person and devices |
| Anything against the hosted Supabase project, Render, Resend, Cloudflare or Stripe | Out of bounds for this work |
