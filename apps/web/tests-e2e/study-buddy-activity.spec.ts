import { test, expect, type Locator, type Page } from '@playwright/test';
import { hydrated } from './careers-support';
import { address, confirm, distinctVisitor, expectAxeClean, signUp } from './account-support';

// The activity panel and the delivery of an answer in the real chat, on the server with the MOCK provider (ASSISTANT_PROVIDER=mock): no model, and
// no search service (the research step fails honestly, which is itself a state to look at). A question marked "[slow]" makes the mock model take
// several seconds, which holds a turn open so the page can be inspected while it is working.
//
// What this proves in a browser: one progress interface, inside the assistant's own message and nowhere else (the old "Thinking" line under the
// box is gone at its source); the box does not move; a held answer appears once, whole; Stop, a cut-off stream and a server error leave nothing
// spinning; and a reopened chat shows the panel again.

distinctVisitor();

const PANEL = 'section[aria-label="What LearnThrive AI did for this answer"]';
const ANSWER = 'article[aria-label="LearnThrive AI"]';
const HELD = 'Explain how photosynthesis works in a plant cell for my GCSE biology exam';

async function enrolled(page: Page) {
  const email = address();
  await signUp(page, email);
  await confirm(page, email);
  expect((await page.request.post('/api/dev/library-seed', { data: { action: 'enrol', email } })).ok()).toBe(true);
}

async function open(page: Page) {
  await page.goto('/library/ai');
  await expect(page.getByRole('heading', { level: 1, name: 'LearnThrive AI' })).toBeVisible();
  await hydrated(page);
}

async function ask(page: Page, text: string, { first = false } = {}) {
  if (first) await page.getByRole('checkbox', { name: /18 or over/ }).check();
  await page.getByLabel('Your message').fill(text);
  await page.getByRole('button', { name: /send/i }).click();
}

const box = async (locator: Locator) => (await locator.boundingBox())!;
/** Our own alerts: not Next's route announcer, which is always in the page and empty. */
const alerts = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
const spinners = (page: Page) => page.evaluate(() => document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations === Infinity).length);

/** The words of an answer as the student reads them: its paragraphs, lists and code, not the panel or the buttons. */
const READ_ANSWER = `(() => {
  const all = [...document.querySelectorAll('${ANSWER}')];
  const last = all[all.length - 1];
  if (!last) return '';
  return [...last.querySelectorAll('p, li, pre')].filter((el) => !el.closest('section')).map((el) => el.textContent || '').join(' ').trim();
})()`;

test.describe('LearnThrive AI: the activity panel in the real chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('while a verified answer is being prepared there is one progress interface, inside the answer, and the box does not move', async ({ page }) => {
    await enrolled(page);
    await open(page);
    const message = page.getByLabel('Your message');
    const notice = page.getByText(/Answers are AI-generated and may be wrong/);
    const before = { message: await box(message), notice: await box(notice) };

    await ask(page, `[slow] ${HELD}`, { first: true });
    const panel = page.locator(`${ANSWER} ${PANEL}`);
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute('data-phase', 'running');
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

    // ONE indicator, and it is the panel's. The line that used to sit under the box (three dots and "Thinking") is not on the page at all.
    await expect(page.getByText('Thinking', { exact: true })).toHaveCount(0);
    await expect(page.locator(ANSWER)).toHaveCount(1);
    await expect(page.locator(PANEL)).toHaveCount(1);
    // Nothing else announces progress: of the status regions, only the page's one polite announcer has words in it, and the panel has none of its own.
    await expect(page.locator('[role="status"]:not(:empty)')).toHaveCount(1);
    await expect(page.locator(`${PANEL} [aria-live], ${PANEL} [role="status"], ${PANEL} [role="alert"]`)).toHaveCount(0);
    // Exactly one thing is moving in the whole page while it works, when motion is allowed (checked below); here, with reduced motion, nothing.
    expect(await spinners(page)).toBe(0);

    // The box and the notice under it are where they were: the progress is above them, in the conversation. (The Stop button sits above the box.)
    const during = { message: await box(message), notice: await box(notice) };
    expect(Math.abs(during.message.y - before.message.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(during.message.x - before.message.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(during.message.width - before.message.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(during.notice.y - before.notice.y)).toBeLessThanOrEqual(1);
    // No answer text has been released while it is being drafted and checked.
    expect(await page.evaluate(READ_ANSWER)).toBe('');
    // The conversation cannot be changed under a working turn, so a panel can never be left behind in another chat.
    for (const button of await page.getByRole('button', { name: /new chat/i }).all()) await expect(button).toBeDisabled();
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  });

  test('with motion allowed the only thing moving while it works is the one ring in the panel', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await enrolled(page);
    await open(page);
    await ask(page, `[slow] ${HELD}`, { first: true });
    await expect(page.locator(`${ANSWER} ${PANEL}`)).toHaveAttribute('data-phase', 'running');
    const tier = await page.locator('html').getAttribute('data-motion-tier');
    // Counted after a moment, so the entrance animations of the page are over: what is left is what loops.
    await page.waitForTimeout(1200);
    const loops = await spinners(page);
    expect(loops).toBeLessThanOrEqual(1);
    if (tier !== 'full') expect(loops).toBe(0);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    expect(await spinners(page)).toBe(0);
  });

  test('a verified answer arrives once, whole, with the notes the checks add, and the panel folds into a true summary', async ({ page }) => {
    await enrolled(page);
    await open(page);
    const message = page.getByLabel('Your message');
    const before = await box(message);
    // Record every state of the answer's text from now on: a held answer must go from nothing to everything, with nothing between.
    await page.evaluate((read) => {
      const seen: string[] = [];
      (window as unknown as { __seen: string[] }).__seen = seen;
      const note = () => {
        const text = eval(read) as string;
        if (text && seen[seen.length - 1] !== text) seen.push(text);
      };
      new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true });
    }, READ_ANSWER);

    await ask(page, HELD, { first: true });
    const panel = page.locator(`${ANSWER} ${PANEL}`);
    await expect(panel).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    const text = await page.evaluate(READ_ANSWER);
    expect(text).toContain('Let us work through it together');
    const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
    // Every state the page ever showed was already the complete answer: its first word to the note the checks added under it. (A second state
    // can follow, only because the maths is drawn once its library has loaded: the words are the same.)
    expect(seen.length).toBeGreaterThanOrEqual(1);
    for (const state of seen) {
      expect(state, 'a state that was only part of the answer').toContain('Tell me what you get and I will check it.');
      expect(state, 'a state before the notes were added').toContain('No web sources could be read');
    }

    // Finished: one folded row with a true summary (no web search is wired to this server, so it says so), nothing spinning, the box as it was.
    await expect(panel.getByRole('button').first()).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toContainText('Sources could not be reached');
    await expect(panel).not.toContainText('completed');
    expect(await spinners(page)).toBe(0);
    await expect(page.getByRole('status').filter({ hasText: 'The answer is ready.' })).toHaveCount(1);
    expect(Math.abs((await box(message)).y - before.y)).toBeLessThanOrEqual(1);
    await expect(message).toBeEnabled();
    // The note under the answer says what could not be checked, instead of leaving it looking verified, and the research is not narrated in it.
    await expect(page.locator(ANSWER)).toContainText('No web sources could be read');
    expect(text).not.toMatch(/I'll now search|Let me check|Sources read/i);

    // The panel opens again to show what was done.
    await panel.getByRole('button').first().click();
    await expect(panel.getByRole('list', { name: 'Steps' })).toBeVisible();
    await expect(panel.getByRole('listitem').filter({ hasText: 'Searching the web for sources' })).toContainText('did not work');
    await expectAxeClean(page, 'LearnThrive AI, a researched answer, panel open');
  });

  test('ordinary chat is not held and not given a panel when it is over: it streams, and leaves nothing behind', async ({ page }) => {
    await enrolled(page);
    await open(page);
    await ask(page, '[slow] go on', { first: true });
    const answer = page.locator(ANSWER).first();
    await expect(answer).toContainText('Step 1 of the long working.');
    // It is streaming: part of it is on the page while the turn is still going, and the one indicator is in the message.
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(page.locator(PANEL)).toHaveCount(1);
    await expect(page.getByText('Thinking', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    // Nothing was researched or checked, so there is no folded row to show, and nothing is spinning.
    await expect(page.locator(PANEL)).toHaveCount(0);
    expect(await spinners(page)).toBe(0);
    await expect(page.getByLabel('Your message')).toBeEnabled();
  });

  test('Stop while an answer is being checked releases nothing, removes the waiting message and leaves no spinner', async ({ page }) => {
    await enrolled(page);
    await open(page);
    await ask(page, `[slow] ${HELD}`, { first: true });
    await expect(page.locator(`${ANSWER} ${PANEL}`)).toHaveAttribute('data-phase', 'running');
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    await expect(page.locator(ANSWER)).toHaveCount(0);
    await expect(page.locator(PANEL)).toHaveCount(0);
    expect(await spinners(page)).toBe(0);
    await expect(page.getByLabel('Your message')).toBeEnabled();
    await expect(alerts(page)).toHaveCount(0);
    // The question is still in the conversation, and the chat is usable.
    await expect(page.locator('article[aria-label="You"]').first()).toContainText('photosynthesis');
    await ask(page, 'hello there');
    await expect(page.locator(ANSWER)).toContainText('Good question');
  });

  test('a stream that ends without its closing event is an interruption, not a finished answer', async ({ page }) => {
    await enrolled(page);
    await open(page);
    await page.route('**/api/assistant/chat', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: [{ type: 'session', sessionId: '00000000-0000-4000-8000-000000000001' }, { type: 'activity', step: { id: 'search-1', kind: 'search', state: 'running', label: 'Searching the web for sources' } }, { type: 'delta', text: 'Half of an ans' }].map((e) => JSON.stringify(e)).join('\n') + '\n',
      }),
    );
    await ask(page, 'hello there', { first: true });
    await expect(alerts(page).filter({ hasText: 'We lost the connection before the answer was finished' })).toBeVisible();
    const panel = page.locator(`${ANSWER} ${PANEL}`);
    await expect(panel).toHaveAttribute('data-phase', 'failed');
    await expect(panel).not.toContainText('completed');
    await expect(panel).toContainText('Could not finish checking');
    expect(await spinners(page)).toBe(0);
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    await expect(page.getByLabel('Your message')).toBeEnabled();
    // What did arrive is kept, and no step is shown as still going.
    await expect(page.locator(ANSWER)).toContainText('Half of an ans');
    await panel.getByRole('button').first().click();
    await expect(panel.getByRole('listitem').filter({ hasText: 'in progress' })).toHaveCount(0);
  });

  test('a server error ends the turn: its words, no spinner, no panel left behind', async ({ page }) => {
    await enrolled(page);
    await open(page);
    await page.route('**/api/assistant/chat', (route) =>
      route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: [{ type: 'session', sessionId: '00000000-0000-4000-8000-000000000002' }, { type: 'error', code: 'unavailable' }].map((e) => JSON.stringify(e)).join('\n') + '\n' }),
    );
    await ask(page, 'hello there', { first: true });
    await expect(alerts(page).filter({ hasText: 'could not answer just now' })).toBeVisible();
    await expect(page.locator(ANSWER)).toHaveCount(0);
    await expect(page.locator(PANEL)).toHaveCount(0);
    expect(await spinners(page)).toBe(0);
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    await expect(page.getByLabel('Your message')).toBeEnabled();
  });

  test('a reopened chat shows the panel with what was done, folded, and a chat can be left and opened without a leftover indicator', async ({ page }) => {
    await enrolled(page);
    await open(page);
    await ask(page, HELD, { first: true });
    const panel = page.locator(`${ANSWER} ${PANEL}`);
    await expect(panel).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
    await page.reload();
    await hydrated(page);
    await page.getByRole('button', { name: /Explain how photosynthesis/ }).first().click();
    const again = page.locator(`${ANSWER} ${PANEL}`);
    await expect(again).toHaveCount(1);
    await expect(again).toHaveAttribute('data-phase', 'done');
    await expect(again).toContainText('Sources could not be reached');
    await expect(again.getByRole('button').first()).toHaveAttribute('aria-expanded', 'false');
    await again.getByRole('button').first().click();
    await expect(again.getByRole('list', { name: 'Steps' })).toBeVisible();
    expect(await spinners(page)).toBe(0);
    // A new chat starts clean: no panel, no indicator, no Stop.
    await page.getByRole('button', { name: /new chat/i }).first().click();
    await expect(page.locator(ANSWER)).toHaveCount(0);
    await expect(page.locator(PANEL)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  });

  test('on a phone the panel and the box fit, and nothing overlaps, while it works and when it is done', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await enrolled(page);
    await open(page);
    const fits = async (panel: Locator) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const p = await box(panel);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(360);
      // The panel sits in the conversation, above the box: they never overlap.
      const m = await box(page.getByLabel('Your message'));
      expect(p.y + p.height).toBeLessThanOrEqual(m.y + 1);
    };
    await ask(page, `[slow] ${HELD}`, { first: true });
    const working = page.locator(`${ANSWER} ${PANEL}`);
    await expect(working).toHaveAttribute('data-phase', 'running');
    await fits(working);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    // A finished turn, opened.
    await ask(page, HELD);
    const done = page.locator(`${ANSWER} ${PANEL}`);
    await expect(done).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
    await done.getByRole('button').first().click();
    await expect(done.getByRole('list', { name: 'Steps' })).toBeVisible();
    await fits(done);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the working state is accessible (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
      await enrolled(page);
      await open(page);
      await ask(page, `[slow] ${HELD}`, { first: true });
      await expect(page.locator(`${ANSWER} ${PANEL}`)).toHaveAttribute('data-phase', 'running');
      await expectAxeClean(page, `LearnThrive AI, working (${scheme})`);
      await page.getByRole('button', { name: 'Stop' }).click();
    });
  }

  test('the composer keeps every control while it works: the box, the attach buttons and Send are there, Send and the box are held, Stop is offered', async ({ page }) => {
    await enrolled(page);
    await open(page);
    await ask(page, `[slow] ${HELD}`, { first: true });
    await expect(page.locator(`${ANSWER} ${PANEL}`)).toHaveAttribute('data-phase', 'running');
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
    for (const name of ['Take a photo', 'Add an image', 'Add a file']) await expect(page.getByRole('button', { name })).toBeVisible();
    await expect(page.getByText(/Answers are AI-generated and may be wrong/)).toBeVisible();
    await expect(page.getByRole('link', { name: /privacy/i }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled(); // nothing typed yet
    await page.getByLabel('Your message').fill('thanks');
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  });
});
