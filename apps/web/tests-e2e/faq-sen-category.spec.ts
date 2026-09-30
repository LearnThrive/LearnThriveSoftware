import { test, expect } from '@playwright/test';

// plan13.md task 4: restoring the "Special educational needs" FAQ category (ported from the
// legacy site's src/lib/faqs.ts, verified against docs/PLAN13_LEGACY_MARKETING_PARITY.md — no
// diagnostic/medical/therapeutic claims, just five real questions about adapting tuition).

test.describe('FAQ: Special educational needs category (task 4)', () => {
  test('the sen-support category exists with exactly the five intended questions', async ({ page }) => {
    await page.goto('/faq');
    const category = page.locator('#sen-support');
    await expect(category).toBeVisible();
    await expect(category.getByRole('heading', { name: 'Special educational needs' })).toBeVisible();

    const expectedIds = [
      'sen-support-available',
      'sen-lesson-adaptations',
      'sen-diagnosis-required',
      'sen-sharing-information',
      'sen-changing-approach',
    ];
    for (const id of expectedIds) {
      await expect(category.locator(`#${id}`)).toHaveCount(1);
    }
    // Exactly five — not more, not fewer.
    await expect(category.locator('.faq-item')).toHaveCount(5);
  });

  test('the jump nav exposes the category with its question count', async ({ page }) => {
    await page.goto('/faq');
    const pill = page.getByRole('link', { name: /Special educational needs/ });
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('5');
    await pill.click();
    await expect(page).toHaveURL(/#sen-support$/);
  });

  test('a direct link to a sen question opens that item via the existing hash-opener behaviour', async ({ page }) => {
    await page.goto('/faq#sen-diagnosis-required');
    const item = page.locator('#sen-diagnosis-required');
    await expect(item).toHaveJSProperty('open', true);
  });

  test('accordion keyboard: a focused question opens on Enter, matching native <details> semantics', async ({ page }) => {
    await page.goto('/faq');
    const item = page.locator('#sen-support-available');
    await expect(item).toHaveJSProperty('open', false);
    await item.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(item).toHaveJSProperty('open', true);
  });

  test('mobile: the category and its questions render and open normally at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/faq#sen-support');
    const category = page.locator('#sen-support');
    await expect(category).toBeVisible();
    const item = page.locator('#sen-lesson-adaptations');
    await item.locator('summary').click();
    await expect(item).toHaveJSProperty('open', true);
  });

  test('reduced motion: the category renders and its accordion still opens', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/faq');
    const item = page.locator('#sen-changing-approach');
    await item.locator('summary').click();
    await expect(item).toHaveJSProperty('open', true);
  });

  test('no content anywhere on the FAQ page describes the obsolete draft-email enquiry flow', async ({ page }) => {
    await page.goto('/faq');
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('draft email');
    expect(bodyText).not.toContain('prepares an email');
    expect(bodyText).not.toContain('review and send it using your email app');
  });

  test('the category caveat is present, and no content claims LearnThrive itself provides diagnosis or therapy', async ({ page }) => {
    await page.goto('/faq#sen-support');
    const category = page.locator('#sen-support');
    // The category intro's core caveat (plan13.md task 4): tuition can be adapted, but LearnThrive
    // does not provide specialist diagnostic or therapeutic support.
    await expect(category).toContainText(
      "LearnThrive is a tuition service and does not provide specialist diagnostic or therapeutic support.",
    );
    for (const id of [
      'sen-support-available',
      'sen-lesson-adaptations',
      'sen-diagnosis-required',
      'sen-sharing-information',
      'sen-changing-approach',
    ]) {
      await category.locator(`#${id} summary`).click();
    }
    const text = (await category.innerText()).toLowerCase();
    // Specific phrases, not the bare word "diagnos"/"therap" — the approved content legitimately
    // discusses diagnosis in the negative ("a formal diagnosis is not required").
    for (const forbidden of [
      'senco service',
      'ehcp provision',
      'clinical assessment provided',
      'we diagnose',
      'therapy session',
      'guaranteed outcome',
    ]) {
      expect(text, `unexpected "${forbidden}" in the SEN category`).not.toContain(forbidden);
    }
  });
});
