import { test, expect } from '@playwright/test';

// plan15 Wave 10 section 14.2: the mobile sticky enquiry bar. Shown after the first screen on a phone; never
// over a form or the footer; dismissible; absent on desktop and on the pages that are the enquiry.

const bar = (page: import('@playwright/test').Page) => page.locator('aside.enquiry-bar');

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('it is out of the way at the top, appears after the first screen, and leads to /book', async ({ page }) => {
    await page.goto('/');
    await expect(bar(page)).toHaveAttribute('data-visible', 'false');
    await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 1.5, behavior: 'instant' }));
    await expect(bar(page)).toHaveAttribute('data-visible', 'true');
    // Safe-area padding and a 44 px target.
    const box = await bar(page).getByRole('link', { name: 'Book a free consultation' }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await bar(page).getByRole('link', { name: 'Book a free consultation' }).click();
    await expect(page).toHaveURL(/\/book$/);
  });

  test('it hides while a form field has focus, and comes back when focus leaves', async ({ page }) => {
    await page.goto('/');
    const field = page.locator('#parent-name');
    await field.scrollIntoViewIfNeeded();
    await expect(bar(page)).toHaveAttribute('data-visible', 'true');
    await field.focus();
    await expect(bar(page)).toHaveAttribute('data-visible', 'false');
    await field.blur();
    await expect(bar(page)).toHaveAttribute('data-visible', 'true');
  });

  test('it is hidden (and inert) when not visible, so it cannot take focus or taps', async ({ page }) => {
    await page.goto('/');
    await expect(bar(page)).toHaveAttribute('inert', '');
  });

  test('dismissing removes it, and it stays gone on the next page', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 1.5, behavior: 'instant' }));
    await expect(bar(page)).toHaveAttribute('data-visible', 'true');
    await bar(page).getByRole('button', { name: 'Dismiss this bar' }).click();
    await expect(bar(page)).toHaveCount(0);
    await page.evaluate(() => (document.querySelector('a[href="/faq"]') as HTMLElement).click());
    await expect(page).toHaveURL(/\/faq$/);
    await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 1.5, behavior: 'instant' }));
    await expect(bar(page)).toHaveCount(0);
  });

  test('it is not on the pages that are the enquiry', async ({ page }) => {
    for (const route of ['/book', '/contact']) {
      await page.goto(route);
      await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 1.5, behavior: 'instant' }));
      await expect(bar(page), route).toHaveCount(0);
    }
  });

  test('it is not on the careers pages or the tutor forms: a parent booking button has no place there', async ({ page }) => {
    for (const route of ['/careers', '/careers/maths-tutor', '/careers/apply', '/careers/privacy', '/safeguarding/reconfirm']) {
      await page.goto(route);
      await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 1.5, behavior: 'instant' }));
      await expect(bar(page), route).toHaveCount(0);
    }
  });

  test('it leaves the footer uncovered', async ({ page }) => {
    await page.goto('/about');
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await expect(bar(page)).toHaveAttribute('data-visible', 'false');
  });

  test('it never causes horizontal overflow', async ({ page }) => {
    await page.goto('/subjects');
    await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 1.5, behavior: 'instant' }));
    const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(extra).toBe(0);
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('it is never shown', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 1.5, behavior: 'instant' }));
    await expect(bar(page)).toBeHidden();
  });
});
