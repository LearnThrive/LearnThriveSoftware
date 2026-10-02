import { test, expect, type Page } from '@playwright/test';
import { PUBLIC_ROUTES } from './support';

// plan15 Wave 3 — System / Light / Dark. The dev server for this suite is started with
// NEXT_PUBLIC_THEME_TOGGLE=1 (playwright.config.ts), the flag that switches the whole feature on.

const DARK_CANVAS = 'rgb(10, 26, 43)'; // --surface-canvas, dark
const LIGHT_CANVAS = 'rgb(255, 255, 255)'; // --surface-canvas, light

const bodyBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const dataTheme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));

/** The footer's radio group is the full control; the header's button only cycles. */
async function chooseInFooter(page: Page, label: 'System' | 'Light' | 'Dark') {
  const group = page.getByRole('group', { name: 'Appearance' });
  await group.scrollIntoViewIfNeeded();
  await group.getByLabel(label).check({ force: true });
}

test.describe('System follows the OS, with no stored choice', () => {
  test('dark OS -> dark site, light OS -> light site, and no data-theme attribute is set', async ({ browser }) => {
    for (const [scheme, expected] of [['dark', DARK_CANVAS], ['light', LIGHT_CANVAS]] as const) {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await page.goto('/');
      expect(await dataTheme(page)).toBeNull();
      expect(await bodyBackground(page)).toBe(expected);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(scheme);
      await context.close();
    }
  });
});

test.describe('an explicit choice', () => {
  test('overrides the OS, persists across reload and client navigation, and System clears it', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto('/');
    expect(await bodyBackground(page)).toBe(LIGHT_CANVAS);

    await chooseInFooter(page, 'Dark');
    expect(await dataTheme(page)).toBe('dark');
    expect(await bodyBackground(page)).toBe(DARK_CANVAS);
    expect(await page.evaluate(() => localStorage.getItem('lt-theme'))).toBe('dark');

    // Client-side navigation: the attribute lives on <html>, which a route change never replaces.
    await page.getByRole('link', { name: 'About', exact: true }).first().click();
    await expect(page).toHaveURL(/\/about$/);
    expect(await dataTheme(page)).toBe('dark');
    expect(await bodyBackground(page)).toBe(DARK_CANVAS);

    // A full reload: the pre-paint script restores it.
    await page.reload();
    expect(await dataTheme(page)).toBe('dark');
    expect(await bodyBackground(page)).toBe(DARK_CANVAS);

    // And the footer control reflects the stored choice after hydration.
    await expect(page.getByRole('group', { name: 'Appearance' }).getByLabel('Dark')).toBeChecked();

    await chooseInFooter(page, 'System');
    expect(await dataTheme(page)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('lt-theme'))).toBeNull();
    expect(await bodyBackground(page)).toBe(LIGHT_CANVAS);
    await context.close();
  });

  test('Light overrides a dark OS', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto('/');
    expect(await bodyBackground(page)).toBe(DARK_CANVAS);
    await chooseInFooter(page, 'Light');
    expect(await dataTheme(page)).toBe('light');
    expect(await bodyBackground(page)).toBe(LIGHT_CANVAS);
    await context.close();
  });

  test('the header button cycles System -> Light -> Dark -> System and says so in its name', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto('/');
    const button = page.getByRole('button', { name: /^Colour theme:/ });
    await expect(button).toHaveAccessibleName('Colour theme: System. Switch to Light.');
    await button.click();
    await expect(button).toHaveAccessibleName('Colour theme: Light. Switch to Dark.');
    expect(await dataTheme(page)).toBe('light');
    await button.click();
    await expect(button).toHaveAccessibleName('Colour theme: Dark. Switch to System.');
    expect(await dataTheme(page)).toBe('dark');
    await expect(page.getByRole('status').filter({ hasText: 'Theme set to Dark' })).toHaveCount(1);
    await button.click();
    expect(await dataTheme(page)).toBeNull();
    await context.close();
  });

  test('the footer group is keyboard-operable like any radio group', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto('/');
    const group = page.getByRole('group', { name: 'Appearance' });
    await group.scrollIntoViewIfNeeded();
    await group.getByLabel('System').focus();
    await page.keyboard.press('ArrowRight');
    expect(await dataTheme(page)).toBe('light');
    await page.keyboard.press('ArrowRight');
    expect(await dataTheme(page)).toBe('dark');
    await context.close();
  });
});

test.describe('no flash', () => {
  test('a stored Dark is applied before the first paint, not after hydration', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    await context.addInitScript(() => {
      localStorage.setItem('lt-theme', 'dark');
      const w = window as unknown as { __themeAt?: number; __firstPaintAt?: number };
      // An init script runs before <html> exists, so observe the document itself.
      new MutationObserver(() => {
        if (w.__themeAt === undefined && document.documentElement?.getAttribute('data-theme')) w.__themeAt = performance.now();
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (entry.name === 'first-paint' && w.__firstPaintAt === undefined) w.__firstPaintAt = entry.startTime;
      }).observe({ type: 'paint', buffered: true });
    });
    const page = await context.newPage();
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __firstPaintAt?: number }).__firstPaintAt)).toBeDefined();
    const { themeAt, paintAt } = await page.evaluate(() => {
      const w = window as unknown as { __themeAt?: number; __firstPaintAt?: number };
      return { themeAt: w.__themeAt, paintAt: w.__firstPaintAt };
    });
    expect(themeAt, 'data-theme was set').toBeDefined();
    expect(themeAt!, 'data-theme set before the first paint').toBeLessThan(paintAt!);
    await context.close();
  });
});

test.describe('storage that throws', () => {
  test('the site still renders (System) when localStorage is unavailable', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    expect(await bodyBackground(page)).toBe(DARK_CANVAS);
    expect(errors.filter((message) => !/blocked/.test(message))).toEqual([]);
    await context.close();
  });
});

test.describe('every public route renders in dark', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route}: no white page, readable body text, no horizontal overflow`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(route);
      expect(await bodyBackground(page)).toBe(DARK_CANVAS);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      // No large light panel left over from a hard-coded colour: sample the layout for any visible
      // element wider than half the viewport whose background is near-white.
      const stray = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('body *')) {
          const rect = el.getBoundingClientRect();
          if (rect.width < innerWidth / 2 || rect.height < 40 || rect.bottom < 0) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
          const m = cs.backgroundColor.match(/[\d.]+/g);
          if (!m) continue;
          const [r, g, b, a = '1'] = m;
          if (+a > 0.9 && +r > 235 && +g > 235 && +b > 225) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${cs.backgroundColor}`);
        }
        return out;
      });
      expect(stray, 'near-white panels in the dark theme').toEqual([]);
      await context.close();
    });
  }
});
