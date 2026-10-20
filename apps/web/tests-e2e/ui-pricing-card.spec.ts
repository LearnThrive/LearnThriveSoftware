import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// PricingCard (plan19.md section 7, Phase B2). Runs against /dev/ui-components/pricing-card, which shows every
// state with stable ids. The checkout route is stubbed in the browser, so nothing is ever posted for real.

const URL = '/dev/ui-components/pricing-card';
const CARDS = ['coming-soon', 'coming-soon-price', 'live-fallback', 'live-monthly', 'live-annual', 'live-submitting', 'live-disabled'] as const;
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const WCAG22 = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

async function axeViolations(page: Page, scope: string) {
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = (await page.evaluate(
    async ({ scope, tags }) => {
      // @ts-expect-error injected global, no types installed for the browser build
      return await window.axe.run(document.querySelector(scope) ?? document, { runOnly: { type: 'tag', values: tags } });
    },
    { scope, tags: WCAG22 },
  )) as { violations: Array<{ id: string; help: string; nodes: Array<{ target: string[] }> }> };
  return results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

async function open(page: Page, scheme: 'light' | 'dark' = 'light') {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
  await page.goto(URL);
  await expect(page.locator('html')).toHaveAttribute('data-motion-tier', /.+/);
}

test.describe('PricingCard', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`axe clean in every state (${scheme})`, async ({ page }) => {
      await open(page, scheme);
      expect(await axeViolations(page, 'main')).toEqual([]);
    });
  }

  test('axe clean with the error showing (light and dark)', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await open(page, scheme);
      await page.locator('#live-monthly').getByRole('button', { name: 'Continue to checkout' }).click();
      await expect(page.locator('#live-monthly input[type="checkbox"]')).toBeFocused();
      expect(await axeViolations(page, '#live-monthly'), scheme).toEqual([]);
    }
  });

  test('coming soon: label, price line, link button, honest note, and no payment controls', async ({ page }) => {
    await open(page);
    const card = page.locator('#coming-soon section');
    await expect(card.getByText('Coming soon', { exact: true })).toBeVisible();
    await expect(card.getByRole('heading', { level: 3, name: 'LearnThrive Library' })).toBeVisible();
    await expect(card.locator('[data-pricing-price]')).toHaveText('Price announced at launch');
    const join = card.getByRole('link', { name: 'Join the waitlist' });
    await expect(join).toHaveAttribute('href', '#waitlist');
    await expect(card).toContainText('No payment is taken now.');
    await expect(card.locator('form, input, button, [data-pricing-draft]')).toHaveCount(0);
    expect(await card.innerText()).not.toMatch(/trial|discount|pre-?order|£|\$/i);
    // aria-describedby points at a real element.
    const target = await join.getAttribute('aria-describedby');
    expect(await page.locator(`[id="${target}"]`).count()).toBe(1);

    const withPrice = page.locator('#coming-soon-price section');
    await expect(withPrice.locator('[data-pricing-price]')).toHaveText('£9.99 per month');
    // No note passed: the card itself carries the plan's honest wording, so a caller cannot leave it out.
    await expect(withPrice).toContainText('Terms, price, renewal and cancellation details will be shown in full before anyone pays. No payment is taken now.');
    await expect(withPrice.locator('form, input, button, [data-pricing-draft]')).toHaveCount(0);
    expect(await withPrice.innerText()).not.toMatch(/trial|discount|pre-?order|deposit|\$/i);
  });

  test('a live card with no billing period falls back to coming soon: no form, no checkout, the plan wording', async ({ page }) => {
    await open(page);
    const card = page.locator('#live-fallback section');
    await expect(card).toHaveAttribute('data-pricing-card', 'coming-soon');
    await expect(card.getByText('Coming soon', { exact: true })).toBeVisible();
    await expect(card.locator('form, input[type="checkbox"], button, [data-pricing-draft]')).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Join the waitlist' })).toBeVisible();
    await expect(card).toContainText('will be shown in full before anyone pays');
  });

  test('live: price, period, renewal, cancellation, DRAFT cooling-off notice, an unticked required box, a POST form', async ({ page }) => {
    await open(page);
    for (const [id, price, period, plan] of [['live-monthly', '£9.99', 'per month', 'monthly'], ['live-annual', '£99', 'per year', 'annual']]) {
      const card = page.locator(`#${id} section`);
      await expect(card.locator('[data-pricing-price]')).toHaveText(`${price} ${period}`);
      await expect(card).toContainText(`Renews automatically every ${period.replace('per ', '')} until you cancel.`);
      await expect(card).toContainText('cancel online, in your account');
      await expect(card.locator('[data-pricing-draft]')).toContainText('Draft wording for legal review');
      await expect(card.locator('[data-pricing-draft]')).toContainText('14 days');
      await expect(card.getByText('Coming soon')).toHaveCount(0);
      const box = card.getByRole('checkbox');
      await expect(box).not.toBeChecked();
      await expect(box).toHaveJSProperty('required', true);
      const form = card.locator('form');
      await expect(form).toHaveAttribute('method', 'post');
      await expect(form).toHaveAttribute('action', '/dev/ui-components/pricing-card/checkout');
      await expect(form.locator('input[type="hidden"][name="plan"]')).toHaveValue(plan);
      const describedBy = await card.getByRole('button', { name: 'Continue to checkout' }).getAttribute('aria-describedby');
      for (const part of describedBy!.split(' ')) expect(await page.locator(`[id="${part}"]`).count()).toBe(1);
    }
  });

  test('live: submitting and disabled states', async ({ page }) => {
    await open(page);
    const submitting = page.locator('#live-submitting');
    await expect(submitting.getByRole('button', { name: 'Opening checkout…' })).toBeDisabled();
    await expect(submitting.getByRole('status')).toHaveText('Opening checkout. Please wait.');
    await expect(submitting.locator('form')).toHaveAttribute('aria-busy', 'true');
    const disabled = page.locator('#live-disabled');
    await expect(disabled.getByRole('button', { name: 'Continue to checkout' })).toBeDisabled();
    await expect(disabled.getByRole('checkbox')).toBeDisabled();
  });

  test('keyboard only: Tab order, the join link moves on to the waitlist, the box is required before checkout', async ({ page }) => {
    await open(page);
    await page.route('**/dev/ui-components/pricing-card/checkout', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>stubbed</p>' }));

    // Enter on the link goes to #waitlist and the next Tab lands in its field.
    const join = page.locator('#coming-soon').getByRole('link', { name: 'Join the waitlist' });
    await join.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#waitlist$/);
    await page.keyboard.press('Tab');
    await expect(page.locator('#waitlist-email')).toBeFocused();

    // Live card: Tab order is checkbox then button; Enter on the button unticked => error, focus on the box.
    const card = page.locator('#live-monthly');
    const box = card.getByRole('checkbox');
    const button = card.getByRole('button', { name: 'Continue to checkout' });
    await box.focus();
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute('aria-invalid', 'true');
    const error = card.getByText('Tick the box to confirm you understand before you continue.');
    await expect(error).toBeVisible();
    const describedBy = await box.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(/Tick the box/);

    // Space ticks it, the error goes, and Enter on the button now posts to the stubbed route.
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    await expect(error).toHaveCount(0);
    await expect(box).not.toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.press('Tab');
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/pricing-card/checkout')),
      page.keyboard.press('Enter'),
    ]);
    expect(request.postData()).toContain('plan=monthly');
    expect(request.postData()).toContain('acknowledged=yes');
  });

  test('focus is visible on the link, the checkbox and the button', async ({ page }) => {
    await open(page);
    for (const locator of [
      page.locator('#coming-soon').getByRole('link', { name: 'Join the waitlist' }),
      page.locator('#live-monthly').getByRole('checkbox'),
      page.locator('#live-monthly').getByRole('button', { name: 'Continue to checkout' }),
    ]) {
      await locator.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const outline = await locator.evaluate((el) => {
        const style = getComputedStyle(el);
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      expect(outline.style).not.toBe('none');
      expect(outline.width).toBeGreaterThanOrEqual(2);
    }
  });

  test('reduced motion: nothing is animating', async ({ page }) => {
    await open(page);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    expect(running).toBe(0);
    await page.locator('#coming-soon').getByRole('link', { name: 'Join the waitlist' }).hover();
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).length)).toBe(0);
  });

  test('the site Reduce motion switch alone (no OS setting) also leaves the buttons static on hover', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(URL);
    await expect(page.locator('html')).toHaveAttribute('data-motion-tier', /.+/);
    await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'reduce'));
    for (const button of [
      page.locator('#coming-soon').getByRole('link', { name: 'Join the waitlist' }),
      page.locator('#live-monthly').getByRole('button', { name: 'Continue to checkout' }),
    ]) {
      await button.hover();
      const style = await button.evaluate((el) => {
        const s = getComputedStyle(el);
        return { transform: s.transform, durations: s.transitionDuration.split(',').map((d) => parseFloat(d) * (d.includes('ms') ? 1 : 1000)) };
      });
      expect(style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
      for (const d of style.durations) expect(d).toBeLessThanOrEqual(0.01);
    }
  });

  for (const width of [360, 320]) {
    test(`no horizontal overflow at ${width}px, and each card stays inside the viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      for (const id of CARDS) {
        const box = await page.locator(`#${id} section`).boundingBox();
        expect(box!.x, id).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, id).toBeLessThanOrEqual(width);
      }
    });
  }

  test('200% zoom: a 640px viewport with text at 200% reflows with no horizontal scroll and the button reachable', async ({ page }) => {
    // 200% browser zoom on a 1280px screen is a 640px layout viewport; text at 200% is the second half of it.
    await page.setViewportSize({ width: 640, height: 800 });
    await open(page);
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const button = page.locator('#live-monthly').getByRole('button', { name: 'Continue to checkout' });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
  });

  test('forced colours: card edges, the label and the checkbox stay visible', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.goto(URL);
    const card = page.locator('#live-monthly section');
    expect(await card.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
    await expect(page.locator('#coming-soon section').getByText('Coming soon', { exact: true })).toBeVisible();
    await expect(page.locator('#live-monthly').getByRole('checkbox')).toBeVisible();
  });

  test('no console errors, and no cookies set', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on('pageerror', (error) => errors.push(error.message));
    await open(page);
    expect(errors).toEqual([]);
    expect(await page.context().cookies()).toEqual([]);
  });
});
