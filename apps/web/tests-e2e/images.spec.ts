import { test, expect, type Page } from '@playwright/test';
import { PUBLIC_ROUTES } from './support';

// plan15.md Wave 1 §5.1 (g, h) — image geometry. Both read the *layout* box (offsetWidth/Height),
// never getBoundingClientRect(): a Reveal or ParallaxLayer transform scales/moves the painted box,
// and what is being asserted is how the page lays the image out, not where an animation has got to.

interface ImageGeometry {
  alt: string;
  src: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  objectFit: string;
  /** Share of the source that object-fit: cover discards, per axis, 0..1. */
  cropX: number;
  cropY: number;
}

/** Scroll the whole page so every lazy image has loaded, then read each image's geometry. */
async function imageGeometry(page: Page, selector = 'img'): Promise<ImageGeometry[]> {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight * 0.8) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
    await Promise.all(
      [...document.images].map((img) => (img.complete ? null : new Promise((resolve) => { img.onload = img.onerror = resolve; }))),
    );
  });
  return page.evaluate((sel) => {
    return [...document.querySelectorAll<HTMLImageElement>(sel)]
      .filter((img) => img.naturalWidth > 0 && img.offsetWidth > 0 && img.offsetHeight > 0)
      .map((img) => {
        const width = img.offsetWidth;
        const height = img.offsetHeight;
        const { naturalWidth, naturalHeight } = img;
        const objectFit = getComputedStyle(img).objectFit;
        let cropX = 0;
        let cropY = 0;
        if (objectFit === 'cover') {
          const scale = Math.max(width / naturalWidth, height / naturalHeight);
          cropX = 1 - width / (naturalWidth * scale);
          cropY = 1 - height / (naturalHeight * scale);
        }
        return { alt: img.alt, src: img.currentSrc, width, height, naturalWidth, naturalHeight, objectFit, cropX, cropY };
      });
  }, selector);
}

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 834, height: 1112 },
  { width: 1024, height: 768 },
  { width: 1101, height: 800 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

// The two source photos are square (320x320), so the configured frame is 1:1 — see
// .founderPortraitFrame in about.module.css. If better originals arrive, change this with the CSS.
const FOUNDER_RATIO = 1;
const FOUNDERS = ['Abdurrahman Mustafa, co-founder', 'Tahasin Hasan, co-founder'];

test.describe('About page — founder portraits keep their proportions', () => {
  for (const viewport of VIEWPORTS) {
    test(`undistorted, uncropped and never squeezed at ${viewport.width}px`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto('/about');
      const portraits = (await imageGeometry(page, 'img[alt$="co-founder"]')).sort((a, b) => a.alt.localeCompare(b.alt));
      expect(portraits.map((p) => p.alt)).toEqual([...FOUNDERS].sort());

      for (const portrait of portraits) {
        const label = `${portrait.alt} @ ${viewport.width}px: ${portrait.width}x${portrait.height}`;
        expect(portrait.width / portrait.height, `${label} — aspect ratio`).toBeCloseTo(FOUNDER_RATIO, 1);
        expect(Math.abs(portrait.width / portrait.height / FOUNDER_RATIO - 1), `${label} — within 1% of the configured ratio`).toBeLessThanOrEqual(0.01);
        expect(portrait.cropX, `${label} — horizontal crop`).toBeLessThanOrEqual(0.08);
        expect(portrait.cropY, `${label} — vertical crop`).toBeLessThanOrEqual(0.08);
        expect(portrait.width, `${label} — never narrower than 150px`).toBeGreaterThanOrEqual(150);
        // A 320px file shown larger than ~1.5x its own width is visibly soft on any screen.
        expect(portrait.width / portrait.naturalWidth, `${label} — upscale factor`).toBeLessThanOrEqual(1.5);
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(0);

      const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'The people behind LearnThrive' }) });
      await testInfo.attach(`founders-${viewport.width}.png`, { body: await section.screenshot(), contentType: 'image/png' });
      await context.close();
    });
  }

  test('the frame, not the image, is the sized element, and the animated state cannot squeeze it', async ({ browser }) => {
    // Full motion (tier "full"): the scale reveal and parallax are live. The layout box must still hold.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    await page.goto('/about');
    for (const alt of FOUNDERS) {
      const frame = page.locator(`img[alt="${alt}"]`).locator('xpath=..');
      await frame.scrollIntoViewIfNeeded();
      const box = await frame.evaluate((el) => ({ width: (el as HTMLElement).offsetWidth, height: (el as HTMLElement).offsetHeight, flex: getComputedStyle(el).flexShrink }));
      expect(box.width, `${alt} frame width`).toBeGreaterThanOrEqual(150);
      expect(box.width, `${alt} frame is square`).toBe(box.height);
      expect(box.flex, `${alt} frame must not shrink`).toBe('0');
    }
    await context.close();
  });
});

// A pure-CSS squash is the failure the About portraits had: the layout gave the image a box whose
// ratio had nothing to do with the photo's. object-fit: fill/none would stretch it; this fails the
// moment any image on any public route is stretched, and reports (without failing) heavy crops.
test.describe('sitewide image integrity', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`no stretched images on ${route}`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(route);
      const images = await imageGeometry(page);

      const stretched = images.filter((img) => {
        if (img.objectFit !== 'fill' && img.objectFit !== 'none') return false;
        const rendered = img.width / img.height;
        const natural = img.naturalWidth / img.naturalHeight;
        return Math.abs(rendered / natural - 1) > 0.02;
      });
      expect(
        stretched.map((img) => `${img.src}: rendered ${img.width}x${img.height}, natural ${img.naturalWidth}x${img.naturalHeight}`),
        'images drawn at a different aspect ratio than the file',
      ).toEqual([]);

      // Heavy crops are reported, not failed: a wide photo in a banner is a legitimate crop, but a
      // portrait losing a quarter of itself is worth a look.
      const portraitLike = /portrait|headshot|founder|tutor|student|child|parent/i;
      for (const img of images) {
        const crop = Math.max(img.cropX, img.cropY);
        if (crop > 0.25 && portraitLike.test(img.alt)) {
          testInfo.annotations.push({
            type: 'warning',
            description: `${img.alt}: object-fit cover discards ${(crop * 100).toFixed(0)}% of ${img.naturalWidth}x${img.naturalHeight} (shown ${img.width}x${img.height})`,
          });
        }
      }
      await context.close();
    });
  }
});
