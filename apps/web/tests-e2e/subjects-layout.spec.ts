import { test, expect, type Page } from '@playwright/test';
import { subjectLandingPages } from '../src/lib/site';

// /subjects (plan18): each subject section has ONE link to the subject's own page, "Explore ... in depth". The hero
// card that used to sit between the text and the photograph repeated the section's heading, stage range and
// description and carried a second link to the same page, so it is gone from this page (it stays on each subject's
// own page, covered at the end of this file). The sections are two parts now, text and photograph, side by side on
// a wide screen and stacked on a phone; the 11+ panel puts the four areas of the 11+ beside its text.

const SECTIONS = [
  { id: 'maths', slug: 'maths', reversed: false },
  { id: 'english', slug: 'english', reversed: true },
  { id: 'science', slug: 'science', reversed: false },
] as const;

const WIDTHS = [1440, 1280, 1101, 1100, 834, 768, 390, 360];

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('one link to each subject, and no card repeating the section', () => {
  test('every subject section has exactly one link to its page, worded "Explore ... in depth", and no hero card', async ({ page }) => {
    await page.goto('/subjects');
    for (const { id, slug } of SECTIONS) {
      const subject = subjectLandingPages[slug];
      const section = page.locator(`#${id}`);
      const links = section.locator(`a[href="${subject.path}"]`);
      await expect(links, `${id}: links to ${subject.path}`).toHaveCount(1);
      await expect(links).toHaveText(new RegExp(`^Explore ${subject.title} in depth`));
      await expect(section.locator('article[data-subject]'), `${id}: the old hero card`).toHaveCount(0);
      await expect(section.getByRole('link', { name: subject.ctaLabel }), `${id}: the second, differently worded link`).toHaveCount(0);
    }
    const eleven = subjectLandingPages['11-plus'];
    const panel = page.locator('#eleven-plus');
    await expect(panel.locator(`a[href="${eleven.path}"]`)).toHaveCount(1);
    await expect(panel.locator(`a[href="${eleven.path}"]`)).toHaveText(/^Explore 11\+ Preparation in depth/);
    await expect(panel.locator('article[data-subject]')).toHaveCount(0);
  });

  test('no two links in one section of the page lead to the same place', async ({ page }) => {
    await page.goto('/subjects');
    const duplicates = await page.evaluate(() => {
      const found: string[] = [];
      for (const section of document.querySelectorAll('main section[id]')) {
        const seen = new Map<string, string>();
        for (const link of section.querySelectorAll<HTMLAnchorElement>('a[href]')) {
          const href = link.getAttribute('href')!;
          if (href.startsWith('#')) continue;
          const text = (link.textContent ?? '').trim().replace(/\s+/g, ' ');
          if (seen.has(href)) found.push(`${section.id}: "${seen.get(href)}" and "${text}" both go to ${href}`);
          else seen.set(href, text);
        }
      }
      return found;
    });
    expect(duplicates).toEqual([]);
  });

  test('the one link goes to the right page, for all four subjects', async ({ page }) => {
    for (const slug of ['maths', 'english', 'science', '11-plus'] as const) {
      await page.goto('/subjects');
      const subject = subjectLandingPages[slug];
      const section = page.locator(slug === '11-plus' ? '#eleven-plus' : `#${slug}`);
      await section.getByRole('link', { name: /^Explore .* in depth/ }).click();
      await expect(page).toHaveURL(new RegExp(`${subject.path}$`));
      await expect(page.getByRole('heading', { level: 1 })).toContainText(subject.hero.title);
    }
  });

  test('there is exactly one view-transition name per icon', async ({ page }) => {
    await page.goto('/subjects');
    for (const { id } of SECTIONS) await expect(page.locator(`#${id}`).getByRole('link', { name: /Explore .* in depth/ })).toHaveCount(1);
    const names = await page.evaluate(() => [...document.querySelectorAll('[vt-name]')].map((el) => el.getAttribute('vt-name')));
    expect(new Set(names).size, `duplicate view-transition names: ${names}`).toBe(names.length);
  });
});

test.describe('the section layouts', () => {
  test('in the page, the text always comes before the photograph', async ({ page }) => {
    await page.goto('/subjects');
    for (const { id } of SECTIONS) {
      const textFirst = await page.evaluate((sectionId) => {
        const root = document.querySelector(`#${sectionId}`)!;
        const text = root.querySelector('h2')!.closest('div[class*="subjectText"]')!;
        const image = root.querySelector('div[class*="subjectImage"]')!;
        return Boolean(text.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING);
      }, id);
      expect(textFirst, id).toBe(true);
    }
  });

  for (const width of WIDTHS) {
    const wide = width > 1100;
    test(`at ${width}px the text and photograph are ${wide ? 'side by side and level with each other' : 'stacked, text first'}, and nothing overflows`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/subjects');
      for (const { id, reversed } of SECTIONS) {
        const boxes = await page.evaluate((sectionId) => {
          const root = document.querySelector(`#${sectionId}`)!;
          const rect = (el: Element) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
          };
          return { text: rect(root.querySelector('h2')!.closest('div[class*="subjectText"]')!), image: rect(root.querySelector('div[class*="subjectImage"]')!) };
        }, id);
        if (wide) {
          const [first, second] = reversed ? [boxes.image, boxes.text] : [boxes.text, boxes.image];
          expect(first.right, `${id}: the first part ends before the second`).toBeLessThanOrEqual(second.left + 1);
          // Centred on each other, within a third of the photograph's height: no part is stranded high or low.
          const textMiddle = (boxes.text.top + boxes.text.bottom) / 2;
          const imageMiddle = (boxes.image.top + boxes.image.bottom) / 2;
          expect(Math.abs(textMiddle - imageMiddle), `${id}: the text and the photograph share a centre line`).toBeLessThan(boxes.image.height / 3);
          expect(boxes.text.width, `${id}: the text has room to read`).toBeGreaterThan(320);
        } else {
          expect(boxes.image.top, `${id}: the photograph is under the text`).toBeGreaterThanOrEqual(boxes.text.bottom - 1);
          expect(Math.round(boxes.image.width), `${id}: the photograph is as wide as the text column`).toBeGreaterThanOrEqual(Math.round(boxes.text.width) - 1);
        }
      }
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });

    test(`at ${width}px the 11+ panel has its text and four areas ${wide ? 'side by side' : 'one under the other'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/subjects');
      const boxes = await page.evaluate(() => {
        const root = document.querySelector('#eleven-plus')!;
        const rect = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        const tiles = [...root.querySelectorAll('div[class*="elevenPlusItem"]')].map(rect);
        return { text: rect(root.querySelector('div[class*="elevenPlusText"]')!), tiles };
      });
      expect(boxes.tiles).toHaveLength(4);
      if (wide) {
        expect(boxes.text.right, 'the text ends before the tiles').toBeLessThanOrEqual(Math.min(...boxes.tiles.map((t) => t.left)) + 1);
        // A 2 x 2 group: two tiles on each row.
        expect(new Set(boxes.tiles.map((t) => Math.round(t.top))).size).toBe(2);
      } else {
        expect(Math.min(...boxes.tiles.map((t) => t.top)), 'the tiles are under the text').toBeGreaterThanOrEqual(boxes.text.bottom - 1);
        if (width <= 640) expect(new Set(boxes.tiles.map((t) => Math.round(t.left))).size, 'one column on a phone').toBe(1);
      }
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test('the drawn path runs above the content of its section, never through text', async ({ page }) => {
    await page.goto('/subjects');
    const clash = await page.evaluate(() => {
      const found: string[] = [];
      for (const section of document.querySelectorAll('#maths, #eleven-plus')) {
        const track = section.querySelector('svg.subject-world-track');
        if (!track) continue;
        const line = track.getBoundingClientRect();
        for (const el of section.querySelectorAll('h2, p, a, b, span')) {
          if (track.contains(el) || !(el.textContent ?? '').trim()) continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          if (line.top < box.bottom && line.bottom > box.top && line.left < box.right && line.right > box.left) {
            found.push(`${section.id}: the path crosses "${(el.textContent ?? '').trim().slice(0, 30)}"`);
          }
        }
      }
      return found;
    });
    expect(clash).toEqual([]);
  });

  test('the small label on the navy 11+ panel is readable (4.5:1 or better)', async ({ page }) => {
    await page.goto('/subjects');
    const ratio = await page.evaluate(() => {
      const label = document.querySelector('#eleven-plus [class*="eyebrow"]') as HTMLElement;
      const card = label.closest('[class*="elevenPlusCard"]') as HTMLElement;
      const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      const fg = luminance(parse(getComputedStyle(label).color));
      const bg = luminance(parse(getComputedStyle(card).backgroundColor));
      const [light, dark] = fg > bg ? [fg, bg] : [bg, fg];
      return (light + 0.05) / (dark + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe('the subject landing pages are unchanged', () => {
  for (const slug of ['maths', 'english', 'science', '11-plus'] as const) {
    test(`${subjectLandingPages[slug].path}: the hero card has its icon, label, stage and note, and the icon keeps its view-transition name`, async ({ page }) => {
      const subject = subjectLandingPages[slug];
      await page.goto(subject.path);
      const hero = page.locator('.subject-landing-hero-card');
      await expect(hero).toHaveCount(1);
      await expect(hero.locator('.subject-landing-hero-card__icon svg')).toBeVisible();
      await expect(hero.locator('.subject-landing-hero-card__label')).toHaveText(subject.hero.noteLabel);
      await expect(hero.locator('strong')).toHaveText(subject.stage);
      await expect(hero.locator('p')).toHaveText(subject.hero.note);
      await expect(hero.locator('.subject-landing-hero-card__icon')).toHaveAttribute('vt-name', `subject-icon-${subject.path.slice(1)}`);
      // The landing page's own card has no extra link (the page's own buttons are the way on).
      await expect(hero.getByRole('link')).toHaveCount(0);
    });
  }
});
