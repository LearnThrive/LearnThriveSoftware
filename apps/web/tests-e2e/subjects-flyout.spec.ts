import { test, expect, type Page } from '@playwright/test';

// plan15 Wave 10 section 14.2: the Subjects flyout in the header. A disclosure beside the Subjects link:
// keyboard and touch operable, nothing hover-only, closes on Escape / outside press / navigation.

const toggle = (page: Page) => page.getByRole('button', { name: 'Open the what we teach menu' });
const panel = (page: Page) => page.getByRole('group', { name: 'What we teach' });

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the Subjects link still goes to /subjects, and the panel is closed and unreachable at first', async ({ page }) => {
    await page.goto('/about');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page)).toBeHidden();
    // Closed means inert: its links are not in the tab order (and not in the accessibility tree, which is
    // why this reads the element by class rather than by its group role).
    await expect(page.locator('.nav-flyout__panel')).toHaveAttribute('inert', '');
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Subjects', exact: true }).click();
    await expect(page).toHaveURL(/\/subjects$/);
  });

  test('a click opens it with the four subjects and an all-subjects link; choosing one navigates and closes it', async ({ page }) => {
    await page.goto('/about');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page)).toBeVisible();
    for (const name of ['Maths', 'English', 'Science', '11+ Preparation']) {
      await expect(panel(page).getByRole('link', { name })).toBeVisible();
    }
    await expect(panel(page).getByRole('link', { name: /All subjects/ })).toBeVisible();
    await panel(page).getByRole('link', { name: /Maths/ }).click();
    await expect(page).toHaveURL(/\/maths-tuition$/);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('keyboard: Enter opens, Tab walks the panel, Escape closes and returns focus to the button', async ({ page }) => {
    await page.goto('/about');
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toContainText('Maths');
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(toggle(page)).toBeFocused();
  });

  test('tabbing out of the panel closes it', async ({ page }) => {
    await page.goto('/about');
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    // 4 subject links + "All subjects", then out.
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
    await expect(panel(page)).toBeHidden();
  });

  test('a press outside closes it', async ({ page }) => {
    await page.goto('/about');
    await toggle(page).click();
    await expect(panel(page)).toBeVisible();
    await page.mouse.click(40, 500);
    await expect(panel(page)).toBeHidden();
  });

  test('a mouse hovering over it opens it too (a convenience, never the only way)', async ({ page }) => {
    await page.goto('/about');
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Subjects', exact: true }).hover();
    await expect(panel(page)).toBeVisible();
    await page.mouse.move(640, 600);
    await expect(panel(page)).toBeHidden();
  });

  test('the panel is on screen, not clipped, and the page does not scroll sideways', async ({ page }) => {
    await page.goto('/');
    await toggle(page).click();
    const box = await panel(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
    const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(extra).toBe(0);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('inside the open menu it expands inline, the links are tappable, and choosing one closes the menu', async ({ page }) => {
    await page.goto('/about');
    await page.getByRole('button', { name: 'Open main menu' }).click();
    await toggle(page).tap();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    const english = panel(page).getByRole('link', { name: /English/ });
    await expect(english).toBeVisible();
    const box = await english.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await english.tap();
    await expect(page).toHaveURL(/\/english-tuition$/);
    await expect(page.getByRole('button', { name: 'Open main menu' })).toBeVisible();
  });
});
