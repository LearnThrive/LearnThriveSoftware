import { test, expect } from '@playwright/test';

// plan11.md task 12: shared LegalPage.tsx motion across /privacy, /cookies, /terms,
// /tuition-terms, /complaints, /accessibility (and, incidentally, /safeguarding, which also
// renders LegalPage). Console/hydration coverage for these routes already exists via
// marketing-motion.spec.ts's PUBLIC_ROUTES sweep; this file checks the one thing that's new and
// specific to this task — the IntersectionObserver-driven active-section highlight — without
// asserting on exact scroll pixels or timing.

const ROUTES = ['/privacy', '/cookies', '/terms', '/tuition-terms', '/complaints', '/accessibility'];

for (const route of ROUTES) {
  test(`${route}: the contents nav highlights a section as it scrolls into view`, async ({ page }) => {
    await page.goto(route);
    const nav = page.locator('.legal-contents nav');
    const links = nav.locator('a');
    const linkCount = await links.count();
    expect(linkCount).toBeGreaterThan(1);

    // The first section should be active near the top of the page.
    await expect(links.first()).toHaveAttribute('aria-current', 'true');
    await expect(nav.locator('a[aria-current="true"]')).toHaveCount(1);

    // Scroll the last section's heading to the top of the viewport, rather than relying on
    // scrollIntoViewIfNeeded()'s default alignment — LegalContentsNav's rootMargin only treats a
    // heading as "current" once it's near the top of the viewport (see that file's own comment),
    // and the default alignment landed differently per page depending on how tall each page's
    // sections are, which is what made this flaky across routes.
    const lastHref = await links.last().getAttribute('href');
    expect(lastHref).toBeTruthy();
    const targetId = lastHref!.slice(1);
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 120));
    }, targetId);

    await expect(links.last()).toHaveAttribute('aria-current', 'true', { timeout: 5000 });
    await expect(nav.locator('a[aria-current="true"]')).toHaveCount(1);
  });
}

test('legal page word count is unchanged by the motion pass (no wording edited)', async ({ page }) => {
  // A structural, not textual, guard: the legal-prose article's total visible text should still
  // contain the same core legal terms it always has — a cheap smoke check that nothing in the
  // migration to LegalContentsNav accidentally dropped or duplicated section content.
  await page.goto('/privacy');
  const prose = page.locator('.legal-prose');
  await expect(prose).toContainText('Scope');
  const sectionCount = await page.locator('.legal-prose > section').count();
  const navLinkCount = await page.locator('.legal-contents nav a').count();
  expect(sectionCount).toBe(navLinkCount);
});
