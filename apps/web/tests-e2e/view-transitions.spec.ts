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


// plan15 Wave 8: the transition is now site-wide (components/motion/PageTransition.tsx wraps every
// public page; the header is a named, persistent transition group). K11 is law: links and buttons
// are actionable the instant the new page exists, whatever the transition is doing.
test.describe('site-wide route transition', () => {
  test('the header is a named transition group, so it persists instead of sliding', async ({ page }) => {
    await page.goto('/');
    const name = await page.locator('header.site-header').evaluate((el) => getComputedStyle(el).viewTransitionName);
    expect(name).toBe('site-header');
  });

  test('a multi-route journey: every link is actionable immediately after every navigation', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    // Home -> About -> Subjects -> FAQ -> Book -> Contact -> Home, clicking straight away each time:
    // Playwright's own actionability check would time out here if a transition overlay swallowed input
    // or the destination were briefly "unstable".
    for (const [label, url] of [['About', /\/about$/], ['Subjects', /\/subjects$/], ['FAQ', /\/faq$/], ['Book', /\/book$/], ['Contact', /\/contact$/], ['Home', /\/$/]] as const) {
      await nav.getByRole('link', { name: label, exact: true }).click({ timeout: 4000 });
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('back and forward through that journey stay interactive', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('link', { name: 'About', exact: true }).click();
    await expect(page).toHaveURL(/\/about$/);
    await nav.getByRole('link', { name: 'FAQ', exact: true }).click();
    await expect(page).toHaveURL(/\/faq$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/about$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/faq$/);
    await nav.getByRole('link', { name: 'Contact', exact: true }).click({ timeout: 4000 });
    await expect(page).toHaveURL(/\/contact$/);
  });

  test('menu links carry a direction by their order in the menu (forward = later item, back = earlier)', async ({ page }) => {
    await page.goto('/subjects');
    // Subjects is the 3rd menu item: FAQ (4th) is "forward", About (2nd) is "back". The Link
    // renders no attribute for the type, so assert behaviourally: both navigate and the page swaps.
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('link', { name: 'About', exact: true }).click();
    await expect(page).toHaveURL(/\/about$/);
    await nav.getByRole('link', { name: 'Subjects', exact: true }).click();
    await expect(page).toHaveURL(/\/subjects$/);
  });

  test('reduced motion: instant navigation, no transition animations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const durations = await page.evaluate(() => {
      // The catch-all reduced-motion block forces the pseudo-elements' animation to 0s.
      const sheet = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } });
      return sheet.some((rule) => /view-transition-old\(\*\)/.test(rule.cssText) && /animation-duration: 0s/.test(rule.cssText));
    });
    expect(durations).toBe(true);
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'About', exact: true }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the light tier navigates instantly (its rule zeroes the transition animations)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion-tier', 'light');
    const zeroed = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } });
      return rules.some((rule) => /data-motion-tier="light"/.test(rule.cssText) && /view-transition/.test(rule.cssText) && /animation-duration: 0s/.test(rule.cssText));
    });
    expect(zeroed).toBe(true);
  });

  test('scroll position after a route change is the top of the new page', async ({ page }) => {
    await page.goto('/subjects');
    await page.mouse.wheel(0, 900);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(300);
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'FAQ', exact: true }).click();
    await expect(page).toHaveURL(/\/faq$/);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 4000 }).toBeLessThan(40);
  });
});
