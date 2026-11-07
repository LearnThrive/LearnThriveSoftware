import { expect, test, type Page } from '@playwright/test';

/** What both real-stack specs need from a browser: the one sign-in, and a visitor address the site's rate limits can count separately. */

/**
 * A fresh visitor address for each test, in a block of its own for each run.
 *
 * Why it matters here and not in the in-memory suite's own words: this dev server lives far longer than one run of this suite, and the
 * site's limits are per visitor address and held in memory (10 password changes in 15 minutes, 6 emailed links in an hour). Without
 * this, a second run inside the window is refused with "Too many requests from this connection" — the limit working, not a bug.
 */
const block = Math.floor(Math.random() * 250) + 1;
let visitor = 0;
export function distinctVisitor(): void {
  test.beforeEach(async ({ context }) => {
    visitor += 1;
    await context.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.${block}.${(visitor % 250) + 1}, 10.0.0.1` });
  });
}

/** Waits for the page's own hydration marker (the account and public pages set it; the dashboard does not). */
export async function hydrated(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-motion-tier', /.+/);
}

/** The one sign-in: a username and a password at /login. Waits for wherever it lands, which may be a route the dev server compiles first. */
export async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login');
  await hydrated(page);
  await page.getByLabel('Username').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 60_000 });
}

export async function signOut(page: Page): Promise<void> {
  await page.request.post('/api/account/logout', { data: {} });
}

/** Opens a dashboard dialog. The dashboard sets no hydration marker, and a click before hydration does nothing. */
export async function openDialog(page: Page, button: string) {
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: button }).first().click({ timeout: 2000 });
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  return dialog;
}
