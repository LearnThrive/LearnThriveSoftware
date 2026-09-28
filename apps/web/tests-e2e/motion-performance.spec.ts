import { test, expect, type ConsoleMessage } from '@playwright/test';

// plan11.md task 1: the motion debug overlay is a development instrument, so the assertions that
// matter are about *when it exists* and *that it can never get in the way* — not its pixels. The
// arithmetic behind its numbers (cadence, p95, dropped frames) is unit-tested in
// tests/motion.test.mjs; the gating rule itself is unit-tested there too. What only a real browser
// can prove is exercised here: the query string really is what opens it, it really does render
// nothing otherwise, it really does let clicks through, and it really does hydrate cleanly.
//
// These run against the dev server (playwright.config.ts), which is precisely the environment the
// overlay is allowed in without a build-time opt-in.

const OVERLAY = '[data-motion-debug]';

test.describe('motion debug overlay — gating', () => {
  test('renders nothing on an ordinary visit', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  for (const search of ['?motionDebug=0', '?motionDebug=true', '?motionDebug=', '?motion=1']) {
    test(`renders nothing for ${search}`, async ({ page }) => {
      await page.goto(`/${search}`);
      await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator(OVERLAY)).toHaveCount(0);
    });
  }

  test('appears with ?motionDebug=1 on any public route', async ({ page }) => {
    await page.goto('/subjects?motionDebug=1');
    const overlay = page.locator(OVERLAY);
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('[data-field="route"]')).toHaveText('/subjects');
  });
});

test.describe('motion debug overlay — readout', () => {
  test('reports a measured cadence, the motion tier, and the document state', async ({ page }) => {
    await page.goto('/?motionDebug=1');
    const overlay = page.locator(OVERLAY);
    await expect(overlay).toBeVisible();

    // The cadence is inferred from real frames, so it starts as "measuring…" and becomes a number.
    await expect(overlay.locator('[data-field="hz"]')).toHaveText(/^\d+ Hz \(\d+\.\d ms\)$/, { timeout: 15_000 });
    await expect(overlay.locator('[data-field="tier"]')).toHaveText(/^(full|standard|light|reduced)$/);
    await expect(overlay.locator('[data-field="visibility"]')).toHaveText('visible');
    await expect(overlay.locator('[data-field="reduced"]')).toHaveText('off');
    await expect(overlay.locator('[data-field="dropped"]')).toHaveText(/^\d+\.\d% \(\d+\)$/);
    await expect(overlay.locator('[data-field="route"]')).toHaveText('/');
  });

  test('reflects the reduced-motion preference', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?motionDebug=1');
    const overlay = page.locator(OVERLAY);
    await expect(overlay.locator('[data-field="reduced"]')).toHaveText('on');
    await expect(overlay.locator('[data-field="tier"]')).toHaveText('reduced');
  });

  test('names the scene that is on screen', async ({ page }) => {
    await page.goto('/?motionDebug=1');
    // At the top of the homepage the only labelled scene in view is the hero.
    await expect(page.locator(`${OVERLAY} [data-field="scene"]`)).toHaveText('hero');
  });
});

test.describe('motion debug overlay — never gets in the way', () => {
  test('is hidden from the accessibility tree and ignores the pointer', async ({ page }) => {
    await page.goto('/?motionDebug=1');
    const overlay = page.locator(OVERLAY);
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');
    await expect(overlay).toHaveCSS('pointer-events', 'none');
    // Nothing inside it can take focus, so it can never join the tab order.
    await expect(overlay.locator('a, button, input, select, textarea, [tabindex]')).toHaveCount(0);
  });

  test('a click on the page beneath it lands on the page, not on the overlay', async ({ page }) => {
    await page.goto('/?motionDebug=1');
    const overlay = page.locator(OVERLAY);
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    expect(box).not.toBeNull();
    const centre = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    const hitIsOverlay = await page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      const panel = document.querySelector('[data-motion-debug]');
      return !!(hit && panel && panel.contains(hit));
    }, centre);
    expect(hitIsOverlay, 'elementFromPoint must skip a pointer-events:none overlay').toBe(false);
  });

  test('hydrates cleanly with the overlay on', async ({ page }) => {
    const problems: string[] = [];
    const record = (message: ConsoleMessage) => {
      if (['error', 'warning'].includes(message.type()) && /hydrat/i.test(message.text())) {
        problems.push(message.text());
      }
    };
    page.on('console', record);
    page.on('pageerror', (error) => problems.push(error.message));

    await page.goto('/?motionDebug=1');
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(`${OVERLAY} [data-field="hz"]`)).toHaveText(/ Hz /, { timeout: 15_000 });
    expect(problems).toEqual([]);
  });
});
