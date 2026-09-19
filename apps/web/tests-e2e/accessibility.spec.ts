import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Plan6 section 88: "Run available automated accessibility checks." axe-core is a real WCAG rule
// engine run against the actual rendered DOM — a stronger check than eslint-plugin-jsx-a11y's
// static JSX analysis (which `npm run lint` already runs on every file, and which this suite
// doesn't duplicate). Injected as a raw script rather than via an @axe-core/playwright package,
// since axe-core itself is already a devDependency and that's all injecting it needs.

const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[]; failureSummary?: string }>;
}

async function runAxe(page: Page, label: string) {
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = await page.evaluate(async () => {
    // @ts-expect-error injected global, no types installed for the browser build
    return await window.axe.run(document, {
      // Landmark/region rules fire a lot of noise on component-library-style pages that don't
      // put every pixel inside a named landmark; the rest of WCAG 2 A/AA is what actually
      // matters for the roles this product serves (keyboard users, screen readers, low vision).
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });
  }) as { violations: AxeViolation[] };

  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
      .join('\n\n');
    throw new Error(`${label}: ${results.violations.length} accessibility violation(s)\n\n${summary}`);
  }
}

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

test.describe('automated accessibility (axe-core, WCAG 2 A/AA)', () => {
  // The marketing site's own entrance animations (home.module.css's lt-rise: opacity 0 -> 1 over
  // ~0.8s) fade elements in from transparent, and axe scores contrast on whatever's actually
  // rendered at the instant it runs — catching one mid-fade is a real reading, just of a state
  // that (genuinely) only exists for a fraction of a second, not the page's steady-state
  // appearance. Both stylesheets already respect prefers-reduced-motion; emulating it removes
  // that timing confound entirely rather than adding a fixed wait to hopefully outlast it.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('marketing home', async ({ page }) => {
    await page.goto('/');
    await runAxe(page, '/');
  });

  test('login page', async ({ page }) => {
    await page.goto('/login');
    await runAxe(page, '/login');
  });

  test('Admin dashboard', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await runAxe(page, '/dashboard (Admin)');
  });

  test('Admin: People, Assignments, Calendar', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.goto('/dashboard/admin/people/students');
    await runAxe(page, '/dashboard/admin/people/students');
    await page.goto('/dashboard/admin/assignments');
    await runAxe(page, '/dashboard/admin/assignments');
    await page.goto('/dashboard/calendar');
    await runAxe(page, '/dashboard/calendar');
  });

  test('lesson detail and the calendar peek panel', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.goto('/dashboard/lessons/lesson-gcse-maths-upcoming');
    await runAxe(page, '/dashboard/lessons/lesson-gcse-maths-upcoming');

    await page.goto('/dashboard/calendar');
    await page.locator('.fc-event').first().click();
    await expect(page.locator('.lesson-peek__panel')).toBeVisible();
    await runAxe(page, 'calendar with the lesson peek panel open');
  });

  test('Tutor dashboard and availability', async ({ page }) => {
    await login(page, TUTOR.email, TUTOR.password);
    await runAxe(page, '/dashboard (Tutor)');
    await page.goto('/dashboard/tutor/availability');
    await runAxe(page, '/dashboard/tutor/availability');
  });
});
