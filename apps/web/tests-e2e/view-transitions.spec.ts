import { test, expect } from '@playwright/test';

// plan11.md task 14: React's <ViewTransition> (native View Transitions API) wrapping the subject-
// icon badge on the homepage's subject cards and on each SubjectLandingPage.tsx hero. The plan's
// own checklist demands exactly this: "Test direct navigation, browser back, keyboard activation,
// repeated clicks... Remove the feature if it blocks actionability or navigation." That escape
// hatch exists because this app has a *documented* prior regression from the same category of
// feature (docs/DESIGN_SYSTEM.md: a per-navigation page fade in the authenticated app shell made a
// link briefly non-actionable — a real Playwright actionability timeout, not a cosmetic nit). This
// file is the evidence for whether that happened again here.

test.describe('subject card -> subject page transition', () => {
  test('direct click navigates and the destination page is immediately interactive', async ({ page }) => {
    await page.goto('/');
    await page.locator('#subjects').getByRole('link', { name: /Maths.*KS2.*A-LEVEL/ }).click();
    await expect(page).toHaveURL(/\/maths-tuition$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Immediately clickable — the actual regression this task guards against.
    await page.getByRole('link', { name: 'Book a free consultation' }).first().click();
    await expect(page).toHaveURL(/\/book$/);
  });

  test('browser back returns to the homepage in a normal, interactive state', async ({ page }) => {
    await page.goto('/');
    await page.locator('#subjects').getByRole('link', { name: /English.*KS2.*A-LEVEL/ }).click();
    await expect(page).toHaveURL(/\/english-tuition$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    // The homepage's nav must still work right after a back-navigation.
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/\/about$/);
  });

  test('keyboard activation (Enter on a focused card) navigates correctly', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('#subjects').getByRole('link', { name: /Science.*KS2.*A-LEVEL/ });
    await card.focus();
    await expect(card).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/science-tuition$/);
  });

  test('repeated rapid clicks on the same card (an impatient double-click) still lands cleanly', async ({ page }) => {
    // Two different links racing mid-navigation is inherently unreliable in a real browser with or
    // without a transition involved — the first click already commits to tearing down the page, so
    // a second click on a *different*, about-to-be-detached element is not a meaningful test of
    // this feature specifically. Rapidly re-clicking the *same* link a user is impatient with is
    // the realistic version of "repeated clicks", and it exercises the same in-flight-transition
    // path without that unrelated race.
    await page.goto('/');
    const card = page.locator('#subjects').getByRole('link', { name: /Maths.*KS2.*A-LEVEL/ });
    await card.dblclick();
    await expect(page).toHaveURL(/\/maths-tuition$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The destination page must still be a normal, fully interactive page afterwards.
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Subjects' }).click();
    await expect(page).toHaveURL(/\/subjects$/);
  });

  test('produces no console/page errors, normal or reduced motion', async ({ page }) => {
    for (const reduced of [false, true]) {
      if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(String(err)));
      await page.goto('/');
      await page.locator('#subjects').getByRole('link', { name: /Maths.*KS2.*A-LEVEL/ }).click();
      await expect(page).toHaveURL(/\/maths-tuition$/);
      await page.waitForTimeout(400); // let any transition fully settle
      expect(errors, `console/page errors (reduced=${reduced}): ${JSON.stringify(errors, null, 2)}`).toEqual([]);
    }
  });
});

// plan12.md task 14: "strengthen subject-card -> subject-page continuity" moved the ViewTransition
// boundary on /subjects to cover the icon's coloured surface (not just the bare glyph), reusing the
// exact same shared name the homepage's cards already morph through. This is the same
// actionability-after-transition guard as the describe block above, run from the *other* origin
// that now participates in the same named transition.
test.describe('/subjects section -> subject page transition', () => {
  test('the explore link navigates and the destination is immediately interactive, no console/page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto('/subjects');
    await page.locator('#science').getByRole('link', { name: /Explore Science in depth/i }).click();
    await expect(page).toHaveURL(/\/science-tuition$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Book a free consultation' }).first().click();
    await expect(page).toHaveURL(/\/book$/);
    await page.waitForTimeout(400);
    expect(errors, `console/page errors: ${JSON.stringify(errors, null, 2)}`).toEqual([]);
  });
});
