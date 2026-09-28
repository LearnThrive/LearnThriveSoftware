import { test, expect } from '@playwright/test';
import { installReactCommitCounter, reactCommits, resetReactCommits } from './support';

// plan11.md task 4: a value that changes every animation frame must not travel through React state.
// Two ways to check that. The static ones (tests/micLevel.test.mjs, the source guards) catch a
// regression in the source; these catch it in the running page, by counting the commits React
// actually performed while the animation played.

const STAT = '[class*="statsStrip"] b';

test.describe('StatCounter', () => {
  test('the served HTML already contains the real number, never a placeholder zero', async ({ request }) => {
    const html = await (await request.get('/')).text();
    expect(html).toMatch(/<b[^>]*>40\+<\/b>/);
    expect(html).not.toMatch(/<b[^>]*>0\+<\/b>/);
  });

  test('counts up on scroll-in, ends on the real value, and never re-renders React per frame', async ({ page }) => {
    await installReactCommitCounter(page);
    await page.goto('/');
    const stat = page.locator(STAT).first();
    await expect(stat).toHaveText('40+');

    // Park just short of the stats so the count-up starts on the next small scroll, and let
    // everything the scroll passed through (scenes, reveals) settle before counting commits.
    await page.evaluate(() => {
      const el = document.querySelector('[class*="statsStrip"]') as HTMLElement;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight - 40, behavior: 'instant' });
    });
    await page.waitForTimeout(800);

    await page.evaluate((selector) => {
      const el = document.querySelector(selector) as HTMLElement;
      (window as unknown as { __statWrites: number }).__statWrites = 0;
      new MutationObserver((records) => {
        (window as unknown as { __statWrites: number }).__statWrites += records.length;
      }).observe(el, { childList: true, characterData: true, subtree: true });
    }, STAT);
    await resetReactCommits(page);

    await page.evaluate(() => window.scrollBy({ top: 200, behavior: 'instant' }));
    await expect(stat).toHaveText('40+');
    await page.waitForTimeout(1400); // the 900 ms count, plus margin

    const writes = await page.evaluate(() => (window as unknown as { __statWrites: number }).__statWrites);
    const commits = await reactCommits(page);
    expect(writes, 'the number should have visibly counted through several values').toBeGreaterThan(5);
    expect(commits, `React committed ${commits} times during a ${writes}-step count`).toBeLessThan(10);
  });

  test('under reduced motion the number never changes at all', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const stat = page.locator(STAT).first();
    await expect(stat).toHaveText('40+');
    await page.evaluate((selector) => {
      const el = document.querySelector(selector) as HTMLElement;
      (window as unknown as { __statWrites: number }).__statWrites = 0;
      new MutationObserver((records) => {
        (window as unknown as { __statWrites: number }).__statWrites += records.length;
      }).observe(el, { childList: true, characterData: true, subtree: true });
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
    }, STAT);
    await page.waitForTimeout(1400);
    expect(await page.evaluate(() => (window as unknown as { __statWrites: number }).__statWrites)).toBe(0);
    await expect(stat).toHaveText('40+');
  });
});
