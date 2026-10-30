import { test, expect, type Page } from '@playwright/test';
import { ACCESS, expectAxeClean } from './account-support';
import { hydrated } from './careers-support';

// One sign-in for the whole platform: /login is the account sign-in (the one LearnThrive AI has always used), and what a person finds
// behind it follows from who they are. Staff and enrolled families get the dashboard (and, with LearnThrive AI and the Library open,
// those too); a Library subscriber gets LearnThrive AI and the Library and never the dashboard; anyone else gets their account page.
//
// Runs on the second dev server (the Library open, LearnThrive AI on the mock model), where all three are available. The people are the
// development accounts (docs/DEVELOPMENT_ACCOUNTS.md), seeded behind this same sign-in.

const WHO = {
  admin: { email: 'admin@learnthrive.dev', password: 'dev-admin-pass' },
  tutor: { email: 'tutor@learnthrive.dev', password: 'dev-tutor-pass' },
  client: { email: 'client@learnthrive.dev', password: 'dev-client-pass' }, // enrolled
  student: { email: 'student@learnthrive.dev', password: 'dev-student-pass' }, // enrolled
  member: { email: 'member@learnthrive.dev', password: 'dev-member-pass' }, // a subscription, no enrolment
  visitor: { email: 'visitor@learnthrive.dev', password: 'dev-visitor-pass' }, // nothing yet
  disabled: { email: 'disabled@learnthrive.dev', password: 'dev-disabled-pass' },
} as const;

async function fill(page: Page, who: { email: string; password: string }, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await hydrated(page);
  await page.getByLabel('Email', { exact: true }).fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
}

/** Signs in and waits to arrive where the server sends them. */
async function signIn(page: Page, who: { email: string; password: string }, lands: RegExp, next?: string) {
  await fill(page, who, next);
  await Promise.all([page.waitForURL(lands), page.getByRole('button', { name: 'Sign in', exact: true }).click()]);
}

const dashboardMenu = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });
const memberMenu = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

test('/login is the one sign-in page, and the Library\'s old address leads to it', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Everything for your tuition, in one place.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create an account' })).toBeVisible();
  await page.goto('/account/sign-in');
  await expect(page).toHaveURL(/\/login$/);
});

test('an enrolled family signs in to the dashboard and finds LearnThrive AI and the Library in the same menu', async ({ page }) => {
  await signIn(page, WHO.client, /\/dashboard$/);
  const menu = dashboardMenu(page);
  await expect(menu.getByRole('link', { name: 'LearnThrive AI' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Library' })).toBeVisible();
  // Their whole dashboard is still theirs.
  await expect(menu.getByRole('link', { name: 'Children' })).toBeVisible();
  await expectAxeClean(page, 'the enrolled family\'s dashboard with the Learning menu');

  await menu.getByRole('link', { name: 'LearnThrive AI' }).click();
  await expect(page).toHaveURL(/\/library\/study-buddy$/);
  // And the way back is in the member menu.
  await memberMenu(page).getByRole('link', { name: 'Home' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('an enrolled student is the same: the dashboard first, everything one click away', async ({ page }) => {
  await signIn(page, WHO.student, /\/dashboard$/);
  await expect(page.locator('.app-usermenu__role')).toContainText('Student');
  await expect(dashboardMenu(page).getByRole('link', { name: 'LearnThrive AI' })).toBeVisible();
});

test('a Library subscriber lands on LearnThrive AI, has no dashboard link, and the dashboard is closed to them', async ({ page }) => {
  await signIn(page, WHO.member, /\/library\/study-buddy$/);
  await expect(memberMenu(page).getByRole('link', { name: 'LearnThrive AI' })).toBeVisible();
  await expect(memberMenu(page).getByRole('link', { name: 'Library' })).toBeVisible();
  await expect(memberMenu(page).getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  await expect(page.getByText('LearnThrive AI is included for enrolled students and Library subscribers.')).toHaveCount(0);

  // Asking for the dashboard (or a page in it) leads back to what they have, never to the dashboard.
  for (const path of ['/dashboard', '/dashboard/lessons', '/dashboard/calendar']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/library\/study-buddy$/);
  }
  // Nor can they reach the signed-in app's API: no session of that kind exists for them.
  expect((await page.request.get('/api/lessons/anything/ics')).status()).toBe(401);
});

test('someone signed in with nothing yet lands on their account page, and LearnThrive AI tells them what it is included with', async ({ page }) => {
  await signIn(page, WHO.visitor, /\/account$/);
  await page.goto('/library/ai');
  await expect(page.getByText('LearnThrive AI is included for enrolled students and Library subscribers.')).toBeVisible();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/account$/);
});

test('staff sign in to the dashboard: an administrator also gets LearnThrive AI and the Library, a tutor only their own work', async ({ page }) => {
  await signIn(page, WHO.admin, /\/dashboard$/);
  await expect(dashboardMenu(page).getByRole('link', { name: 'LearnThrive AI' })).toBeVisible();
  await expect(dashboardMenu(page).getByRole('link', { name: 'Library' })).toBeVisible();
  await page.context().clearCookies();

  await signIn(page, WHO.tutor, /\/dashboard$/);
  await expect(dashboardMenu(page).getByRole('link', { name: 'Calendar' })).toBeVisible();
  await expect(dashboardMenu(page).getByRole('link', { name: 'LearnThrive AI' })).toHaveCount(0);
  await expect(dashboardMenu(page).getByRole('link', { name: 'Library' })).toHaveCount(0);
});

test('a page asked for before signing in is kept for someone who may open it, and replaced by home for someone who may not', async ({ page, context }) => {
  await page.goto('/dashboard/calendar');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fcalendar$/);
  await signIn(page, WHO.client, /\/dashboard\/calendar$/, '/dashboard/calendar');
  await context.clearCookies();

  await signIn(page, WHO.member, /\/library\/study-buddy$/, '/dashboard/calendar');
  await context.clearCookies();

  // A page that is not a path on this site is never followed.
  await signIn(page, WHO.client, /localhost:3101\/dashboard$/, 'https://evil.example/');
});

test('a person who is already signed in is sent straight on from /login', async ({ page }) => {
  await signIn(page, WHO.member, /\/library\/study-buddy$/);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/library\/study-buddy$/);
  await page.goto('/login?next=/dashboard');
  await expect(page).toHaveURL(/\/library\/study-buddy$/);
});

test('a lapsed access token is renewed in passing: the page asked for opens, no sign-in form in between', async ({ page, context }) => {
  await signIn(page, WHO.client, /\/dashboard$/);
  await context.clearCookies({ name: ACCESS });
  await page.goto('/dashboard/calendar');
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);
  await expect(dashboardMenu(page)).toBeVisible();
});

test('signing out of the dashboard ends the Library session too, and signing out of the Library ends the dashboard', async ({ page }) => {
  await signIn(page, WHO.client, /\/dashboard$/);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/library/ai');
  await expect(page).toHaveURL(/\/login\?next=%2Flibrary%2Fstudy-buddy$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);

  await signIn(page, WHO.client, /\/dashboard$/);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});

test('the public header offers a signed-in person their own place instead of "Login"', async ({ page }) => {
  await signIn(page, WHO.member, /\/library\/study-buddy$/);
  await page.goto('/');
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: /^LearnThrive AI/ })).toBeVisible();
  await expect(header.getByRole('link', { name: /^Login$/ })).toHaveCount(0);
  await page.context().clearCookies();

  await signIn(page, WHO.client, /\/dashboard$/);
  await page.goto('/');
  await expect(page.getByRole('banner').getByRole('link', { name: /^Dashboard/ })).toBeVisible();
});

test('a disabled account is told so, with no session, and a wrong password gets the generic answer', async ({ page }) => {
  await fill(page, WHO.disabled);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('form [role="alert"]')).toContainText('disabled');
  expect((await page.context().cookies()).filter((c) => c.name === ACCESS)).toHaveLength(0);

  await fill(page, { email: WHO.client.email, password: 'definitely not the password' });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('form [role="alert"]')).toContainText('Email or password is not right.');
});

test('one shell, by keyboard alone: the skip link first, the menu in reading order, Enter follows a link, and the account menu opens and closes', async ({ page }) => {
  await signIn(page, WHO.member, /\/library\/study-buddy$/);
  await page.goto('/account');
  await hydrated(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  const order: string[] = [];
  for (let i = 0; i < 8 && order.length < 4; i += 1) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '');
    if (['LearnThrive AI', 'Library', 'Search', 'Account'].includes(name)) order.push(name);
  }
  expect(order).toEqual(['LearnThrive AI', 'Library', 'Search', 'Account']);
  // Shift+Tab back to LearnThrive AI and follow it with Enter.
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+Tab');
  await expect(dashboardMenu(page).getByRole('link', { name: 'LearnThrive AI' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/library\/study-buddy$/);
  // The account menu: opens from its button, Escape closes it and returns focus to the button.
  const trigger = page.getByRole('button', { name: 'Account menu' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(trigger).toBeFocused();
});
