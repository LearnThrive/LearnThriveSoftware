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
    // exact: the footer also has an "Applicant privacy" link, whose name contains this one.
    await expect(footer.getByRole('link', { name: 'Privacy', exact: true })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Privacy', exact: true })).toHaveCSS('opacity', '1');
    await footer.getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(page).toHaveURL(/\/privacy$/);
  });
});

// plan18: Careers is in the main navigation (it was reachable only from the footer), on the desktop header and in the
// mobile menu, and the header still fits and never collides at the widths in between. The dev server compiles a page the
// first time it is visited, so the checks that follow a click to /careers wait up to 15 seconds rather than five.
test.describe('Careers in the main navigation', () => {
  test('is a link in the desktop navigation, between FAQ and Book, and marks the careers pages as current', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const careers = nav.getByRole('link', { name: 'Careers', exact: true });
    await expect(careers).toBeVisible();
    await expect(careers).toHaveAttribute('href', '/careers');
    const order = await nav.getByRole('link').allInnerTexts();
    expect(order.map((text) => text.trim())).toEqual(['Home', 'About', 'Subjects', 'FAQ', 'Careers', 'Book', 'Contact']);
    await careers.click();
    await expect(page).toHaveURL(/\/careers$/, { timeout: 15_000 });
    await expect(nav.getByRole('link', { name: 'Careers', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.goto('/careers/maths-tutor');
    await expect(nav.getByRole('link', { name: 'Careers', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('can be reached and followed with the keyboard alone', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/about');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('link', { name: 'Careers', exact: true }).focus();
    await expect(nav.getByRole('link', { name: 'Careers', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/careers$/, { timeout: 15_000 });
  });

  test('is in the mobile menu, and opens the hub from it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open main menu' }).click();
    const careers = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Careers', exact: true });
    await expect(careers).toBeVisible();
    await careers.click();
    await expect(page).toHaveURL(/\/careers$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Tutor with LearnThrive');
  });

  // The whole desktop header (seven links, Login while the portal is open, the two icon buttons and the booking button)
  // fits on one line from 1121px; at 1120px and below the menu opens from the toggle instead, so nothing collides at
  // tablet widths.
  for (const width of [1121, 1150, 1200, 1280, 1440, 1920]) {
    test(`at ${width}px the desktop header fits on one line, with every control clear of its neighbours`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/about');
      const result = await page.evaluate(() => {
        const inner = document.querySelector('.site-header__inner')!;
        const boxes = [...inner.querySelectorAll('.brand, .primary-navigation > a, .nav-flyout > *:first-child, .header-login, .header-icon-button, .header-cta')]
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => el.getBoundingClientRect())
          .sort((a, b) => a.left - b.left);
        let smallestGap = Infinity;
        for (let i = 1; i < boxes.length; i += 1) smallestGap = Math.min(smallestGap, boxes[i].left - boxes[i - 1].right);
        return {
          toggleShown: getComputedStyle(document.querySelector('.menu-toggle')!).display !== 'none',
          innerOverflow: inner.scrollWidth - inner.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          smallestGap,
          lastRight: Math.max(...boxes.map((box) => box.right)),
        };
      });
      expect(result.toggleShown).toBe(false);
      expect(result.innerOverflow).toBeLessThanOrEqual(0);
      expect(result.pageOverflow).toBeLessThanOrEqual(0);
      expect(result.smallestGap).toBeGreaterThanOrEqual(8);
      expect(result.lastRight).toBeLessThanOrEqual(width);
    });
  }

  for (const width of [1120, 1024, 960, 834, 768, 390, 360]) {
    test(`at ${width}px the header is the logo and the menu button, and the page does not scroll sideways`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/about');
      await expect(page.getByRole('button', { name: 'Open main menu' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }
});
