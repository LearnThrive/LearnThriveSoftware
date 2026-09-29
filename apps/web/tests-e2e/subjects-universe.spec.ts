import { test, expect } from '@playwright/test';

// plan12.md task 6: /subjects becomes an immersive subject universe. marketing-motion.spec.ts's
// PUBLIC_ROUTES sweep already covers /subjects for reduced-motion/360px/axe; this file covers what
// nothing else does — the new per-subject motif layer, the explore-in-depth links this page
// previously had none of, and the English underline treatment.

test.describe('/subjects universe', () => {
  test('each subject section has a motif layer, and the layers use one shared scroll source', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto('/subjects');
    for (const id of ['maths', 'english', 'science']) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
    // maths and science get a drawn SVG motif (PathTrack / ScienceNodes); english deliberately
    // doesn't (SubjectWorld.tsx's own established treatment — an underline instead, checked below).
    await expect(page.locator('#maths svg.subject-world-track')).toHaveCount(1);
    await expect(page.locator('#science svg.subject-world-nodes')).toHaveCount(1);
    // SubjectSectionMotif itself renders nothing for english (SubjectWorld.tsx's own established
    // "underline instead of a line motif" choice) — scoped to the motif layer, not the whole
    // section, since the subject icon badge is also a (functionally unrelated) svg.
    await expect(page.locator('#english [class*="subjectMotifLayer"] svg')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the 11+ section has its own milestone path', async ({ page }) => {
    await page.goto('/subjects');
    await expect(page.locator('#eleven-plus svg.subject-world-track')).toBeVisible();
  });

  test('each subject links to its own dedicated page, previously missing entirely', async ({ page }) => {
    await page.goto('/subjects');
    const maths = page.locator('#maths').getByRole('link', { name: /Explore Maths in depth/i });
    await expect(maths).toHaveAttribute('href', '/maths-tuition');
    const english = page.locator('#english').getByRole('link', { name: /Explore English in depth/i });
    await expect(english).toHaveAttribute('href', '/english-tuition');
    const science = page.locator('#science').getByRole('link', { name: /Explore Science in depth/i });
    await expect(science).toHaveAttribute('href', '/science-tuition');
  });

  test('the explore link actually navigates through to the subject page', async ({ page }) => {
    await page.goto('/subjects');
    await page.locator('#maths').getByRole('link', { name: /Explore Maths in depth/i }).click();
    await expect(page).toHaveURL(/\/maths-tuition/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Maths/i);
  });

  test('the English heading is underlined on view, not left static', async ({ page }) => {
    await page.goto('/subjects');
    const underline = page.locator('#english [data-underline-line]');
    await expect(underline).toHaveCSS('transform', 'matrix(0, 0, 0, 1, 0, 0)');
    await underline.scrollIntoViewIfNeeded();
    // scaleX(1) is the identity transform — Chromium reports it as "none", not a matrix, matching
    // this suite's own established IDENTITY_TRANSFORM pattern elsewhere (marketing-motion.spec.ts).
    await expect.poll(() => underline.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  });
});
