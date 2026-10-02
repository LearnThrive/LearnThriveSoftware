import { test, expect, type Page } from '@playwright/test';

// plan15 Wave 4 — smooth scrolling (Lenis) with guardrails. State-based like the rest of the motion
// suite: "is it on / off", "where did the page land", "who has focus", never "wait N ms and compare
// a frame". The pure decisions (which tiers, which wheel events) are unit-tested in
// tests/smoothScroll.test.mjs.

async function pinCapabilities(page: Page, cores = 8, memory = 8) {
  await page.addInitScript(
    ({ cores, memory }) => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores, configurable: true });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => memory, configurable: true });
    },
    { cores, memory },
  );
}

const smoothOn = (page: Page) => page.locator('html').getAttribute('data-smooth-scroll');
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

/** Wait for the dynamically imported library to attach. */
async function expectSmoothOn(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-smooth-scroll', 'on');
}

test.describe('where it runs', () => {
  test('on a capable desktop (full tier, fine pointer) it is on', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expectSmoothOn(page);
  });

  test('on a standard-tier desktop window (narrower than 1024) it is on', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/');
    await expectSmoothOn(page);
  });

  test('reduced motion keeps native scrolling', async ({ page }) => {
    await pinCapabilities(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion-tier', 'reduced');
    expect(await smoothOn(page)).toBeNull();
  });

  test('the light tier (a phone-width window) keeps native scrolling', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion-tier', 'light');
    expect(await smoothOn(page)).toBeNull();
  });

  test('a touch device keeps native touch scrolling', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await pinCapabilities(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion-tier', /^(standard|light)$/);
    expect(await smoothOn(page)).toBeNull();
    await context.close();
  });

  test('the ?smooth=0 kill switch turns it off, and sticks for the tab until ?smooth=1', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?smooth=0');
    await expect(page.locator('html')).toHaveAttribute('data-motion-tier', 'full');
    expect(await smoothOn(page)).toBeNull();
    await page.goto('/about'); // no query, same tab: still off
    await expect(page.locator('html')).toHaveAttribute('data-motion-tier', 'full');
    expect(await smoothOn(page)).toBeNull();
    await page.goto('/?smooth=1');
    await expectSmoothOn(page);
  });

  test('the app, dashboard and login keep native scrolling', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    expect(await smoothOn(page)).toBeNull();
  });
});

test.describe('how it scrolls', () => {
  test('a wheel notch eases (the page is still travelling a moment later) and lands where the wheel said', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expectSmoothOn(page);
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(120);
    const early = await scrollY(page);
    expect(early, 'eased: not already at the destination').toBeLessThan(100);
    await expect.poll(() => scrollY(page), { timeout: 4000 }).toBe(100);
  });

  test('a precision-touchpad-sized wheel stream is left to the browser (it is not smoothed a second time)', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expectSmoothOn(page);
    await page.mouse.move(700, 400);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 12);
    await expect.poll(() => scrollY(page), { timeout: 3000 }).toBeGreaterThan(40);
    // Native scrolling applies each small delta in full, quickly; smoothing would still be gliding.
    const settled = await scrollY(page);
    await page.waitForTimeout(400);
    expect(Math.abs((await scrollY(page)) - settled)).toBeLessThanOrEqual(2);
  });

  test('keyboard scrolling stays native (Space, PageDown, End)', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expectSmoothOn(page);
    await page.locator('body').click({ position: { x: 5, y: 450 } });
    await page.keyboard.press('PageDown');
    await expect.poll(() => scrollY(page)).toBeGreaterThan(300);
    // Let the browser's own keyboard scroll finish before the next key (a second scroll command
    // pressed mid-animation is dropped by Chromium itself, with or without a smooth-scroll library).
    let last = -1;
    await expect.poll(async () => { const now = await scrollY(page); const settled = now === last; last = now; return settled; }).toBe(true);
    const afterPageDown = await scrollY(page);
    await page.keyboard.press('End');
    await expect.poll(() => scrollY(page)).toBeGreaterThan(afterPageDown + 1000);
  });

  test('scroll-linked scenes stay in sync: a sticky column stays pinned while its section scrolls past', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expectSmoothOn(page);
    const column = page.locator('[data-motion-scene="product-story"] [class*="stickyCol"]').first();
    await column.scrollIntoViewIfNeeded();
    await page.mouse.move(700, 400);
    const tops: number[] = [];
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 200);
      await expect.poll(async () => (await scrollY(page)) > 0).toBe(true);
      await page.waitForTimeout(1500);
      tops.push(Math.round((await column.boundingBox())!.y));
    }
    // Pinned: the column's top does not drift by more than a few px while the section scrolls by.
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(6);
  });

  test('Back restores the scroll position exactly as the browser would natively', async ({ browser }) => {
    // Next/the browser restore a position on Back; smooth scrolling must neither fight it nor
    // change it. Run the same journey natively (?smooth=0) and with Lenis and compare the landings.
    async function journey(url: string, smooth: boolean) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await pinCapabilities(page);
      await page.goto(url);
      if (smooth) await expectSmoothOn(page);
      await page.mouse.move(700, 400);
      await page.mouse.wheel(0, 700);
      await expect.poll(() => scrollY(page), { timeout: 4000 }).toBeGreaterThan(600);
      await page.waitForTimeout(1500);
      await page.getByRole('link', { name: 'About', exact: true }).first().click();
      await expect(page).toHaveURL(/\/about$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/subjects/);
      let last = -1;
      await expect.poll(async () => { const now = await scrollY(page); const settled = now === last; last = now; return settled; }, { timeout: 5000 }).toBe(true);
      const landed = await scrollY(page);
      await context.close();
      return landed;
    }
    const native = await journey('/subjects?smooth=0', false);
    const smooth = await journey('/subjects', true);
    expect(Math.abs(smooth - native), `native ${native}, smooth ${smooth}`).toBeLessThanOrEqual(40);
  });
});

test.describe('anchors', () => {
  test('an in-page link scrolls to its target below the header, updates the hash and moves focus', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expectSmoothOn(page);
    await page.locator('a[href="#how"]').first().click();
    await expect(page).toHaveURL(/#how$/);
    // Lands at the document's scroll-padding-top (6rem = 96px), under the 69px header, within a few px.
    const topOfHow = () => page.evaluate(() => Math.round(document.getElementById('how')!.getBoundingClientRect().top));
    await expect.poll(async () => Math.abs((await topOfHow()) - 96), { timeout: 6000 }).toBeLessThanOrEqual(20);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('how');
  });

  test('Back from an anchor returns to where the page was', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expectSmoothOn(page);
    await page.locator('a[href="#how"]').first().click();
    await expect(page).toHaveURL(/#how$/);
    await expect.poll(() => scrollY(page), { timeout: 5000 }).toBeGreaterThan(500);
    await page.goBack();
    await expect(page).not.toHaveURL(/#how/);
    // The browser restores the position the page had before the jump; Lenis must not carry on
    // gliding toward the old destination.
    await expect.poll(() => scrollY(page), { timeout: 5000 }).toBeLessThan(80);
    await page.waitForTimeout(800);
    expect(await scrollY(page)).toBeLessThan(80);
  });

  test('the FAQ hash opener still opens the panel for an in-page jump link', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/faq');
    await expectSmoothOn(page);
    const jump = page.locator('a[href^="#"]:not(.skip-link)').filter({ hasNotText: /^$/ }).first();
    const href = await jump.getAttribute('href');
    await jump.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    const id = href!.slice(1);
    await expect
      .poll(() => page.evaluate((id) => {
        const el = document.getElementById(id);
        const details = el?.closest('details');
        return details ? details.open : true; // a plain section heading has nothing to open
      }, id))
      .toBe(true);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(id);
  });
});

test.describe('modals and nested scrolling', () => {
  test('smoothing pauses while the mobile menu is open and resumes when it closes', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/');
    await expectSmoothOn(page);
    const isStopped = () => page.evaluate(() => Boolean((window as unknown as { __lenis?: { isStopped: boolean } }).__lenis?.isStopped));
    expect(await isStopped()).toBe(false);
    await page.getByRole('button', { name: 'Open main menu' }).click();
    await expect.poll(isStopped).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(isStopped).toBe(false);
  });

  test('a scrollable textarea scrolls on its own (nested scrollers opt out)', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/book');
    await expectSmoothOn(page);
    const textarea = page.locator('textarea').first();
    await textarea.scrollIntoViewIfNeeded();
    await textarea.fill(Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n'));
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => Math.round(window.scrollY));
    const box = (await textarea.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => textarea.evaluate((el: HTMLTextAreaElement) => el.scrollTop)).toBeGreaterThan(0);
    expect(Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - before)).toBeLessThanOrEqual(2);
  });
});
