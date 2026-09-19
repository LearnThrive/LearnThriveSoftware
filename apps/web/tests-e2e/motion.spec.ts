import { test, expect, type Page } from '@playwright/test';
import { uniqueLabel } from './support';

// plan8 sections 75-76: reduced motion must never be *required* to use the interface, and these
// tests exist to catch exactly one failure mode — an element that stays hidden, unreachable, or
// stuck mid-transition because something here assumed an animation would run to completion.
// Deliberately state-based, not timing-based: every assertion below is "is this open/closed/
// visible now", never "wait exactly N ms and check". A test asserting on frame-by-frame animation
// values would be the brittle kind section 76 explicitly says to avoid, and would break on every
// future duration/easing tweak for no functional reason.

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

test.describe('motion — reduced motion path', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('a Dialog still opens and closes, with no lingering hidden panel left behind', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.goto('/dashboard/admin/people/students');
    await page.getByRole('button', { name: 'Add student' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    // Reduced motion means useDelayedUnmount skips its exit window entirely — the panel must be
    // gone from the DOM immediately, not merely invisible-but-still-present (still focusable,
    // still in the accessibility tree) for the length of an exit animation that isn't running.
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the account menu opens and closes cleanly', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Log out' })).toHaveCount(0);
  });

  test('QuickCreateMenu opens and its items are immediately usable', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.getByRole('button', { name: 'Create' }).click();
    const studentItem = page.getByRole('menuitem', { name: 'Student' });
    await expect(studentItem).toBeVisible();
    // The per-item stagger (animation-delay) must never make an item genuinely unclickable —
    // under reduced motion the blanket rule in globals.css collapses every animation-duration to
    // 0.01ms, so there is nothing left to wait out.
    await expect(studentItem).toBeEnabled();
  });

  test('the mobile nav drawer opens, closes on its own X, and reopening still works', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, ADMIN.email, ADMIN.password);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();

    await page.getByRole('button', { name: 'Close navigation' }).click();
    // Below the sidebar breakpoint the desktop sidebar (and its own copy of every nav link) is
    // `display: none`, entirely absent from the accessibility tree — so the real, user-visible
    // proof the drawer is genuinely gone (not just invisible-but-still-mounted, still holding a
    // stray focus trap behind) is that opening it again still works.
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    // A real mobile flow: tap a link from inside the open drawer, which both navigates and
    // dismisses it in the same click (AppShellClient's dismissOverlays on each nav Link).
    await page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Calendar' }).click();
    await expect(page).toHaveURL(/\/dashboard\/calendar$/);
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0);
  });

  test('a toast still appears and can be dismissed', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.goto('/dashboard/admin/people/tutors');
    await page.getByRole('button', { name: 'Add tutor' }).click();
    await page.locator('#tutor-name').fill(uniqueLabel('Reduced Motion Test Tutor'));
    await page.locator('#tutor-email').fill(`reduced-motion-tutor-${test.info().retry}@example.test`);
    await page.getByRole('dialog').getByRole('button', { name: 'Add tutor' }).click();

    const toast = page.locator('.toast');
    await expect(toast).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(toast).toHaveCount(0);
  });
});

test('FilterTabs: the sliding indicator never blocks or misreports which filter is actually selected', async ({ page }) => {
  // Full motion, not reduced — this is the one component with client-measured positioning
  // (ResizeObserver + getBoundingClientRect), so it's the one worth checking with the real
  // animation path active, not just the reduced-motion one covered above.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/admin/people/students');
  // Scoped to .filter-tabs — the sidebar nav has its own "Clients" link on this same page, and
  // both are real navigational links to the same URL by design (plan6 section 39: People is
  // reachable both from the sidebar directly and via these in-page tabs).
  const tabs = page.locator('.filter-tabs');
  await tabs.getByRole('link', { name: 'Clients' }).click();
  await expect(page).toHaveURL(/\/dashboard\/admin\/people\/clients/);
  await expect(tabs.getByRole('link', { name: 'Clients' })).toHaveAttribute('aria-current', 'page');
});
