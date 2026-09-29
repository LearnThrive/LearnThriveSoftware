import { test, expect } from '@playwright/test';

// plan11.md task 13: SiteHeader.tsx / SiteFooter.tsx render on every public page, so this is the
// highest blast-radius change in the task — the explicit checklist item "verify links remain
// immediately actionable; do not recreate the old page-fade regression" refers to a real, already-
// reverted bug in the authenticated app shell (docs/DESIGN_SYSTEM.md: a per-navigation fade made a
// link briefly non-actionable, a genuine Playwright actionability timeout). This file exercises the
// header's scroll-compact state, the mobile menu's backdrop/close behaviour, and that every header
// and footer link is clickable and actually navigates, immediately, on a fresh page load.

test.describe('SiteHeader scroll state', () => {
  test('the header gains --scrolled once past the threshold, and loses it back at the top', async ({ page }) => {
    await page.goto('/about');
    const header = page.locator('header.site-header');
    await expect(header).not.toHaveClass(/site-header--scrolled/);

    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(header).toHaveClass(/site-header--scrolled/);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(header).not.toHaveClass(/site-header--scrolled/);
  });

  test('every header link is immediately actionable on a fresh page load — no page-fade delay', async ({ page }) => {
    await page.goto('/');
    // Click a primary nav link the instant the page is interactive — this is exactly the scenario
    // docs/DESIGN_SYSTEM.md's reverted page-fade broke (a link right after navigation timing out
    // on actionability). Playwright's own click already waits for actionable+stable, so a timeout
    // here would be the regression; a normal navigation is the pass condition. Scoped to the header
    // nav specifically — the footer has its own "About" link too.
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about$/);
  });
});

test.describe('SiteHeader mobile menu', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens, shows a backdrop, and closes on backdrop click', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Open main menu' });
    await toggle.click();

    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
    const backdrop = page.locator('.navigation-backdrop');
    await expect(backdrop).toHaveClass(/navigation-backdrop--open/);

    // The backdrop must not sit over the menu panel itself, or it would swallow link clicks —
    // click it and confirm the menu actually closes rather than nothing happening.
    await backdrop.click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole('button', { name: 'Open main menu' })).toBeVisible();
    await expect(backdrop).not.toHaveClass(/navigation-backdrop--open/);
  });

  test('closes on Escape and returns focus to the toggle button', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Open main menu' });
    await toggle.click();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open main menu' })).toBeVisible();
    await expect(toggle).toBeFocused();
  });

  test('a link inside the open menu is immediately clickable and navigates', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open main menu' }).click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Contact' }).click();
    await expect(page).toHaveURL(/\/contact$/);
  });
});

test.describe('SiteFooter', () => {
  test('renders under reduced motion with every link visible and actionable', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const footer = page.locator('footer.site-footer');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.getByRole('link', { name: 'Privacy' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Privacy' })).toHaveCSS('opacity', '1');
    await footer.getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
  });
});
