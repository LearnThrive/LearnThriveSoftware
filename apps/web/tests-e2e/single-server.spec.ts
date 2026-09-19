import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Plan6.md section 89's "one-dev-server regression test" and section 90's "stale URL regression
// test": proves the single-origin architecture (custom apps/web/server.ts hosting Next.js +
// Socket.IO together — see docs/ARCHITECTURE.md) actually holds for a real browser session, not
// just for curl/socket.io-client smoke tests run by hand during development.
//
// This suite runs against whatever origin apps/web/playwright.config.ts's webServer starts
// (baseURL, currently a dedicated test port so it doesn't collide with a developer's own running
// dev server) — the real deployed/dev experience uses localhost:3000 specifically, but the
// property under test (one origin, no cross-port navigation, no stale URLs) is identical either
// way and doesn't depend on which port that one origin happens to be.

async function login(page: Page, email: string, password: string) {
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#login-password').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}

const ADMIN = { email: 'admin@learnthrive.dev', password: 'dev-admin-pass' };
const TUTOR = { email: 'tutor@learnthrive.dev', password: 'dev-tutor-pass' };

/** The calendar's side panel (plan6 section 56) opens on event click rather than navigating
 * straight to the lesson — this drills through to the full detail page. Waits for the URL
 * itself, not just the click event dispatching — see the identical rationale on lessons.spec.ts's
 * copy of this helper. */
async function openLessonFromCalendar(page: Page, eventText: string) {
  await page.locator('.fc-event', { hasText: eventText }).click();
  await Promise.all([
    page.waitForURL(/\/dashboard\/lessons\/[^/]+$/),
    page.getByRole('link', { name: 'View full details' }).click(),
  ]);
}

/** London wall-clock date/time strings for "now + minutesFromNow", for the #lesson-date/
 * #lesson-time fields — computed in Europe/London regardless of the machine's own timezone,
 * matching how the lesson-creation form itself interprets those fields (zonedTimeToUtc). */
function londonDateTimeFieldsIn(minutesFromNow: number): { date: string; time: string } {
  const target = new Date(Date.now() + minutesFromNow * 60_000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(target).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

test('the one-dev-server regression test: Home, Login, Admin dashboard, a Lesson, and the Classroom UI are all reachable at one origin, Socket.IO connects, TURN is reachable, and classroom exit returns to the platform', async ({ page }) => {
  // 1 & 2: public Home and Login reachable at the canonical single origin.
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();

  // 3: Admin dashboard reachable after auth. /dashboard/admin itself is now a blind redirect to
  // /dashboard (plan6 section 50: Admin's Overview *is* /dashboard) — still a real same-origin
  // route to prove reachable, landing on real Admin-role content.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/admin');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.app-usermenu__role')).toContainText('Admin');

  // Create a lesson starting soon enough to be inside the Tutor's join window immediately,
  // so this test can prove the classroom route (not just the disabled-button state already
  // covered elsewhere) actually loads.
  const { date, time } = londonDateTimeFieldsIn(12);
  await page.goto('/dashboard/admin/lessons/new');
  await page.getByLabel('Tuition Assignment').selectOption({ label: 'GCSE Mathematics — Ayaan' });
  await page.locator('#lesson-title').fill('Single-server regression lesson');
  await page.locator('#lesson-date').fill(date);
  await page.locator('#lesson-time').fill(time);
  await page.getByRole('button', { name: 'Schedule lesson' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);

  await page.goto('/dashboard/calendar');
  await openLessonFromCalendar(page, 'Single-server regression lesson');
  await expect(page).toHaveURL(/\/dashboard\/lessons\/(.+)/);
  const lessonUrl = page.url();
  const origin = new URL(lessonUrl).origin;

  // 4: the Lesson itself is reachable.
  await expect(page.locator('#main-content')).toContainText('Single-server regression lesson');

  await login(page, TUTOR.email, TUTOR.password);
  await page.goto(lessonUrl);
  // Join classroom is a real navigational Link styled as a button, not role="button", while it's
  // enabled — its disabled state (outside the join window) *is* an inert span, tested elsewhere.
  const joinButton = page.getByRole('link', { name: 'Join classroom' });
  await expect(joinButton).toBeVisible();

  // Track every frame navigation for the rest of this test — the core one-origin claim.
  const navigatedOrigins = new Set<string>();
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      try { navigatedOrigins.add(new URL(frame.url()).origin); } catch { /* about:blank etc. */ }
    }
  });

  await joinButton.click();

  // 5 & 9: the Classroom UI loads under the *same* origin as the rest of the platform — no
  // navigation to a different port (5173, 3001, or anything else) ever happens.
  await expect(page).toHaveURL(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/dashboard/lessons/.+/classroom`));

  // 6: Socket.IO actually connected and the join completed — a lone Tutor auto-admits into the
  // live call (not the waiting room), proving the token round-trip through Socket.IO worked, not
  // just that the page rendered. A stuck "joining" phase would mean Socket.IO never reached the
  // server.
  await expect(page.getByRole('button', { name: 'End class' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.connection-pill')).toBeVisible();

  // 8: the TURN credentials endpoint is reachable at the same origin (same-origin fetch, no
  // cross-origin request needed) — whatever it returns (configured or the documented "not
  // configured" 503), the point is it answers on THIS origin, not localhost:3001.
  const turnResponse = await page.request.get('/api/turn-credentials');
  expect([200, 503]).toContain(turnResponse.status());

  // 10: ending the class returns to the Lesson, not a disconnected classroom landing page (plan
  // section 62's "Class ended -> Mark attendance -> Write report" for a Tutor).
  await page.getByRole('button', { name: 'End class' }).click();
  await page.getByRole('button', { name: 'Yes, end class' }).click();
  await expect(page.getByRole('link', { name: /Return to Lesson/ })).toBeVisible();
  await page.getByRole('link', { name: /Return to Lesson/ }).click();
  await expect(page).toHaveURL(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/dashboard/lessons/[^/]+$`));
  await expect(page.locator('#main-content')).toContainText('Single-server regression lesson');

  // 9, restated as an assertion: across this entire Lesson -> Join -> Classroom -> back flow, the
  // browser's main frame never navigated to any origin other than the one this test started at.
  for (const seen of navigatedOrigins) expect(seen).toBe(origin);
});

test('stale URL regression: no served page markup or route references the retired standalone classroom origin, TutorCruncher, or a hardcoded tunnel URL', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  const routesToCheck = ['/', '/about', '/login', '/dashboard', '/dashboard/admin', '/dashboard/calendar'];
  for (const route of routesToCheck) {
    // Six full navigations back-to-back occasionally race Next dev's HMR client reconnecting on
    // the *previous* page and issuing its own reload right as this goto() is in flight — observed
    // as a spurious net::ERR_ABORTED (and, once retried, a follow-up "page is navigating" error
    // reading content() while that stray reload is still settling). `next start` (production) has
    // no HMR client, so this is a dev-only artifact of this test's own rapid navigation pattern,
    // not of the markup under test — retrying the whole goto+read is simpler and more honest than
    // a fixed delay that would just be papering over the same dev-server timing either way.
    let html: string | undefined;
    for (let attempt = 0; attempt < 3 && html === undefined; attempt += 1) {
      try {
        await page.goto(route);
        html = await page.content();
      } catch {
        html = undefined;
      }
    }
    if (html === undefined) throw new Error(`Could not load ${route} after retries`);
    expect(html, `${route} markup must not reference the retired standalone classroom origin`).not.toMatch(/localhost:5173|127\.0\.0\.1:5173/);
    expect(html, `${route} markup must not reference TutorCruncher`).not.toMatch(/tutorcruncher\.com/i);
    expect(html, `${route} markup must not reference a hard-coded Cloudflare Quick Tunnel URL`).not.toMatch(/\.trycloudflare\.com/);
  }
});

test('stale URL regression: no source file under apps/web/src references the retired standalone classroom origin or TutorCruncher, outside test/documentation code', async () => {
  const root = join(process.cwd(), 'src');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const source = readFileSync(full, 'utf8');
      // The one legitimate, documented reference: classroom.ts's guard checking whether an
      // operator-configured NEXT_PUBLIC_CLASSROOM_URL is NOT the old default before treating it
      // as a real external override — see docs/CLASSROOM_INTEGRATION.md.
      if (full.endsWith(join('lib', 'actions', 'classroom.ts'))) continue;
      if (/localhost:5173|127\.0\.0\.1:5173|tutorcruncher\.com/i.test(source)) offenders.push(full);
    }
  };
  walk(root);
  expect(offenders, `unexpected stale-URL references: ${offenders.join(', ')}`).toEqual([]);
});
