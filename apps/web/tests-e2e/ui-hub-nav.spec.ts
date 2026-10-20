import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { hydrated } from './careers-support';

// plan19.md section 7 (the Radio bullet): HubNav, the signed-in Library area's icon menu. Runs against the dev
// bench at /dev/ui-components/hub-nav: a gallery of every current item, one URL-derived instance and one live
// instance pinned to the edge whose links are same-page anchors.

const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const WCAG22 = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const PATH = '/dev/ui-components/hub-nav';
const LABELS = ['Home', 'Library', 'Study Buddy', 'Search', 'Account'];

async function runAxe(page: Page, label: string) {
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = (await page.evaluate(async (values) => {
    // @ts-expect-error injected global, no types installed for the browser build
    return await window.axe.run(document, { runOnly: { type: 'tag', values } });
  }, WCAG22)) as { violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> };
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
      .join('\n\n');
    throw new Error(`${label}: ${results.violations.length} accessibility violation(s)\n\n${summary}`);
  }
}

async function open(page: Page, width: number, scheme: 'light' | 'dark', reducedMotion: 'reduce' | 'no-preference' = 'reduce', height = 800) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion });
  await page.goto(PATH);
  await hydrated(page);
}

const live = (page: Page) => page.getByRole('navigation', { name: 'Library menu, live' });
const liveLink = (page: Page, label: string) => live(page).getByRole('link', { name: label });
const labelOpacity = (page: Page, label: string) =>
  liveLink(page, label).locator('span').last().evaluate((node) => Number(getComputedStyle(node).opacity));

/** One Tab first so the browser is in keyboard modality, then focus(): that is what makes :focus-visible match. */
async function focusByKeyboard(page: Page, label: string) {
  await page.keyboard.press('Tab');
  await liveLink(page, label).focus();
}

test.describe('HubNav', () => {
  for (const width of [360, 1280]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`axe clean at ${width}px, ${scheme}, including a focused item`, async ({ page }) => {
        await open(page, width, scheme);
        await runAxe(page, `${width}px ${scheme}`);

        // The same page with a label open by keyboard focus (focused text, outline and the open pill are checked).
        await page.keyboard.press('Tab');
        await focusByKeyboard(page, 'Search');
        await expect(liveLink(page, 'Search')).toBeFocused();
        await runAxe(page, `${width}px ${scheme}, focused`);
      });
    }
  }

  test('every item of every state is a real link with the right aria-current', async ({ page }) => {
    await open(page, 1280, 'light');
    for (const current of LABELS) {
      const slug = current.toLowerCase().replace(/\s+/g, '-');
      const nav = page.getByTestId(`state-${slug}`).getByRole('navigation');
      await expect(nav.getByRole('link')).toHaveCount(5);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(nav.getByRole('link', { name: current })).toHaveAttribute('aria-current', 'page');
      expect(await nav.getByRole('link').evaluateAll((links) => links.map((a) => a.tagName + ':' + a.getAttribute('href')))).toEqual([
        'A:/',
        'A:/library',
        'A:/library/study-buddy',
        'A:/library/search',
        'A:/account',
      ]);
    }
  });

  test('without a current prop the longest matching path is current', async ({ page }) => {
    await open(page, 1280, 'light');
    const nav = page.getByTestId('state-derived').getByRole('navigation');
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: 'Hub nav' })).toHaveAttribute('aria-current', 'page');
  });

  for (const width of [360, 1280]) {
    test(`keyboard only at ${width}px: Tab reaches all five in order, the label opens on focus, Enter navigates`, async ({ page }) => {
      await open(page, width, 'light');
      // Tab until the live menu's first link has focus (the gallery menus come first in the page).
      for (let i = 0; i < 60; i += 1) {
        await page.keyboard.press('Tab');
        if (await liveLink(page, 'Home').evaluate((node) => node === document.activeElement)) break;
      }
      await expect(liveLink(page, 'Home')).toBeFocused();

      for (const [index, label] of LABELS.entries()) {
        if (index > 0) await page.keyboard.press('Tab');
        const link = liveLink(page, label);
        await expect(link).toBeFocused();
        // Visible focus: a real outline.
        expect(await link.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
        expect(await link.evaluate((node) => parseFloat(getComputedStyle(node).outlineWidth))).toBeGreaterThanOrEqual(2);
        // The focused item's label is visible. On the wide pointer rail the current item (Home) closes while
        // another is focused; on the bar every label is always visible.
        await expect.poll(() => labelOpacity(page, label)).toBe(1);
        if (index > 0) await expect.poll(() => labelOpacity(page, 'Home')).toBe(width >= 1024 ? 0 : 1);
        const box = (await link.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }

      // Enter on Search follows the link and the current item moves to it.
      await liveLink(page, 'Search').focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#live-search$/);
      await expect(liveLink(page, 'Search')).toHaveAttribute('aria-current', 'page');
      await expect(liveLink(page, 'Home')).not.toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('live-status')).toHaveText('Last activated: Search');
    });
  }

  test('narrow bar: every label is visible with no hover or focus (touch has neither), whole and not clipped', async ({ page }) => {
    for (const width of [320, 360, 640]) {
      await open(page, width, 'light');
      for (const label of LABELS) {
        expect(await labelOpacity(page, label), `${label} at ${width}px`).toBe(1);
        const text = liveLink(page, label).locator('span').last();
        const clipped = await text.evaluate((node) => node.scrollWidth > node.clientWidth + 1);
        expect(clipped, `${label} clipped at ${width}px`).toBe(false);
        const box = (await liveLink(page, label).boundingBox())!;
        expect(box.height, `${label} height at ${width}px`).toBeGreaterThanOrEqual(44);
        expect(box.width, `${label} width at ${width}px`).toBeGreaterThanOrEqual(44);
        await expect(liveLink(page, label)).toHaveAccessibleName(label);
      }
    }
  });

  test('wide rail with a pointer: only the current item shows its label; the others are icon-only but named', async ({ page }) => {
    await open(page, 1280, 'light');
    expect(await labelOpacity(page, 'Home')).toBe(1);
    for (const label of LABELS.slice(1)) {
      expect(await labelOpacity(page, label)).toBe(0);
      // Collapsed links still carry their name for assistive technology.
      await expect(liveLink(page, label)).toHaveAccessibleName(label);
    }
  });

  test.describe('touch device', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('a wide touch screen (a tablet in landscape) gets a rail with every label visible, not hover-dependent', async ({ page }) => {
      await open(page, 1280, 'light');
      expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
      for (const label of LABELS) {
        expect(await labelOpacity(page, label), label).toBe(1);
        const box = (await liveLink(page, label).boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        const text = liveLink(page, label).locator('span').last();
        expect(await text.evaluate((node) => node.scrollWidth > node.clientWidth + 1), `${label} clipped`).toBe(false);
      }
      const nav = (await live(page).boundingBox())!;
      expect(nav.x).toBeLessThan(40);
      expect(nav.width).toBeLessThan(110);
      await runAxe(page, 'touch rail, light');
      await open(page, 1280, 'dark');
      await runAxe(page, 'touch rail, dark');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });

    test('a tap navigates and the item does not stay stuck open or hovered', async ({ page }) => {
      await open(page, 360, 'light');
      await liveLink(page, 'Search').tap();
      await expect(page.getByTestId('live-status')).toHaveText('Last activated: Search');
      await expect(liveLink(page, 'Search')).toHaveAttribute('aria-current', 'page');
      expect(await liveLink(page, 'Library').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    });
  });

  test('narrow: a bar pinned to the bottom edge; wide: a rail pinned to the start edge', async ({ page }) => {
    await open(page, 360, 'light');
    let box = (await live(page).boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(800);
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.width)).toBe(360);

    await open(page, 1280, 'light');
    box = (await live(page).boundingBox())!;
    expect(box.x).toBeLessThan(40);
    expect(box.width).toBeLessThan(80);
    expect(box.height).toBeGreaterThan(200);
  });

  test('opening an item does not move the menu or the page (no layout shift)', async ({ page }) => {
    for (const width of [360, 1280]) {
      await open(page, width, 'light');
      const before = await live(page).boundingBox();
      const heading = await page.getByRole('heading', { name: 'Each current item' }).boundingBox();
      await focusByKeyboard(page, 'Study Buddy');
      await expect.poll(() => labelOpacity(page, 'Study Buddy')).toBe(1);
      expect(await live(page).boundingBox()).toEqual(before);
      expect(await page.getByRole('heading', { name: 'Each current item' }).boundingBox()).toEqual(heading);
    }
  });

  test('hover opens a label on a pointer device (1280px) and closes the current one', async ({ page }) => {
    await open(page, 1280, 'light');
    await liveLink(page, 'Library').hover();
    await expect.poll(() => labelOpacity(page, 'Library')).toBe(1);
    await expect.poll(() => labelOpacity(page, 'Home')).toBe(0);
    await page.mouse.move(700, 600);
    await expect.poll(() => labelOpacity(page, 'Library')).toBe(0);
    await expect.poll(() => labelOpacity(page, 'Home')).toBe(1);
  });

  for (const width of [320, 360, 640, 1280]) {
    test(`no horizontal scroll at ${width}px (640px stands for 200% zoom of a 1280px window), every state open`, async ({ page }) => {
      await open(page, width, 'light');
      for (const label of LABELS) {
        await focusByKeyboard(page, label);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `focused ${label}`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('forced colours: the current item and a focused item stay distinguishable', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(PATH);
    await hydrated(page);
    const current = await liveLink(page, 'Home').evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, colour: style.color };
    });
    const other = await liveLink(page, 'Account').evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, colour: style.color };
    });
    expect(current).not.toEqual(other);
    await focusByKeyboard(page, 'Account');
    expect(await liveLink(page, 'Account').evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
  });

  test.describe('reduced motion', () => {
    const transitionTime = (page: Page) =>
      liveLink(page, 'Library').evaluate((node) =>
        [node, node.querySelector('span:last-child')!].map((el) => getComputedStyle(el).transitionDuration),
      );

    // "0s", or the 0.01ms the site's own reduce rule writes: either way nothing is perceptible.
    const noTransition = (value: string) =>
      value.split(',').every((part) => (part.trim().endsWith('ms') ? parseFloat(part) : parseFloat(part) * 1000) <= 0.01);

    test('the OS setting: no transitions and no running animations', async ({ page }) => {
      await open(page, 360, 'light', 'reduce');
      expect((await transitionTime(page)).every(noTransition)).toBe(true);
      await focusByKeyboard(page, 'Library');
      await expect.poll(() => labelOpacity(page, 'Library')).toBe(1); // the final state, within a frame (the site's reduce rule is 0.01ms)
      // The site's global reduce rule leaves 0.01ms transitions (an inherited colour change on the svg is one): they
      // are imperceptible and end within a frame, so only an animation that lasts longer than that counts as running.
      const running = await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === 'running' && Number(a.effect?.getTiming().duration ?? 0) > 1).length,
      );
      expect(running).toBe(0);
    });

    test('the site toggle (html[data-motion=reduce]) and the reduced tier: no transitions', async ({ page }) => {
      await open(page, 360, 'light', 'no-preference');
      // Normal motion first: a transition is declared.
      expect((await transitionTime(page)).some((value) => /[1-9]/.test(value))).toBe(true);
      for (const attribute of ['data-motion', 'data-motion-tier']) {
        await page.evaluate((name) => {
          const root = document.documentElement;
          root.setAttribute('data-motion', 'auto');
          root.setAttribute('data-motion-tier', 'standard');
          root.setAttribute(name, name === 'data-motion' ? 'reduce' : 'reduced');
        }, attribute);
        expect((await transitionTime(page)).every(noTransition), attribute).toBe(true);
      }
    });
  });

  test('no console errors or page errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));
    await open(page, 360, 'dark');
    await liveLink(page, 'Account').click();
    await open(page, 1280, 'light');
    expect(problems).toEqual([]);
  });
});
