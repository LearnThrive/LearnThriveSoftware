import { test, expect, type Page } from '@playwright/test';
import { subjectLandingPages } from '../src/lib/site';

// Each subject's section on /subjects now shows the same hero card that subject's own page shows
// (components/SubjectHeroCard.tsx, one source of words: subjectLandingPages in lib/site.ts), between its text
// and its photograph: one row on a wide screen, the card under the text with the photograph beside both below
// 1280px, and text, card, photograph stacked on a phone.

const SECTIONS = [
  { id: 'maths', slug: 'maths', reversed: false },
  { id: 'english', slug: 'english', reversed: true },
  { id: 'science', slug: 'science', reversed: false },
] as const;

const card = (page: Page, id: string) => page.locator(`#${id} article[data-subject]`);

test.describe('the hero cards on /subjects', () => {
  test('every subject section has its card, with the same words, stage and link as its own page', async ({ page }) => {
    await page.goto('/subjects');
    for (const { id, slug } of SECTIONS) {
      const subject = subjectLandingPages[slug];
      const element = card(page, id);
      await expect(element).toHaveCount(1);
      await expect(element).toContainText(subject.hero.noteLabel);
      await expect(element).toContainText(subject.stage);
      await expect(element).toContainText(subject.hero.note);
      await expect(element.getByRole('link', { name: subject.ctaLabel })).toHaveAttribute('href', subject.path);
      await expect(element.locator('svg').first()).toBeVisible();
    }
    // 11+ has a card instead of a photograph: its card sits inside the existing 11+ panel.
    const eleven = subjectLandingPages['11-plus'];
    const element = page.locator('#eleven-plus article[data-subject="11-plus"]');
    await expect(element).toHaveCount(1);
    await expect(element).toContainText(eleven.hero.note);
    await expect(element.getByRole('link', { name: eleven.ctaLabel })).toHaveAttribute('href', eleven.path);
  });

  test('the card links go to the right landing pages', async ({ page }) => {
    for (const slug of ['maths', 'english', 'science', '11-plus'] as const) {
      await page.goto('/subjects');
      const subject = subjectLandingPages[slug];
      await page.getByRole('link', { name: subject.ctaLabel }).click();
      await expect(page).toHaveURL(new RegExp(`${subject.path}$`));
      await expect(page.getByRole('heading', { level: 1 })).toContainText(subject.hero.title);
    }
  });

  test('the existing "explore in depth" links still work, and there is exactly one view-transition name per icon', async ({ page }) => {
    await page.goto('/subjects');
    for (const { id } of SECTIONS) await expect(page.locator(`#${id}`).getByRole('link', { name: /Explore .* in depth/ })).toHaveCount(1);
    const names = await page.evaluate(() => [...document.querySelectorAll('[vt-name]')].map((el) => el.getAttribute('vt-name')));
    expect(new Set(names).size, `duplicate view-transition names: ${names}`).toBe(names.length);
  });

  test('in the page, the order is always text, card, photograph', async ({ page }) => {
    await page.goto('/subjects');
    for (const { id } of SECTIONS) {
      const order = await page.evaluate((sectionId) => {
        const root = document.querySelector(`#${sectionId}`)!;
        const text = root.querySelector('h2')!.closest('div[class*="subjectText"]')!;
        const cardEl = root.querySelector('article[data-subject]')!;
        const image = root.querySelector('div[class*="subjectImage"]')!;
        const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        return { textBeforeCard: before(text, cardEl), cardBeforeImage: before(cardEl, image) };
      }, id);
      expect(order, id).toEqual({ textBeforeCard: true, cardBeforeImage: true });
    }
  });

  for (const width of [1440, 1280, 1024, 768, 390]) {
    test(`layout at ${width}px: ${width > 1280 ? 'one row, card between text and photograph' : width > 1100 ? 'card under the text, photograph beside both' : 'stacked'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/subjects');
      for (const { id, reversed } of SECTIONS) {
        const boxes = await page.evaluate((sectionId) => {
          const root = document.querySelector(`#${sectionId}`)!;
          const rect = (el: Element) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
          };
          return {
            text: rect(root.querySelector('h2')!.closest('div[class*="subjectText"]')!),
            card: rect(root.querySelector('article[data-subject]')!),
            image: rect(root.querySelector('div[class*="subjectImage"]')!),
          };
        }, id);
        if (width > 1280) {
          // One row. A reversed section has the photograph on the left; the card is always in the middle.
          const [first, middle, last] = reversed ? [boxes.image, boxes.card, boxes.text] : [boxes.text, boxes.card, boxes.image];
          expect(first.right, `${id} first part ends before the card`).toBeLessThanOrEqual(middle.left + 1);
          expect(middle.right, `${id} the card ends before the last part`).toBeLessThanOrEqual(last.left + 1);
          expect(Math.abs(boxes.card.top - boxes.text.top), `${id} the row is level`).toBeLessThan(400);
        } else if (width > 1100) {
          expect(boxes.card.top, `${id} the card is under the text`).toBeGreaterThanOrEqual(boxes.text.bottom - 1);
          if (reversed) expect(boxes.image.right, `${id} the photograph is beside both, on the left`).toBeLessThanOrEqual(Math.min(boxes.card.left, boxes.text.left) + 1);
          else expect(boxes.image.left, `${id} the photograph is beside both, on the right`).toBeGreaterThanOrEqual(Math.max(boxes.card.right, boxes.text.right) - 1);
        } else {
          expect(boxes.card.top, `${id} the card is under the text`).toBeGreaterThanOrEqual(boxes.text.bottom - 1);
          expect(boxes.image.top, `${id} the photograph is under the card`).toBeGreaterThanOrEqual(boxes.card.bottom - 1);
        }
        expect(boxes.card.width, `${id} the card is readable`).toBeGreaterThan(Math.min(240, width - 40));
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }

  test('the 11+ card is stacked under the heading text on a phone and beside it on a wide screen, with no overflow at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/subjects');
    const wide = await page.evaluate(() => {
      const root = document.querySelector('#eleven-plus')!;
      const title = root.querySelector('h2')!.getBoundingClientRect();
      const cardRect = root.querySelector('article[data-subject]')!.getBoundingClientRect();
      return { titleRight: title.right, cardLeft: cardRect.left, titleTop: title.top, cardTop: cardRect.top };
    });
    expect(wide.cardLeft).toBeGreaterThan(wide.titleRight - 1);
    await page.setViewportSize({ width: 360, height: 800 });
    const narrow = await page.evaluate(() => {
      const root = document.querySelector('#eleven-plus')!;
      return { title: root.querySelector('h2')!.getBoundingClientRect().bottom, card: root.querySelector('article[data-subject]')!.getBoundingClientRect().top, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(narrow.card).toBeGreaterThanOrEqual(narrow.title - 1);
    expect(narrow.overflow).toBeLessThanOrEqual(0);
  });

  test('the cards read in dark too (no light panel left over, link visible)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.goto('/subjects');
    for (const id of ['maths', 'english', 'science', 'eleven-plus']) {
      const element = card(page, id).first();
      await element.scrollIntoViewIfNeeded();
      const background = await element.evaluate((el) => getComputedStyle(el).backgroundColor);
      const [r, g, b, a = 1] = background.match(/[\d.]+/g)!.map(Number);
      // The 11+ card is a translucent white wash on the navy panel (its own look); the others are solid surfaces.
      if (a > 0.9) expect(r + g + b, `${id}: the card background ${background} is not near-white in dark`).toBeLessThan(600);
      await expect(element.getByRole('link')).toBeVisible();
    }
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
