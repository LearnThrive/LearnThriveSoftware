# Information architecture

Plan6 section 103. How the product is organised: the four route groups, what chrome each one
gets, the full route tree, per-role navigation, and the classroom's own entry/exit flow.

## Route groups

Next.js App Router route groups (`(name)`) — organisational only, they never appear in the URL.
Four of them, one per distinct "surface" the product has, each owning its own chrome so a child
layout is never stuck trying to *remove* a parent's (a layout can only ever add to what it
inherits — this is why `(classroom)` is its own group rather than nested under `(app)`, even
though its route path is `/dashboard/lessons/[id]/classroom`):

| Group | Chrome | Session read | Static? |
|---|---|---|---|
| `(public)` | `PublicShell` — marketing header/footer | Never (client-side `/api/auth/session` fetch only, to swap the header's Login link for a Dashboard one) | Yes — every marketing page stays `○` (prerendered) |
| `(app)` | `AppShell` — sidebar, topbar, account menu | Server-side, via `requireSession()`/`requireRole()` | No — `ƒ`, genuinely per-session |
| `(auth)` | Its own two-panel layout (brand side + form side) | Reads it once to redirect an already-authenticated visitor straight to `/dashboard` | No |
| `(classroom)` | None — the classroom is full-bleed, no AppShell/PublicShell around it | Indirectly, via the join-token flow (`docs/CLASSROOM_INTEGRATION.md`) | No |

`app/layout.tsx` (the real root, outside every group) is deliberately just the document shell —
fonts, global stylesheets, structured data. It used to also render the marketing header, which is
exactly what made every dashboard page render the public navbar above its own chrome; splitting
shells by route group is what fixed that (see the `git log` for that specific regression).

### Why `PublicShell` never reads the session server-side

An early version did — and it turned every marketing page from `○` (static) to `ƒ` (dynamic),
because reading `getSession()` in a layout makes Next.js treat the whole subtree as
request-dependent. Marketing pages must stay statically generated for SEO/performance
(`tests-e2e/single-server.spec.ts`'s companion, `tests/site.test.mjs`, checks this). Instead,
`/api/auth/session` (a tiny route returning `{signedIn, name, role}`, `cache-control: no-store`)
is fetched client-side from `SiteHeader`, which swaps its own Login link for a Dashboard one once
that resolves — the page itself never depends on the request.

## Route tree

```text
/                                          marketing home
/about  /book  /contact  /cookies  /faq
/privacy  /safeguarding  /subjects  /terms
/11-plus-tuition  /english-tuition
/maths-tuition  /science-tuition           subject landing pages

/login                                     (auth) — two-panel sign-in, no role picker

/dashboard                                 role-appropriate home (Admin/Tutor/Client/Student)
/dashboard/calendar                        FullCalendar, role-scoped visibility
/dashboard/lessons                         filterable lesson list (Upcoming/Needs attention/…)
/dashboard/lessons/[id]                    lesson detail — attendance, report, activity
/dashboard/lessons/[id]/classroom          (classroom) — full-bleed, no shell (see below)
/dashboard/reports                         "Lesson reports" (Admin/Tutor/Client) / "Your feedback" (Student)
/dashboard/notifications
/dashboard/activity                        Admin — platform-wide activity feed
/dashboard/settings                        account + dev-only reset control

/dashboard/admin                           redirects to /dashboard (Admin's Overview *is* its home)
/dashboard/admin/people                    redirects to /dashboard/admin/people/students
/dashboard/admin/people/students           ┐
/dashboard/admin/people/clients            ├ three tabbed lists (PeopleTabs), one route each
/dashboard/admin/people/tutors             ┘
/dashboard/admin/students/[id]             profile pages (Admin-only)
/dashboard/admin/clients/[id]
/dashboard/admin/tutors/[id]
/dashboard/admin/assignments               Tuition Assignments list + create
/dashboard/admin/assignments/[id]
/dashboard/admin/lessons/new               schedule a lesson

/dashboard/students                        Tutor's own students (no [id] profile — Tutor has no
                                            per-student page, only the admin profile exists)
/dashboard/children                        Client's own children
/dashboard/tutor/availability              Tutor's own recurring availability

/403                                       (app) — access denied, not a silent blank page
/dashboard/not-found · /dashboard/loading  App Router conventions, scoped to (app)
```

`/dashboard/admin` and `/dashboard/admin/people` are both intentionally blind redirects with no
role check of their own — the destination each points at (`/dashboard`, `/dashboard/admin/people/
students`) carries its own `requireRole(["ADMIN"])`, so nothing is actually reachable without it;
see `tests-e2e/auth.spec.ts`'s comment on this for why its own role-gating tests point at a route
that still enforces something, not at these two.

## Per-role navigation

`lib/navigation/appNavigation.ts` is the single source of truth — the sidebar is *built from* it,
not maintained separately, so a role never sees a link to something it can't use (section 17).

| | Admin | Tutor | Client | Student |
|---|---|---|---|---|
| Home | Overview | Overview | Home | Home |
| Calendar | ✓ | ✓ | ✓ | ✓ |
| Lessons | ✓ | ✓ | — | ✓ |
| People | Students / Clients / Tutors (3 links) | Students (own only) | Children | — |
| Assignments | ✓ | — | — | — |
| Reports | ✓ | ✓ | Lesson reports | Feedback |
| Availability | — | ✓ (own) | — | — |
| Notifications | ✓ | ✓ | ✓ | ✓ |
| Activity | ✓ (platform-wide) | — | — | — |
| Settings | ✓ | ✓ | ✓ | ✓ |

`tests-e2e/navigation.spec.ts` drives one full journey per role using only real clicks (nav
links, row links, back links — never a typed URL mid-journey, section 91) and separately asserts
each role's nav contains exactly its own set and none of another role's Admin/Tutor-only items.

## The classroom's entry and exit flow

The one place a page deliberately has no shell around it. Entry: a lesson's detail page shows a
high-priority "Join classroom" CTA once the join window opens (section 59), or "Classroom opens
in 12 minutes" rather than merely hiding the button while it hasn't yet — the same peek panel on
the calendar (`LessonPeekPanel`, section 56) mirrors this. Clicking it runs
`joinClassroomAction` (see `docs/CLASSROOM_INTEGRATION.md`), which redirects into the
`(classroom)` route on success.

Exit is copy-only, not a second code path (there's only one Tutor, so their departure always ends
the class) — `LeaveConfirm`'s `isTutor` prop changes the confirmation and the resulting screen's
wording:

- **Tutor**: "Class ended" → returns to the Lesson with `?postClass=1`, which surfaces a prompt to
  mark attendance and write the report right there (section 62) — never a disconnected classroom
  landing page with nowhere to go.
- **Student**: "Class ended" → a "Return to Lesson" link, back to that same Lesson's detail page.

## Marketing site (`(public)`)

Unchanged in structure from before plan6 — see `docs/ARCHITECTURE.md`'s Phase A section for how
it was migrated. The one plan6-relevant change is `PublicShell`/`SiteHeader` becoming
session-aware (section 78: swapping Login for Dashboard once signed in) without becoming
server-dynamic, described above.
