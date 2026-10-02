import { test, expect, type Page } from '@playwright/test';

// plan15 Wave 5 section 9.5: the sliding indicator under the desktop navigation. One element that rests under the
// current page's link and glides to the hovered or focused one.

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

/** The indicator's box, from its transform (translateX of the link's left edge, scaled to its width). */
async function indicator(page: Page) {
  return page.locator('.nav-indicator').evaluate((el) => {
    const style = getComputedStyle(el);
    const matrix = new DOMMatrixReadOnly(style.transform);
    const navBox = el.parentElement!.getBoundingClientRect();
    return { left: navBox.left + matrix.m41, width: matrix.a, opacity: Number(style.opacity) };
  });
}

async function linkBox(page: Page, name: string) {
  const box = await nav(page).getByRole('link', { name, exact: true }).boundingBox();
  return { left: box!.x, width: box!.width };
}

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('it rests under the current page\'s link', async ({ page }) => {
    await page.goto('/about');
    await expect.poll(async () => (await indicator(page)).opacity).toBe(1);
    const about = await linkBox(page, 'About');
    const ind = await indicator(page);
    expect(Math.abs(ind.left - about.left)).toBeLessThan(2);
    expect(Math.abs(ind.width - about.width)).toBeLessThan(2);
  });

  test('it glides to a hovered link and returns to the current page when the pointer leaves', async ({ page }) => {
    await page.goto('/about');
    await page.waitForTimeout(400);
    const faq = await linkBox(page, 'FAQ');
    await nav(page).getByRole('link', { name: 'FAQ', exact: true }).hover();
    await expect.poll(async () => Math.round((await indicator(page)).left)).toBeGreaterThan(Math.round(faq.left) - 3);
    expect(Math.abs((await indicator(page)).left - faq.left)).toBeLessThan(3);
    await page.mouse.move(640, 500);
    const about = await linkBox(page, 'About');
    await expect.poll(async () => Math.abs((await indicator(page)).left - about.left)).toBeLessThan(3);
  });

  test('it follows keyboard focus too', async ({ page }) => {
    await page.goto('/about');
    await nav(page).getByRole('link', { name: 'Contact', exact: true }).focus();
    const contact = await linkBox(page, 'Contact');
    await expect.poll(async () => Math.abs((await indicator(page)).left - contact.left)).toBeLessThan(3);
  });

  test('on a page that is not a menu item the indicator is hidden', async ({ page }) => {
    await page.goto('/privacy');
    await expect.poll(async () => (await indicator(page)).opacity).toBe(0);
  });

  test('the per-link underline is gone on desktop (the indicator replaces it)', async ({ page }) => {
    await page.goto('/about');
    const content = await nav(page).getByRole('link', { name: 'About', exact: true }).evaluate((el) => getComputedStyle(el, '::after').display);
    expect(content).toBe('none');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the indicator is not shown; the menu keeps its own current-page style', async ({ page }) => {
    await page.goto('/about');
    await page.getByRole('button', { name: 'Open main menu' }).click();
    await expect(page.locator('.nav-indicator')).toBeHidden();
    await expect(nav(page).getByRole('link', { name: 'About', exact: true })).toHaveAttribute('aria-current', 'page');
  });
});
