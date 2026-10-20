import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// plan19 section 7 (PencilLoader): the bench at /dev/ui-components/pencil-loader. axe in both themes and
// each state, the status role and its text, per-instance clip ids, no infinite animation under any of the
// three "reduce" mechanisms, paused off screen, no overflow at 360 and at 200% zoom, no console errors.

const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const WCAG22 = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const BENCH = '/dev/ui-components/pencil-loader';

async function expectNoAxeViolations(page: Page, label: string) {
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = (await page.evaluate(async (tags) => {
    // @ts-expect-error injected global, no types installed for the browser build
    return await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
  }, WCAG22)) as { violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> };
  const summary = results.violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
    .join('\n\n');
  expect(results.violations, `${label}: ${summary}`).toEqual([]);
}

/** Every CSS animation on the page that repeats forever. */
const infiniteAnimations = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity)
      .map((animation) => (animation as CSSAnimation).animationName),
  );

async function open(page: Page) {
  await page.goto(BENCH);
  await expect(page.getByRole('heading', { level: 1, name: 'PencilLoader' })).toBeVisible();
  // The motion runtime writes the tier once hydrated; wait for it so a later assertion is not racing it.
  await expect(page.locator('html')).toHaveAttribute('data-motion-tier', /.+/);
}

test.describe('PencilLoader', () => {
  test('status role and text: each indicator is a status with its words', async ({ page }) => {
    await open(page);
    const statuses = page.locator('main').getByRole('status');
    await expect(statuses).toHaveCount(10);
    await expect(page.locator('[data-case="default"]').getByRole('status')).toHaveText('Loading');
    await expect(page.locator('[data-case="label"]').getByRole('status')).toHaveText('Loading your library');
    await expect(page.locator('[data-case="thinking"]').getByRole('status')).toHaveText('Thinking…');
    // The picture is hidden from assistive technology and cannot take focus.
    const svgs = page.locator('main svg[aria-hidden="true"]');
    await expect(svgs).toHaveCount(10);
    expect(await page.locator('main svg[tabindex], main svg a, main [role="status"] [tabindex]').count()).toBe(0);
  });

  test('keyboard only: the indicators add no tab stops', async ({ page }) => {
    await open(page);
    expect(await page.locator('main').evaluate((main) => main.querySelectorAll('a, button, input, select, textarea, [tabindex]').length)).toBe(0);
    await page.keyboard.press('Tab');
    const inMain = await page.evaluate(() => !!document.activeElement?.closest('main'));
    expect(inMain).toBe(false);
  });

  test('clip path ids are unique across instances and every url(#id) resolves to its own clipPath', async ({ page }) => {
    await open(page);
    const result = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('main clipPath')].map((node) => node.id);
      const refs = [...document.querySelectorAll('main [clip-path]')].map((node) => node.getAttribute('clip-path') ?? '');
      return {
        ids,
        refs,
        resolved: refs.map((ref) => {
          const id = /^url\(#(.+)\)$/.exec(ref)?.[1];
          return !!id && document.querySelectorAll(`#${CSS.escape(id)}`).length === 1;
        }),
      };
    });
    expect(result.ids).toHaveLength(10);
    expect(new Set(result.ids).size).toBe(10);
    for (const id of result.ids) expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(result.resolved.every(Boolean)).toBe(true);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe clean in the ${scheme} theme (animating, then reduced)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      if (scheme === 'dark') await expect(page.locator('html')).toHaveAttribute('data-themes', 'on');
      await expectNoAxeViolations(page, `${scheme} animating`);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await expectNoAxeViolations(page, `${scheme} reduced`);
    });
  }

  test('motion runs when allowed (sanity: the check below is not vacuous)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page);
    const names = await infiniteAnimations(page);
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((name) => name.endsWith('pencilRotate'))).toBe(true);
  });

  test('prefers-reduced-motion: no infinite animation and the pencil is a still pose', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    expect(await infiniteAnimations(page)).toEqual([]);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    const pose = await stillPose(page);
    expect(pose.body1).toBe('150.8px');
    expect(pose.stroke).toBe('164.93px');
    await expect(page.getByRole('status').first()).toBeVisible();
  });

  // The still pose is the finished drawing (the animation's 50% frame), not the empty first frame: the
  // pencil body is drawn round the circle, so a reduced-motion visitor sees a complete pencil, not a speck.
  const stillPose = (page: Page) =>
    page.evaluate(() => {
      const svg = document.querySelector('[data-case="default"] svg')!;
      const read = (selector: string, property: 'strokeDashoffset' | 'transform') =>
        getComputedStyle(svg.querySelector(selector)!)[property];
      return {
        animations: document.getAnimations().length,
        body1: read('[class*="body1"]', 'strokeDashoffset'),
        stroke: read('[class*="stroke"]', 'strokeDashoffset'),
        point: read('[class*="point"]', 'transform'),
      };
    });

  test('the visitor Reduce choice (html[data-motion=reduce]) alone stops the animation, leaving the finished pencil', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page);
    expect((await infiniteAnimations(page)).length).toBeGreaterThan(0);
    await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'reduce'));
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    const pose = await stillPose(page);
    expect(pose.body1).toBe('150.8px');
    expect(pose.stroke).toBe('164.93px');
    expect(pose.point).not.toBe('none');
  });

  test('the "reduced" motion tier alone stops the animation, leaving the finished pencil', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page);
    expect((await infiniteAnimations(page)).length).toBeGreaterThan(0);
    await page.evaluate(() => (document.documentElement.dataset.motionTier = 'reduced'));
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    const pose = await stillPose(page);
    expect(pose.body1).toBe('150.8px');
    expect(pose.stroke).toBe('164.93px');
  });

  test('paused while off screen, running once scrolled into view', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page);
    const states = () =>
      page.evaluate(() => {
        const below = document.querySelector('[data-case="below-fold"] [role="status"]');
        const top = document.querySelector('[data-case="default"] [role="status"]');
        const play = (root: Element | null) => [...new Set(root?.getAnimations({ subtree: true }).map((animation) => animation.playState))];
        return { below: play(below), top: play(top) };
      });
    await expect.poll(states).toEqual({ below: ['paused'], top: ['running'] });
    await page.locator('[data-case="below-fold"] [role="status"]').scrollIntoViewIfNeeded();
    await expect.poll(states).toMatchObject({ below: ['running'] });
  });

  test('only transform and opacity are animated', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page);
    const properties = await page.evaluate(() => [
      ...new Set(
        document
          .getAnimations()
          .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes().flatMap((frame) => Object.keys(frame)))
          .filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)),
      ),
    ]);
    expect(properties.sort()).toEqual(['opacity', 'transform']);
  });

  for (const [name, width, height] of [
    ['360px', 360, 740],
    ['200% zoom of a 1280px window (640px)', 640, 480],
    ['200% zoom of a 640px window (320px)', 320, 480],
  ] as const) {
    test(`no horizontal scroll at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await open(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('forced colours: the pencil keeps its parts apart and nothing disappears', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await open(page);
    const fills = await page.evaluate(() =>
      [...document.querySelectorAll('[data-case="default"] svg [class*="graphite"], [data-case="default"] svg [class*="ferrule"]')].map((node) =>
        getComputedStyle(node).fill,
      ),
    );
    expect(new Set(fills).size).toBeGreaterThan(1);
    await expectNoAxeViolations(page, 'forced colours');
  });

  test('renders without console errors or page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    await open(page);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
});
