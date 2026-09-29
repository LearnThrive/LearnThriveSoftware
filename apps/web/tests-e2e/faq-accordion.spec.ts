import { test, expect } from '@playwright/test';

// plan11.md task 11's FAQ checklist: "Smooth accordion content reveal and icon morph. Preserve
// hash/deep-link behavior." The reveal/morph are CSS-only (globals.css's .faq-item__answer /
// .faq-item__marker); this file guards the one thing that could actually break — FaqHashOpener.tsx
// still finding and opening the right <details> from a URL hash, which nothing in this task's CSS
// changes touches, but is worth locking in given the plan explicitly calls it out.

test.describe('FAQ accordion + hash deep-linking', () => {
  test('a direct link to a specific answer opens that item, not just the page', async ({ page }) => {
    await page.goto('/faq#how-to-get-started');
    const item = page.locator('#how-to-get-started');
    await expect(item).toHaveJSProperty('open', true);
  });

  test('clicking a question opens it via native <details>, independent of any hash', async ({ page }) => {
    await page.goto('/faq');
    const item = page.locator('.faq-item').first();
    await expect(item).toHaveJSProperty('open', false);
    await item.locator('summary').click();
    await expect(item).toHaveJSProperty('open', true);
  });

  // Not tested here: a hashchange firing *after* the page has already loaded (FaqHashOpener's
  // "every hash change" path, as opposed to its on-mount path the first test above covers). Next's
  // dev server strips a JS-set window.location.hash within ~300ms via some HMR/Fast-Refresh history
  // bookkeeping unrelated to this app's code — confirmed absent on a production build (`next
  // start`), where the same sequence works correctly. Since every e2e spec in this project runs
  // against `npm run dev`, a test for this specific path would fail in this suite for a reason with
  // nothing to do with the feature it's meant to guard.
});
