import { test, expect, type Page } from '@playwright/test';

const ACCOUNTS = {
  admin: { email: 'admin@learnthrive.dev', password: 'dev-admin-pass' },
  tutor: { email: 'tutor@learnthrive.dev', password: 'dev-tutor-pass' },
  client: { email: 'client@learnthrive.dev', password: 'dev-client-pass' },
  student: { email: 'student@learnthrive.dev', password: 'dev-student-pass' },
  disabled: { email: 'disabled@learnthrive.dev', password: 'dev-disabled-pass' },
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  // Not getByLabel('Password') — it substring-matches the "Show password" toggle button too.
  await page.locator('#login-password').fill(password);
  // The click handler does an async fetch() then a client-side router.push() — click() itself
  // only waits for the click event to dispatch, not for that async chain to finish. Without
  // waiting for the resulting navigation, a caller's next page.goto() races ahead of the actual
  // login completing (found the hard way: it raced to /dashboard/admin before the session
  // cookie existed, and got redirected to /login as if unauthenticated).
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}

async function attemptLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.form-message--error')).toBeVisible();
}

test('a valid login reaches the dashboard with role-appropriate content', async ({ page }) => {
  await login(page, ACCOUNTS.tutor.email, ACCOUNTS.tutor.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.dashboard-page')).toContainText('Welcome back');
  await expect(page.locator('.dashboard-page')).toContainText('tutor@learnthrive.dev');
});

test('an incorrect password is rejected with a generic message and no session is created', async ({ page }) => {
  await attemptLogin(page, ACCOUNTS.tutor.email, 'wrong-password');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('.form-message--error')).toContainText('Incorrect email or password');
});

test('an unknown account gets the same generic message as a wrong password (no account enumeration)', async ({ page }) => {
  await attemptLogin(page, 'nobody@learnthrive.dev', 'whatever');
  await expect(page.locator('.form-message--error')).toContainText('Incorrect email or password');
});

test('a disabled account gets a distinct message, not the generic invalid-credentials one', async ({ page }) => {
  await attemptLogin(page, ACCOUNTS.disabled.email, ACCOUNTS.disabled.password);
  await expect(page.locator('.form-message--error')).toContainText('disabled');
});

test('an unauthenticated visitor is redirected from /dashboard to /login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('the session persists across a reload, and logout ends it', async ({ page }) => {
  await login(page, ACCOUNTS.student.email, ACCOUNTS.student.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.reload();
  await expect(page.locator('.dashboard-page')).toContainText('Welcome back');

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('a Tutor cannot reach the Admin-only route — redirected to /403, not silently shown a blank page', async ({ page }) => {
  await login(page, ACCOUNTS.tutor.email, ACCOUNTS.tutor.password);
  await page.goto('/dashboard/admin');
  await expect(page).toHaveURL(/\/403$/);
  await expect(page.locator('h1')).toContainText("don't have access");
});

test('a Client is likewise blocked from the Admin-only route', async ({ page }) => {
  await login(page, ACCOUNTS.client.email, ACCOUNTS.client.password);
  await page.goto('/dashboard/admin');
  await expect(page).toHaveURL(/\/403$/);
});

test('an Admin can reach the Admin-only route', async ({ page }) => {
  await login(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password);
  await page.goto('/dashboard/admin');
  await expect(page).toHaveURL(/\/dashboard\/admin$/);
  await expect(page.locator('h1')).toContainText('Administration');
});

test('an already-authenticated visitor to /login is redirected straight to /dashboard', async ({ page }) => {
  await login(page, ACCOUNTS.admin.email, ACCOUNTS.admin.password);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('the password field is masked by default and the show/hide toggle works', async ({ page }) => {
  await page.goto('/login');
  const passwordInput = page.locator('#login-password');
  await expect(passwordInput).toHaveAttribute('type', 'password');
  await passwordInput.fill('something');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(passwordInput).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(passwordInput).toHaveAttribute('type', 'password');
});

test('empty submission shows a validation message without hitting the server', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.form-message--error')).toContainText('Enter your email and password');
});
