import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { humanCheckDone, hydrated } from './careers-support';

// Shared by the account and Library specs (plan19 phases C and D). Everything here talks to the dev server, whose
// account backend is the in-memory one: the "emails" are read from /api/dev/account-outbox (a 404 in production).

const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const WCAG22 = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
export const PASSWORD = 'correct horse battery staple';
export const ACCESS = 'learnthrive_acct';

export async function expectAxeClean(page: Page, label: string) {
  // The shell fades in; axe measures contrast against whatever is on screen, so let the entrance finish first.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = (await page.evaluate(async (tags) => {
    // @ts-expect-error injected global, no types installed for the browser build
    return await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
  }, WCAG22)) as { violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> };
  const lines = results.violations.map((v) => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`);
  expect(results.violations, `${label}: ${results.violations.length} violation(s)\n\n${lines.join('\n\n')}`).toEqual([]);
}

// The server rate-limits by visitor address (5 sign-ups an hour), and every test here comes from localhost. A made-up
// forwarded address per test gives each its own bucket, as separate visitors would have.
let visitor = 0;
export function distinctVisitor() {
  test.beforeEach(async ({ context }) => {
    visitor += 1;
    const { workerIndex, retry } = test.info();
    await context.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${((workerIndex * 40 + retry * 20 + visitor) % 250) + 1}, 10.0.0.1` });
  });
}

/** One address per test attempt: the in-memory backend lives as long as the dev server. */
export function address(): string {
  const { workerIndex, retry } = test.info();
  return `family-${Date.now()}-${workerIndex}-${retry}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function link(page: Page, to: string, kind: 'signup' | 'recovery'): Promise<string> {
  const response = await page.request.get(`/api/dev/account-outbox?to=${encodeURIComponent(to)}`);
  expect(response.ok()).toBe(true);
  const { messages } = (await response.json()) as { messages: Array<{ kind: string; tokenHash: string }> };
  const last = messages.filter((m) => m.kind === kind).at(-1);
  expect(last, `a ${kind} email for ${to}`).toBeTruthy();
  return `/account/confirm?token_hash=${last!.tokenHash}&type=${kind}`;
}

export async function signUp(page: Page, email: string) {
  await page.goto('/account/sign-up');
  await hydrated(page);
  const card = page.locator('[data-auth-mode]');
  await card.getByLabel('Email', { exact: true }).fill(email);
  await card.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await card.getByRole('checkbox', { name: /18 or over/ }).check();
  await humanCheckDone(page);
  await card.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
}

export async function confirm(page: Page, email: string) {
  await page.goto(await link(page, email, 'signup'));
  await hydrated(page);
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(page).toHaveURL(/\/account$/);
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/account/sign-in');
  await hydrated(page);
  const card = page.locator('[data-auth-mode]');
  await card.getByLabel('Email', { exact: true }).fill(email);
  await card.getByLabel('Password', { exact: true }).fill(password);
  await card.getByRole('button', { name: 'Sign in', exact: true }).click();
}

