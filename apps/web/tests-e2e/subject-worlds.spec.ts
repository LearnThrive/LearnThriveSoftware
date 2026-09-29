import { test, expect } from '@playwright/test';

// plan11.md task 10's "shared route test over all four pages: content/CTA/reduced-motion/360px
// overflow" for the four subject-specific "motion worlds" (SubjectWorld.tsx via
// SubjectLandingPage.tsx). Reduced-motion is already covered for every public route, these four
// included, by marketing-motion.spec.ts's PUBLIC_ROUTES sweep and its "first block after the hero"
// LCP guard — this file covers the two checks nothing else does: that real content and the CTA
// survived the new motion wrapping, and that none of the four pages overflows a 360px viewport
// (the narrowest common device width, and the one most likely to be broken by an absolutely
// positioned decorative element like SubjectWorld's path/dots/nodes).

const SUBJECT_ROUTES: Array<{ path: string; heading: RegExp }> = [
  { path: '/maths-tuition', heading: /Maths/i },
  { path: '/english-tuition', heading: /English/i },
  { path: '/science-tuition', heading: /Science/i },
  { path: '/11-plus-tuition', heading: /11\+/ },
];

// plan12.md task 7: each subject page's hero now carries its own composition motif, and the
// spotlight section's heading is an oversized MaskedText statement — checked once, sitewide, since
// all four routes share the one SubjectLandingPage/PageHero component.
test.describe('subject page composition (task 7)', () => {
  for (const { path } of SUBJECT_ROUTES) {
    test(`${path}: has a hero motif and a masked spotlight heading, with no console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(String(err)));
      await page.goto(path);
      await expect(page.locator('.page-hero svg.subject-hero-motif')).toBeVisible();
      const maskedHeading = page.locator('h2 [data-masked-text-inner]');
      await maskedHeading.scrollIntoViewIfNeeded();
      await expect(maskedHeading).toHaveCSS('opacity', '1', { timeout: 5000 });
      expect(errors).toEqual([]);
    });
  }
});

for (const { path, heading } of SUBJECT_ROUTES) {
  test.describe(`${path}`, () => {
    test('renders its hero, coverage stages and a working CTA', async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      // Every subject's coverage section is a real, populated pathway of stages/priorities — not
      // just a heading with nothing rendered under it (SubjectWorld replaced the raw <ol> markup;
      // this confirms the four coverage.items per subject actually made it through).
      const stages = page.locator('.subject-pathway-card');
      await expect(stages).toHaveCount(4);
      for (let i = 0; i < 4; i++) {
        await expect(stages.nth(i).locator('h3')).not.toBeEmpty();
      }
      // The CTA at the foot of the page — wrapped in a Reveal now, so this also proves the CTA is
      // not left invisible waiting on a reveal that never fires.
      await expect(page.getByRole('link', { name: /Book a free consultation/i }).last()).toBeVisible();
    });

    test('has no horizontal overflow at 360px width', async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const viewportWidth = document.documentElement.clientWidth;
        return { docWidth, viewportWidth, overflows: docWidth > viewportWidth };
      });
      expect(overflow.overflows, `${path} overflows at 360px: scrollWidth ${overflow.docWidth} > clientWidth ${overflow.viewportWidth}`).toBe(false);
    });
  });
}

// plan12.md task 15's anti-generic audit: /11-plus-tuition's coverage section reused maths's exact
// PathTrack line, differing only by accent colour — the route's one scroll-linked visual device was
// a straight copy, not something specific to 11-plus. Fixed by threading a `dashed` prop through so
// 11-plus's line matches its own hero's dashed "route" language (SubjectHeroMotif's RouteMilestones)
// instead of maths's solid "curve" line.
test.describe('subject coverage card composition (task 15)', () => {
  test('11-plus has a dashed coverage guide line; maths has a solid one', async ({ page }) => {
    // The static background guide line (not the scroll-drawn one, which framer-motion's own
    // pathLength implementation controls via its own dynamic stroke-dasharray — see
    // SubjectWorld.tsx's PathTrack comment).
    await page.goto('/11-plus-tuition');
    const elevenPlusLine = page.locator('.subject-world-track line').first();
    await expect(elevenPlusLine).toHaveAttribute('stroke-dasharray', '7 6');

    await page.goto('/maths-tuition');
    const mathsLine = page.locator('.subject-world-track line').first();
    const mathsDash = await mathsLine.getAttribute('stroke-dasharray');
    expect(mathsDash).toBeNull();
  });

  test('coverage cards have no lift-shadow, unlike the support grid above them', async ({ page }) => {
    await page.goto('/maths-tuition');
    const coverageCard = page.locator('.subject-pathway-card').first();
    await coverageCard.scrollIntoViewIfNeeded();
    await expect(coverageCard).toHaveCSS('box-shadow', 'none');
    const supportCard = page.locator('.subject-benefit-grid .feature-card').first();
    const supportShadow = await supportCard.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(supportShadow).not.toBe('none');
  });
});
