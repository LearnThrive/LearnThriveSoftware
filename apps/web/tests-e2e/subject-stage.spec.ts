import { test, expect, type Page } from '@playwright/test';

// plan15 Wave 9 section 13.1: the subject worlds. Each subject page has its own stage; on the full tier it is
// driven by scroll (and, for maths, the cursor); everywhere else, and under reduced motion, it is the finished
// picture. Decorative SVG is aria-hidden; the English sample is real text.

const SUBJECTS = [
  { path: '/maths-tuition', kind: 'maths' },
  { path: '/english-tuition', kind: 'english' },
  { path: '/science-tuition', kind: 'science' },
  { path: '/11-plus-tuition', kind: '11-plus' },
] as const;

const stage = (page: Page, kind: string) => page.locator(`[data-stage="${kind}"]`);

async function scrollStageTo(page: Page, kind: string, fraction: number) {
  // Put the stage's centre at `fraction` of the viewport height (0 = top edge, 1 = bottom edge).
  await page.evaluate(
    ({ kind: k, fraction: f }) => {
      const el = document.querySelector(`[data-stage="${k}"]`) as HTMLElement;
      const rect = el.getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + rect.top + rect.height / 2 - window.innerHeight * f, behavior: 'instant' });
    },
    { kind, fraction },
  );
  await page.waitForTimeout(500);
}

test.describe('each subject has its own stage', () => {
  for (const { path, kind } of SUBJECTS) {
    test(`${path}: a ${kind} stage is in the served HTML, finished and legible with no JavaScript`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.goto(path);
      await expect(stage(page, kind)).toHaveCount(1);
      if (kind === 'maths') await expect(stage(page, kind).locator('path').nth(1)).toHaveAttribute('d', /^M\d/);
      if (kind === 'english') await expect(stage(page, kind)).toContainText('It was the best of times');
      if (kind === 'science') await expect(stage(page, kind)).toContainText('Observe');
      await context.close();
    });

    test(`${path}: the picture is decorative (aria-hidden) except the English sample, which is real text`, async ({ page }) => {
      await page.goto(path);
      if (kind === 'english') {
        await expect(stage(page, kind).getByRole('figure')).toBeVisible();
        await expect(stage(page, kind).getByText('Charles Dickens', { exact: false })).toBeVisible();
      } else {
        await expect(stage(page, kind).locator('svg')).toHaveAttribute('aria-hidden', 'true');
      }
    });

    test(`${path}: under reduced motion nothing moves and the stage is the finished picture`, async ({ browser }) => {
      const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.goto(path);
      await expect(stage(page, kind)).toHaveAttribute('data-stage-active', 'false');
      await scrollStageTo(page, kind, 0.5);
      if (kind === 'maths') {
        await expect(stage(page, kind).locator('text')).toHaveText(/^\(\d\.\d, \d\.\d\)$/);
        const before = await stage(page, kind).locator('circle').getAttribute('cx');
        await scrollStageTo(page, kind, 0.9);
        expect(await stage(page, kind).locator('circle').getAttribute('cx')).toBe(before);
      }
      await context.close();
    });

    test(`${path}: no horizontal overflow at 360 px and no console errors`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(path);
      await scrollStageTo(page, kind, 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
});

test.describe('on the full tier it responds to scroll', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('maths: the marker travels along the curve as the section scrolls', async ({ page }) => {
    await page.goto('/maths-tuition');
    await expect(stage(page, 'maths')).toHaveAttribute('data-stage-active', 'true');
    const marker = stage(page, 'maths').locator('circle');
    await scrollStageTo(page, 'maths', 1.1); // below the fold: not started
    const early = Number(await marker.getAttribute('cx'));
    await scrollStageTo(page, 'maths', 0.1); // well past the middle
    await expect.poll(async () => Number(await marker.getAttribute('cx'))).toBeGreaterThan(early + 60);
  });

  test('maths: on a fine pointer the marker follows the cursor, and goes back to scrolling when it leaves', async ({ page }) => {
    await page.goto('/maths-tuition');
    await scrollStageTo(page, 'maths', 0.5);
    const svg = stage(page, 'maths').locator('svg');
    const box = (await svg.boundingBox())!;
    const marker = stage(page, 'maths').locator('circle');
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.5);
    await expect.poll(async () => Number(await marker.getAttribute('cx'))).toBeLessThan(250);
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.92, box.y + box.height * 0.5);
    await expect.poll(async () => Number(await marker.getAttribute('cx'))).toBeGreaterThan(450);
  });

  test('science: the signal is only drawn while it travels; 11+: the flags plant as the route is drawn', async ({ page }) => {
    await page.goto('/science-tuition');
    await scrollStageTo(page, 'science', 0.45);
    await expect.poll(async () => stage(page, 'science').locator('circle').last().evaluate((el) => getComputedStyle(el).opacity)).not.toBe('0');

    await page.goto('/11-plus-tuition');
    await scrollStageTo(page, '11-plus', 1.1);
    const poleBefore = Number(await stage(page, '11-plus').locator('line').first().getAttribute('y2'));
    await scrollStageTo(page, '11-plus', 0.05);
    await expect.poll(async () => Number(await stage(page, '11-plus').locator('line').first().getAttribute('y2'))).toBeLessThan(poleBefore - 20);
  });
});
