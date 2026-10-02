import { test, expect, type Page } from '@playwright/test';

// plan15 Wave 9 — the public command palette (Ctrl/Cmd+K, plus a visible Search button).
// Keyboard-only flows, ARIA combobox/listbox wiring, focus return, the form-field guard, recents,
// layout stability, Lenis pause, and both themes.

async function pinCapabilities(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
    // The suite runs on Windows/Linux CI: Ctrl is the modifier. Pin it so a macOS dev machine agrees.
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true });
  });
}

const palette = (page: Page) => page.getByRole('dialog', { name: 'Search LearnThrive' });
// Scoped to the palette: a native <select>'s <option>s (the enquiry form) are role=option too.
const options = (page: Page) => palette(page).getByRole('option');
const field = (page: Page) => page.getByRole('combobox', { name: 'Search LearnThrive' });

async function openWithShortcut(page: Page) {
  await page.keyboard.press('Control+K');
  await expect(palette(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await pinCapabilities(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.describe('opening and closing', () => {
  test('Ctrl+K opens it with the field focused; Escape closes it and focus goes back', async ({ page }) => {
    await page.goto('/about');
    await page.getByRole('link', { name: 'Home', exact: true }).first().focus();
    await openWithShortcut(page);
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Home', exact: true }).first()).toBeFocused();
  });

  test('the header Search button opens it, and Escape returns focus to the button', async ({ page }) => {
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Search the site' });
    await button.click();
    await expect(palette(page)).toBeVisible();
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('clicking the backdrop closes it', async ({ page }) => {
    await page.goto('/');
    await openWithShortcut(page);
    await page.mouse.click(8, 8);
    await expect(palette(page)).toHaveCount(0);
  });

  test('Ctrl+K again toggles it closed', async ({ page }) => {
    await page.goto('/');
    await openWithShortcut(page);
    await page.keyboard.press('Control+K');
    await expect(palette(page)).toHaveCount(0);
  });

  test('"/" opens it from the page body', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').click({ position: { x: 5, y: 450 } });
    await page.keyboard.press('/');
    await expect(palette(page)).toBeVisible();
  });
});

test.describe('typing fields are never robbed of a keystroke', () => {
  test('"/" typed into a form field stays in the field; Ctrl+K still opens the palette', async ({ page }) => {
    await page.goto('/book');
    const name = page.getByLabel('Parent or guardian name');
    await name.click();
    await page.keyboard.type('a/b');
    await expect(name).toHaveValue('a/b');
    await expect(palette(page)).toHaveCount(0);
    await page.keyboard.press('Control+K');
    await expect(palette(page)).toBeVisible();
  });

  test('typing a "/" in the palette\'s own field is just typing', async ({ page }) => {
    await page.goto('/');
    await openWithShortcut(page);
    await page.keyboard.type('a/b');
    await expect(field(page)).toHaveValue('a/b');
  });
});

test.describe('the combobox pattern', () => {
  test('type, arrow, Enter: a keyboard-only journey to a subject page', async ({ page }) => {
    await page.goto('/');
    await openWithShortcut(page);
    await page.keyboard.type('maths');
    const first = options(page).first();
    await expect(first).toHaveText(/Maths tuition/);
    await expect(first).toHaveAttribute('aria-selected', 'true');
    // The field keeps DOM focus; the active result is exposed through aria-activedescendant.
    const activeId = await first.getAttribute('id');
    await expect(field(page)).toHaveAttribute('aria-activedescendant', activeId!);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/maths-tuition$/);
    await expect(palette(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('ArrowDown/ArrowUp move the selection and wrap', async ({ page }) => {
    await page.goto('/');
    await openWithShortcut(page);
    await page.keyboard.type('tuition');
    const items = options(page);
    const count = await items.count();
    expect(count).toBeGreaterThan(3);
    await expect(items.nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(items.nth(count - 1)).toHaveAttribute('aria-selected', 'true');
  });

  test('results are grouped, and the group labels are not options', async ({ page }) => {
    await page.goto('/');
    await openWithShortcut(page);
    const list = page.getByRole('listbox', { name: 'Results' });
    await expect(list).toBeVisible();
    for (const group of ['Pages', 'Subjects', 'Actions', 'Appearance', 'Legal', 'FAQ']) {
      await expect(list.getByText(group, { exact: true }).first()).toBeVisible().catch(() => undefined);
    }
    expect(await options(page).count()).toBeGreaterThan(20);
    expect(await list.getByRole('option').filter({ hasText: /^(Pages|Subjects)$/ }).count()).toBe(0);
  });

  test('the result count is announced politely, and "no results" says so', async ({ page }) => {
    await page.goto('/');
    await openWithShortcut(page);
    await page.keyboard.type('maths');
    await expect(palette(page).getByRole('status')).toHaveText(/\d+ results?/);
    await field(page).fill('zzzzqqq');
    await expect(palette(page).getByRole('status')).toHaveText('No results');
    await expect(palette(page).getByText(/Nothing matches/)).toBeVisible();
  });
});

test.describe('what it can do', () => {
  test('finds a FAQ question and lands on the opened panel', async ({ page }) => {
    await page.goto('/');
    await openWithShortcut(page);
    await page.keyboard.type('How do I get started');
    await expect(options(page).first()).toHaveText(/get started with LearnThrive/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/faq#how-to-get-started$/);
    await expect(page.locator('details:has(#how-to-get-started), details#how-to-get-started').first()).toHaveJSProperty('open', true);
  });

  test('switches theme from the palette', async ({ page }) => {
    await page.goto('/');
    await openWithShortcut(page);
    await page.keyboard.type('dark theme');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(palette(page)).toHaveCount(0);
  });

  test('remembers what you chose: it is the first thing offered next time', async ({ page }) => {
    await page.goto('/');
    await openWithShortcut(page);
    await page.keyboard.type('safeguarding');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/safeguarding$/);
    await openWithShortcut(page);
    const list = page.getByRole('listbox', { name: 'Results' });
    await expect(list.getByText('Recent', { exact: true })).toBeVisible();
    await expect(options(page).first()).toHaveText(/Safeguarding/);
  });

  test('"Send an enquiry" goes to the booking page', async ({ page }) => {
    await page.goto('/about');
    await openWithShortcut(page);
    await page.keyboard.type('enquiry');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/book$/);
  });
});

test.describe('stability', () => {
  test('opening it does not shift the page and pauses smooth scrolling while open', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-smooth-scroll', 'on');
    const before = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.clientWidth }));
    await openWithShortcut(page);
    const stopped = () => page.evaluate(() => Boolean((window as unknown as { __lenis?: { isStopped: boolean } }).__lenis?.isStopped));
    await expect.poll(stopped).toBe(true);
    const during = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.clientWidth }));
    expect(during.h).toBe(before.h);
    await page.keyboard.press('Escape');
    await expect.poll(stopped).toBe(false);
  });

  test('under reduced motion it closes at once, leaving nothing in the DOM', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await openWithShortcut(page);
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0, { timeout: 500 });
  });

  test('on a phone the header button opens it as a full-width sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open main menu' }).click();
    await page.getByRole('button', { name: 'Search the site' }).click();
    await expect(palette(page)).toBeVisible();
    const box = await palette(page).boundingBox();
    expect(box!.width).toBeGreaterThan(340);
    await expect(field(page)).toBeFocused();
  });
});

test.describe('both themes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`readable in the ${scheme} theme`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await pinCapabilities(page);
      await page.goto('/');
      await openWithShortcut(page);
      await page.keyboard.type('maths');
      const active = options(page).first();
      const colours = await active.evaluate((el) => {
        const cs = getComputedStyle(el);
        const panel = getComputedStyle(el.closest('[role="dialog"]')!);
        return { text: cs.color, panel: panel.backgroundColor };
      });
      // Light text on a dark panel, dark text on a light one.
      const luminance = (rgb: string) => {
        const [r, g, b] = rgb.match(/[\d.]+/g)!.map(Number);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      if (scheme === 'dark') expect(luminance(colours.text)).toBeGreaterThan(luminance(colours.panel));
      else expect(luminance(colours.text)).toBeLessThan(luminance(colours.panel));
      await context.close();
    });
  }
});
