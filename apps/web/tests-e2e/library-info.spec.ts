import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { humanCheckDone, hydrated, mockPost } from './careers-support';

// plan19 phase B2: /library and /pricing (the Library information pages) and the waitlist form on both.
// POST /api/library-waitlist is MOCKED in every test that submits: this project has real email credentials, so a
// genuine POST would send a real email. The route itself is covered, with the email call replaced, by
// tests/libraryWaitlist.test.mjs. The human check (a GET for a challenge) is real and sends nothing.

const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const WCAG22 = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const ROUTES = ['/library', '/pricing'] as const;
const ORIGIN = 'http://localhost:3100';

async function expectAxeClean(page: Page, label: string) {
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = (await page.evaluate(async (tags) => {
    // @ts-expect-error injected global, no types installed for the browser build
    return await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
  }, WCAG22)) as { violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> };
  const lines = results.violations.map((v) => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`);
  expect(results.violations, `${label}: ${results.violations.length} violation(s)\n\n${lines.join('\n\n')}`).toEqual([]);
}

/** Smooth scrolling starts a moment after hydration; a click on an in-page link before then races it (a site-wide matter). */
async function scrollReady(page: Page) {
  await hydrated(page);
  await expect(page.locator('html')).toHaveAttribute('data-smooth-scroll', 'on', { timeout: 5000 }).catch(() => undefined);
}

/**
 * Scrolls the way a visitor does (the wheel) so the target is on screen before the click. Playwright's own
 * scroll-into-view moves the page behind the smooth scroller's back, and the scroller then aims from a stale position.
 */
async function wheelTo(page: Page, deltaY: number) {
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(1200);
}

const form = (page: Page) => page.locator('#waitlist');
const join = (page: Page) => form(page).getByRole('button', { name: 'Join the waitlist' });

async function fillValid(page: Page) {
  await form(page).getByLabel('Email address').fill('family@example.com');
  await form(page).getByRole('checkbox', { name: 'Email me once when the Library launches.' }).check();
}

test.describe('the Library information pages', () => {
  for (const route of ROUTES) {
    test.describe(route, () => {
      test('axe clean (WCAG 2.2 AA) in light and dark, closed and with every FAQ answer open', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
        await page.goto(route);
        await hydrated(page);
        await expectAxeClean(page, `${route} light`);
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
        await expect(page.locator('html')).toHaveCSS('color-scheme', /dark/);
        await expectAxeClean(page, `${route} dark`);
        if (route === '/library') {
          await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
          await expectAxeClean(page, `${route} dark, answers open`);
          await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
          await expectAxeClean(page, `${route} light, answers open`);
        }
      });

      test('axe clean with the form showing its errors', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(route);
        await hydrated(page);
        await join(page).click();
        await expect(form(page).getByRole('alert')).toBeVisible();
        await expectAxeClean(page, `${route} with errors`);
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
        await expect(page.locator('html')).toHaveCSS('color-scheme', /dark/);
        await expectAxeClean(page, `${route} with errors, dark`);
      });

      test('axe clean once the person has joined, in light and dark', async ({ page }) => {
        await mockPost(page, '**/api/library-waitlist', { json: { success: true } });
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
        await page.goto(route);
        await hydrated(page);
        await fillValid(page);
        await humanCheckDone(page);
        await join(page).click();
        await expect(form(page).getByRole('status').filter({ hasText: 'You are on the waitlist.' })).toBeVisible();
        await expectAxeClean(page, `${route} joined, light`);
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
        await expect(page.locator('html')).toHaveCSS('color-scheme', /dark/);
        await expectAxeClean(page, `${route} joined, dark`);
      });

      test('forced colours: axe clean and the waitlist controls keep their borders', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
        await page.goto(route);
        await hydrated(page);
        await expectAxeClean(page, `${route} forced colours`);
        const borders = await form(page).getByLabel('Email address').evaluate((el) => getComputedStyle(el).borderTopStyle);
        expect(borders).not.toBe('none');
      });

      test('has no horizontal scroll at 360px and at 200% zoom', async ({ page }) => {
        for (const width of [360, 640]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(route);
          await hydrated(page);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow, `${route} at ${width}px`).toBeLessThanOrEqual(0);
        }
      });

      test('sets no cookie, writes no browser storage and makes no third-party request', async ({ page, context }) => {
        const origins = new Set<string>();
        page.on('request', (request) => {
          const url = new URL(request.url());
          if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
        });
        await page.addInitScript(() => {
          const writes: string[] = [];
          (window as unknown as { __writes: string[] }).__writes = writes;
          for (const proto of [Storage.prototype]) {
            const original = proto.setItem;
            proto.setItem = function (this: Storage, key: string, value: string) {
              writes.push(`setItem ${key}`);
              return original.call(this, key, value);
            };
          }
          const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
          if (cookie?.set) {
            Object.defineProperty(document, 'cookie', {
              get: cookie.get,
              set(value: string) {
                writes.push(`cookie ${value}`);
                cookie.set!.call(document, value);
              },
            });
          }
        });
        await page.goto(route);
        await hydrated(page);
        // Interact: open the form (starts the human check), fill it, fail it once and open an FAQ answer.
        await form(page).getByLabel('Email address').fill('family@example.com');
        await humanCheckDone(page);
        await join(page).click();
        await form(page).getByRole('checkbox').check();
        if (route === '/library') await page.locator('details summary').first().click();
        expect(await context.cookies(), 'cookies').toEqual([]);
        const storage = await page.evaluate(() => ({
          local: window.localStorage.length,
          session: window.sessionStorage.length,
          writes: (window as unknown as { __writes: string[] }).__writes,
        }));
        expect(storage).toEqual({ local: 0, session: 0, writes: [] });
        expect([...origins], 'request origins').toEqual([ORIGIN]);
      });

      test('has no console errors', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(route);
        await hydrated(page);
        await join(page).click();
        expect(errors).toEqual([]);
      });

      test('with reduced motion there are no running CSS animations', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(route);
        await hydrated(page);
        const running = await page.evaluate(() =>
          document
            .getAnimations()
            .filter((animation) => animation.playState === 'running')
            .map((animation) => (animation instanceof CSSAnimation ? animation.animationName : animation.constructor.name)),
        );
        expect(running).toEqual([]);
      });

      test('with the site motion toggle on Reduce (no OS preference) nothing runs and nothing is left faded', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.goto(route);
        await hydrated(page);
        await page.locator('footer').getByLabel('Reduce motion').check({ force: true });
        await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 400) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        });
        await page.waitForTimeout(1000);
        const state = await page.evaluate(() => ({
          running: document.getAnimations().filter((a) => a.playState === 'running').length,
          // Text blocks only: the small decorative icons are drawn at 90% opacity on purpose.
          faded: [...document.querySelectorAll('main p, main h2, main h3, main li, main dd')].filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length,
        }));
        expect(state).toEqual({ running: 0, faded: 0 });
      });

      test('shows "Coming soon", "Price announced at launch" and none of the forbidden claims', async ({ page }) => {
        await page.goto(route);
        const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
        expect(text.toLowerCase()).toContain('coming soon');
        expect(text).toContain('Price announced at launch');
        // plan19 section 10: no counts, no claims about quality, results or exam boards, no price, trial, discount or free sample.
        const forbiddenWords = [
          'thousands', 'resources available', 'exam board', 'aqa', 'edexcel', 'ocr', 'guarantee', 'improve', 'grades', 'results', 'unlimited',
          'instant', 'best', 'award', 'proven', 'boost', 'premium', 'trusted', '%', '£', 'free', 'trial', 'discount', 'pre-order', 'preorder', 'deposit', 'launch date',
        ];
        const lower = text.toLowerCase();
        for (const forbidden of forbiddenWords) {
          expect(lower.includes(forbidden) ? forbidden : null, `forbidden in the page text: ${forbidden}`).toBeNull();
        }
        // The same words must not creep into the search and social descriptions either.
        const meta = await page.evaluate(() =>
          ['meta[name="description"]', 'meta[property="og:description"]', 'meta[property="og:title"]', 'title'].map((s) => document.querySelector(s)?.getAttribute('content') ?? document.querySelector(s)?.textContent ?? ''),
        );
        for (const forbidden of ['thousands', 'exam board', 'aqa', 'guarantee', 'results', '%', '£', 'free', 'trial', 'discount']) {
          expect(meta.join(' ').toLowerCase().includes(forbidden) ? forbidden : null, `forbidden in the metadata: ${forbidden}`).toBeNull();
        }
        // No structured data for products or offers.
        const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
        for (const block of ld) expect(block).not.toMatch(/"@type":\s*"(Product|Offer|Service|Course)"/);
      });

      test('the waitlist: validation, consent, success, focus and the exact request', async ({ page }) => {
        const sent = await mockPost(page, '**/api/library-waitlist', { json: { success: true } });
        await page.goto(route);
        await hydrated(page);
        const consent = form(page).getByRole('checkbox', { name: 'Email me once when the Library launches.' });
        await expect(consent).not.toBeChecked();

        // Both fields are required; the summary takes focus and links to each field.
        await join(page).click();
        const summary = form(page).getByRole('alert');
        await expect(summary).toBeFocused();
        await expect(summary).toContainText('There are 2 things to check.');
        await expect(summary).toContainText('Enter your email address.');
        await expect(summary).toContainText('Tick the box if you would like us to email you once when the Library launches.');
        await summary.getByRole('link', { name: 'Enter your email address.' }).click();
        await expect(form(page).getByLabel('Email address')).toBeFocused();
        expect(sent.calls).toBe(0);

        // A bad address is its own message; consent alone is still required.
        await form(page).getByLabel('Email address').fill('not-an-address');
        await expect(form(page).locator('#field-email-error')).toHaveText('Enter a valid email address.');
        await form(page).getByLabel('Email address').fill('family@example.com');
        await join(page).click();
        await expect(form(page).locator('#field-consent-error')).toContainText('Tick the box');
        await expect(form(page).locator('#field-email-error')).toHaveCount(0);
        expect(sent.calls).toBe(0);

        await consent.check();
        await humanCheckDone(page);
        await join(page).click();
        const done = form(page).getByRole('status').filter({ hasText: 'You are on the waitlist.' });
        await expect(done).toBeVisible();
        await expect(done).toBeFocused();
        await expect(done).toContainText('We will email you once, when the Library launches.');
        expect(sent.calls).toBe(1);
        expect(sent.contentType).toContain('application/json');
        const body = JSON.parse(sent.body);
        expect(body).toMatchObject({ email: 'family@example.com', consent: true, website: '' });
        expect(typeof body.elapsedMs).toBe('number');
        expect(body.humanCheck).toBeTruthy();
      });

      test('a person can join with the keyboard alone', async ({ page }) => {
        const sent = await mockPost(page, '**/api/library-waitlist', { json: { success: true } });
        await page.goto(route);
        await hydrated(page);
        await form(page).getByLabel('Email address').focus();
        await page.keyboard.type('family@example.com');
        await page.keyboard.press('Tab');
        await expect(form(page).getByRole('checkbox')).toBeFocused();
        await page.keyboard.press('Space');
        await expect(form(page).getByRole('checkbox')).toBeChecked();
        await humanCheckDone(page);
        await page.keyboard.press('Tab');
        await expect(join(page)).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(form(page).getByRole('status').filter({ hasText: 'You are on the waitlist.' })).toBeFocused();
        expect(JSON.parse(sent.body)).toMatchObject({ email: 'family@example.com', consent: true });
      });

      test('when the server cannot take sign-ups it says so and offers the email fallback', async ({ page }) => {
        await mockPost(page, '**/api/library-waitlist', {
          status: 503,
          json: { code: 'unavailable', error: 'The waitlist is not taking sign-ups right now. Please email info@learnthrivetuition.co.uk instead.' },
        });
        await page.goto(route);
        await hydrated(page);
        await fillValid(page);
        await humanCheckDone(page);
        await join(page).click();
        const alert = form(page).getByRole('alert');
        await expect(alert).toBeFocused();
        await expect(alert).toContainText('not taking sign-ups right now');
        await expect(alert).toContainText('Prefer email? Write to');
        await expect(alert.getByRole('link', { name: 'info@learnthrivetuition.co.uk' }).first()).toHaveAttribute('href', /^mailto:info@learnthrivetuition\.co\.uk\?subject=Library%20waitlist$/);
        await expectAxeClean(page, `${route} unavailable`);
      });

      test('a validation answer from the server is shown against its field', async ({ page }) => {
        await mockPost(page, '**/api/library-waitlist', {
          status: 422,
          json: { error: 'Please check your answers and send again.', errors: { email: 'Enter a valid email address.' } },
        });
        await page.goto(route);
        await hydrated(page);
        await fillValid(page);
        await humanCheckDone(page);
        await join(page).click();
        await expect(form(page).getByRole('alert').filter({ hasText: 'thing' })).toBeFocused();
        await expect(form(page).locator('#field-email-error')).toHaveText('Enter a valid email address.');
      });

      test('without JavaScript there is a plain email fallback and no form that could put an address in the URL', async ({ browser, baseURL }) => {
        const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
        const page = await context.newPage();
        await page.goto(route);
        // Playwright's text and role engines skip <noscript>, so it is found by CSS.
        const fallback = page.locator('#waitlist noscript p');
        await expect(fallback).toBeVisible();
        await expect(fallback).toHaveText('Prefer email? Write to info@learnthrivetuition.co.uk and ask to be added to the Library waitlist.');
        await expect(fallback.locator('a')).toHaveAttribute('href', 'mailto:info@learnthrivetuition.co.uk?subject=Library%20waitlist');
        await expect(page.locator('#waitlist form')).toBeHidden();
        await context.close();
      });
    });
  }

  test('/pricing: the card is coming soon, has no checkout and its button lands on the waitlist with focus', async ({ page }) => {
    await page.goto('/pricing');
    await scrollReady(page);
    const card = page.locator('[data-pricing-card]');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute('data-pricing-card', 'coming-soon');
    await expect(card.getByRole('heading', { name: 'LearnThrive Library' })).toBeVisible();
    await expect(card.getByText('Terms, price, renewal and cancellation details will be shown in full before anyone pays.')).toBeVisible();
    await expect(page.locator('main form').filter({ has: page.locator('[name="plan"]') })).toHaveCount(0);
    await wheelTo(page, 400);
    await card.getByRole('link', { name: 'Join the waitlist' }).click();
    await expect(page.locator('#waitlist')).toBeFocused();
    expect(page.url()).toMatch(/#waitlist$/);
    await expect(page.locator('#waitlist')).toBeInViewport();
  });

  test('/pricing: the card button works with the keyboard', async ({ page }) => {
    await page.goto('/pricing');
    await scrollReady(page);
    const link = page.locator('[data-pricing-card]').getByRole('link', { name: 'Join the waitlist' });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#waitlist')).toBeFocused();
  });

  test('/library: the hero button lands on the waitlist with focus', async ({ page }) => {
    await page.goto('/library');
    await scrollReady(page);
    await page.locator('.page-hero').getByRole('link', { name: 'Join the waitlist' }).click(); // in view without scrolling
    await expect(page.locator('#waitlist')).toBeFocused();
  });

  test('/library: says what the Library is and who it is for, and the FAQ answers stay inside the confirmed facts', async ({ page }) => {
    await page.goto('/library');
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    for (const fact of [
      'worksheets, exam-style papers, mark schemes and notes',
      'included for students enrolled with LearnThrive',
      'pay a subscription for all of it',
      'Key Stage 2 to A Level',
      'Maths, English, Science and 11+ Preparation',
      'Sign in',
      'Browse',
      'Download',
    ]) {
      expect(text.toLowerCase(), fact).toContain(fact.toLowerCase());
    }
    const questions = await page.locator('details summary > span:first-child').allTextContents();
    expect(questions).toEqual([
      'What is the Library?',
      'Who is it for?',
      'Which subjects and levels will it cover?',
      'When will it open?',
      'What will it cost?',
      'How will I get access?',
      'Is anything stored when I join the waitlist?',
    ]);
    expect(text).not.toMatch(/\b\d{1,3}(,\d{3})*\s+(worksheets|papers|resources|documents)\b/i);
  });

  test('the footer lists Library under Company, the header does not, and the pages are linked from home and subjects', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header').getByRole('link', { name: 'Library' })).toHaveCount(0);
    const footerLink = page.locator('footer.site-footer .footer-column', { hasText: 'Company' }).getByRole('link', { name: 'Library' });
    await expect(footerLink).toHaveAttribute('href', '/library');
    await expect(page.locator('main').getByRole('link', { name: /Library is coming soon/ })).toHaveAttribute('href', '/library');
    await page.goto('/subjects');
    await expect(page.locator('main').getByRole('link', { name: /Library is coming soon/ })).toHaveAttribute('href', '/library');
    await footerLink.click();
    await expect(page).toHaveURL(/\/library$/);
  });

  test('both pages are in the sitemap and have a social preview', async ({ request }) => {
    const sitemap = await (await request.get('/sitemap.xml')).text();
    for (const route of ROUTES) {
      expect(sitemap).toContain(`${route}</loc>`);
      const og = await request.get(`/og${route}`);
      expect(og.status(), `/og${route}`).toBe(200);
    }
  });
});
