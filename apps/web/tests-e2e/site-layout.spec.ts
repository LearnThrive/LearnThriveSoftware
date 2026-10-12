import { test, expect, type Page } from '@playwright/test';
import { PUBLIC_ROUTES } from './support';

// plan18: whole-site layout rules found by the audit of every public page (docs/UI_UX_AUDIT.md). Each one is a
// property of the page as a person sees it (nothing wider than the screen, no card alone on a row, copy that is
// spaced apart, buttons whose labels do not break), not a snapshot, so a layout that is wrong cannot be approved.

const ROUTES = [...PUBLIC_ROUTES, '/portal-opening-soon'];
const WIDTHS = [1440, 834, 390, 360];

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('no page is wider than the screen', () => {
  for (const route of ROUTES) {
    test(`${route} at ${WIDTHS.join(', ')}px`, async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        expect(await overflow(page), `${route} at ${width}px`).toBeLessThanOrEqual(0);
      }
    });
  }
});

type Box = { left: number; right: number; top: number; width: number };

/** Groups boxes into rows by their top edge. */
function rowsOf(boxes: Box[]): Box[][] {
  const rows = new Map<number, Box[]>();
  for (const box of boxes) rows.set(Math.round(box.top), [...(rows.get(Math.round(box.top)) ?? []), box]);
  return [...rows.values()];
}

test.describe('the trust hub', () => {
  // Reduced motion, so a card that fades in is where it will rest when it is measured.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  // Seven policies, which used to leave "Tuition terms" alone on the last row at two columns and at three. Safeguarding
  // is a banner across the row now, and the other six fill rows exactly.
  const measure = (page: Page) =>
    page.evaluate(() => {
      const list = document.querySelector('.trust-hub')!.getBoundingClientRect();
      const cards = [...document.querySelectorAll('.trust-hub > li')].map((li) => {
        const r = li.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, width: r.width };
      });
      return { list: { left: list.left, right: list.right, width: list.width }, cards };
    });

  for (const width of [1440, 1280, 1024, 834, 768, 700, 660, 640, 390, 360]) {
    test(`at ${width}px every row of cards fills the row, so none is left alone`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/trust');
      const { list, cards } = await measure(page);
      expect(cards).toHaveLength(7);
      for (const row of rowsOf(cards)) {
        const extent = Math.max(...row.map((card) => card.right)) - Math.min(...row.map((card) => card.left));
        expect(extent, `a row of ${row.length} at ${width}px`).toBeGreaterThanOrEqual(list.width - 2);
      }
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test('on a wide screen safeguarding leads across the full width and the other six are two rows of three', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/trust');
    const { cards } = await measure(page);
    const rows = rowsOf(cards);
    expect(rows.map((row) => row.length)).toEqual([1, 3, 3]);
    await expect(page.locator('.trust-hub > li').first()).toContainText('Safeguarding information');
  });

  test('every policy is still linked', async ({ page }) => {
    await page.goto('/trust');
    const hrefs = await page.locator('.trust-hub a').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(hrefs).toEqual(['/safeguarding', '/privacy', '/cookies', '/accessibility', '/complaints', '/terms', '/tuition-terms']);
  });
});

test.describe('the FAQ categories', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  // Five cards ahead of the wide last one would leave the fifth alone with half the row empty. It takes the row.
  for (const width of [1440, 1280, 1101, 1100, 834, 390]) {
    test(`at ${width}px no category card is left half a row wide with the other half empty`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/faq');
      const result = await page.evaluate(() => {
        const sections = [...document.querySelectorAll<HTMLElement>('section[id][aria-labelledby$="-title"]')];
        const grid = sections[0].parentElement!.parentElement!;
        const gridBox = grid.getBoundingClientRect();
        const style = getComputedStyle(grid);
        const inner = gridBox.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return {
          inner,
          cards: sections.map((section) => {
            const r = section.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, width: r.width };
          }),
        };
      });
      expect(result.cards).toHaveLength(6);
      // A card in a row of its own spans the row; cards in a shared row sit side by side and together fill it.
      for (const row of rowsOf(result.cards)) {
        const extent = Math.max(...row.map((card) => card.right)) - Math.min(...row.map((card) => card.left));
        expect(extent, `a row of ${row.length} card(s) at ${width}px`).toBeGreaterThanOrEqual(result.inner - 2);
      }
    });
  }
});

test.describe('the not-found page and the portal notice', () => {
  // Their copy sits in a wrapper beside the picture, which the paragraph's rule did not reach, so the paragraph touched
  // the heading above it and the buttons below it.
  for (const [route, label] of [['/portal-opening-soon', 'the portal notice'], ['/this-page-does-not-exist', 'the not-found page']] as const) {
    test(`${label}: the heading, the paragraph and the buttons are spaced apart`, async ({ page }) => {
      await page.goto(route);
      const gaps = await page.evaluate(() => {
        const heading = document.querySelector('.not-found h1')!.getBoundingClientRect();
        const text = document.querySelector('.not-found__inner p:not(.eyebrow)')!.getBoundingClientRect();
        const actions = document.querySelector('.not-found .button-group')!.getBoundingClientRect();
        return { headingToText: text.top - heading.bottom, textToActions: actions.top - text.bottom, textWidth: text.width };
      });
      expect(gaps.headingToText, 'heading to paragraph').toBeGreaterThanOrEqual(16);
      expect(gaps.textToActions, 'paragraph to buttons').toBeGreaterThanOrEqual(24);
    });
  }
});

test.describe('the home page', () => {
  // Both buttons are measured in one call. The hero rises into place for the first second, so two separate calls would
  // catch the second button a moment after the first, with the whole row a few pixels higher.
  const heroButtons = (page: Page) =>
    page.evaluate(() => {
      const links = [...document.querySelectorAll('a')];
      const find = (test: (text: string) => boolean) => {
        const r = links.find((a) => test((a.textContent ?? '').trim()))!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return {
        send: find((text) => text.startsWith('Send an enquiry')),
        how: find((text) => text === 'How it works'),
      };
    });

  test('on a phone the two hero buttons stack, each on one line and the width of the column', async ({ page }) => {
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      const { send: a, how: b } = await heroButtons(page);
      expect(a.height, `"Send an enquiry" on one line at ${width}px`).toBeLessThan(70);
      expect(b.height, `"How it works" on one line at ${width}px`).toBeLessThan(70);
      expect(b.y, 'stacked').toBeGreaterThan(a.y + a.height - 1);
      expect(Math.abs(a.width - b.width), 'the same width').toBeLessThan(2);
    }
  });

  test('from a tablet up they sit side by side', async ({ page }) => {
    for (const width of [834, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const { send: a, how: b } = await heroButtons(page);
      expect(b.x, `side by side at ${width}px`).toBeGreaterThan(a.x + a.width - 1);
      expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)), 'on one line').toBeLessThan(4);
    }
  });

  test('every section keeps the same side gutter on a phone, so no quote or card is squeezed into a narrow column', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const gutters = await page.evaluate(() =>
      ['whySection', 'subjectsSection', 'levelsSection', 'productSection', 'trustSection', 'testimonialsSection', 'enquirySection'].map((name) => {
        const el = document.querySelector(`[class*="${name}"]`);
        return { name, left: el ? parseFloat(getComputedStyle(el).paddingLeft) : -1, right: el ? parseFloat(getComputedStyle(el).paddingRight) : -1 };
      }),
    );
    for (const gutter of gutters) {
      expect(gutter.left, `${gutter.name} left`).toBe(16);
      expect(gutter.right, `${gutter.name} right`).toBe(16);
    }
    const quote = await page.locator('figure[class*="testimonialCardFeatured"] blockquote').evaluate((el) => el.getBoundingClientRect().width);
    expect(quote, 'the featured quote has room to read').toBeGreaterThan(270);
  });

  test('the steps of "Four steps, no obligation" are headings one level under the section heading', async ({ page }) => {
    await page.goto('/');
    const levels = await page.evaluate(() => {
      const section = document.querySelector('[class*="howSteps"]')!;
      return [...section.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => h.tagName);
    });
    expect(levels).toEqual(['H3', 'H3', 'H3', 'H3']);
  });
});
