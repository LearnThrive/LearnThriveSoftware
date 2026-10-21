import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PUBLIC_ROUTES } from './support';

// plan15 Wave 3 / section 17.3: axe (WCAG 2 A/AA) in the DARK theme, which accessibility.spec.ts does not
// cover (it renders the light site). Same engine and rule set, same reduced-motion emulation (so axe never
// scores a colour mid-fade). The dark theme is on by default and follows the OS, so emulating the colour
// scheme is exactly what a dark-mode visitor gets.

const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

async function runAxe(page: Page, label: string) {
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = (await page.evaluate(async () => {
    // @ts-expect-error injected global, no types installed for the browser build
    return await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
  })) as { violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> };

  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
      .join('\n\n');
    throw new Error(`${label} (dark): ${results.violations.length} accessibility violation(s)\n\n${summary}`);
  }
}

const ACCOUNTS = {
  admin: { email: 'admin@learnthrive.dev', password: 'dev-admin-pass' },
  tutor: { email: 'tutor@learnthrive.dev', password: 'dev-tutor-pass' },
  client: { email: 'client@learnthrive.dev', password: 'dev-client-pass' },
  student: { email: 'student@learnthrive.dev', password: 'dev-student-pass' },
};

async function login(page: Page, who: keyof typeof ACCOUNTS) {
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByLabel('Email').fill(ACCOUNTS[who].email);
  await page.locator('input[name="password"]').fill(ACCOUNTS[who].password);
  await Promise.all([page.waitForURL(/\/dashboard$/), page.getByRole('button', { name: 'Sign in' }).click()]);
}

test.describe('automated accessibility in the dark theme (axe-core, WCAG 2 A/AA)', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  });

  for (const route of [...PUBLIC_ROUTES, '/portal-opening-soon']) {
    test(`public route: ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('data-themes', 'on');
      await runAxe(page, route);
    });
  }

  test('login page', async ({ page }) => {
    await page.goto('/login');
    await runAxe(page, '/login');
  });

  for (const who of ['admin', 'tutor', 'client', 'student'] as const) {
    test(`${who}: dashboard, lessons, reports, settings`, async ({ page }) => {
      await login(page, who);
      await runAxe(page, `/dashboard (${who})`);
      for (const route of ['/dashboard/lessons', '/dashboard/reports', '/dashboard/settings']) {
        await page.goto(route);
        await runAxe(page, `${route} (${who})`);
      }
    });
  }

  test('admin: the calendar with its toolbar and an event chip', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/dashboard/calendar');
    await expect(page.locator('.fc-event').first()).toBeVisible();
    await runAxe(page, '/dashboard/calendar');
  });
});

// plan15 Wave 3: the classroom's pre-join screen (the dev lab renders the real UI without a live lesson) in both
// schemes. The classroom keeps its own look; plan 15 only aligns focus and contrast, which this guards.
for (const scheme of ['light', 'dark'] as const) {
  test(`the classroom pre-join screen is axe-clean (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
    await page.goto('/dev/classroom');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await runAxe(page, `/dev/classroom (${scheme})`);
  });
}
