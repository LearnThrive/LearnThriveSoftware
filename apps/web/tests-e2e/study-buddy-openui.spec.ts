import { test, expect, type Page } from '@playwright/test';
import { hydrated } from './careers-support';
import { address, confirm, distinctVisitor, expectAxeClean, signUp } from './account-support';

// Interactive answers (OpenUI) in the real chat, on the server with the MOCK provider (ASSISTANT_PROVIDER=mock). The mock writes scripted interfaces, so
// these specs prove the CODE: streaming, checking, drawing, interacting, falling back, persisting. They do not prove that Beam can write a valid
// interface; that is measured separately with a real key (docs/OPENUI.md). The student's message steers the mock: "[ui:invalid]" is never valid,
// "[ui:fixable]" is invalid once, "[slow]" streams slowly (to inspect the page mid-stream and to Stop it).

distinctVisitor();

const ANSWER = 'article[aria-label="LearnThrive AI"]';
const INTERFACE = '[data-interface="answer"]';

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

/** A new chat for a signed-in, enrolled adult, with the first question asked. */
async function start(page: Page, text: string) {
  await enrolled(page);
  await open(page);
  await ask(page, text, { first: true });
}

const last = (page: Page) => page.locator(ANSWER).last();
const ready = async (page: Page) => {
  await expect(last(page).locator(INTERFACE)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-streaming="true"]')).toHaveCount(0, { timeout: 30_000 });
};

test.describe('interactive answers', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('1. an ordinary question is answered in words: no interface, plain text', async ({ page }) => {
    await start(page, 'Explain photosynthesis');
    await expect(last(page)).toContainText('Good question');
    await expect(page.locator(INTERFACE)).toHaveCount(0);
    await expect(last(page).locator('.katex')).toBeVisible();
  });

  test('2 and 3. a graph is drawn from its formula, and the slider moves the curve with the real values and no further request', async ({ page }) => {
    const chats: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/assistant/chat')) chats.push(r.url());
    });
    await start(page, 'Plot y = x² and let me move it');
    await ready(page);
    const graph = last(page).locator('figure svg[role="img"]').first();
    await expect(graph).toHaveAttribute('aria-label', /Graph of y = a x²/);
    const curve = graph.locator('polyline');
    await expect(curve.first()).toBeVisible();
    const before = await curve.first().getAttribute('points');
    const values = last(page).locator('details', { hasText: 'Show the values as a table' });
    await values.locator('summary').click();
    // x = 4: y = a x² with a = 1 is 16.
    const row = values.locator('tr', { has: page.locator('th', { hasText: /^4$/ }) });
    await expect(row.locator('td')).toHaveText('16');
    await expect(last(page).getByText('a = 1', { exact: true })).toBeVisible();

    const requestsBefore = chats.length;
    await last(page).getByLabel('Value of a').fill('3');
    await expect(last(page).getByText('a = 3', { exact: true })).toBeVisible();
    await expect(row.locator('td')).toHaveText('48');
    expect(await curve.first().getAttribute('points')).not.toBe(before);
    expect(chats.length, 'moving the slider asked nobody anything').toBe(requestsBefore);
    // Negative a turns the curve over: x = 4 gives -16.
    await last(page).getByLabel('Value of a').fill('-1');
    await expect(row.locator('td')).toHaveText('-16');
    await expectAxeClean(page, 'graph with a slider');
  });

  test('4 and 5. a quiz is marked in the page: hints, wrong and right answers, retry, and a score at the end', async ({ page }) => {
    await start(page, 'Quiz me on photosynthesis');
    await ready(page);
    const quiz = last(page).locator('section', { hasText: 'Question 1 of 3' });
    await expect(quiz.getByRole('button', { name: 'Check answer' })).toBeDisabled();
    await quiz.getByRole('button', { name: 'Show a hint' }).click();
    await expect(quiz.getByText('Think about what plants build glucose from.')).toBeVisible();
    await quiz.getByRole('radio', { name: 'Oxygen' }).check();
    await quiz.getByRole('button', { name: 'Check answer' }).click();
    await expect(quiz.getByRole('status').filter({ hasText: 'Not quite.' })).toBeVisible();
    await expect(quiz.getByText('Correct answer')).toBeVisible();
    await expect(quiz.getByText('Your answer')).toBeVisible();
    await quiz.getByRole('button', { name: 'Try this question again' }).click();
    await quiz.getByRole('radio', { name: 'Carbon dioxide' }).check();
    await quiz.getByRole('button', { name: 'Check answer' }).click();
    await expect(quiz.getByRole('status').filter({ hasText: 'Correct!' })).toBeVisible();
    await expect(quiz.getByText('Plants take in carbon dioxide and give out oxygen.')).toBeVisible();
    await quiz.getByRole('button', { name: 'Next question' }).click();

    // A short answer: wrong, then right in a different form (case and a full stop do not matter).
    await expect(last(page).getByRole('heading', { name: /green pigment/ })).toBeFocused();
    await last(page).getByLabel('Your answer').fill('chloroplast');
    await last(page).getByRole('button', { name: 'Check answer' }).click();
    await expect(last(page).getByText(/A correct answer is/)).toContainText('chlorophyll');
    await last(page).getByRole('button', { name: 'Try this question again' }).click();
    await last(page).getByLabel('Your answer').fill('Chlorophyll.');
    await last(page).getByLabel('Your answer').press('Enter');
    await expect(last(page).getByRole('status').filter({ hasText: 'Correct!' })).toBeVisible();
    await last(page).getByRole('button', { name: 'Next question' }).click();

    await last(page).getByRole('radio', { name: '42' }).check();
    await last(page).getByRole('button', { name: 'Check answer' }).click();
    await expect(last(page).getByRole('status').filter({ hasText: 'Correct!' })).toBeVisible();
    await last(page).getByRole('button', { name: 'See my score' }).click();
    await expect(last(page).getByRole('status').filter({ hasText: '3 of 3 correct (100%)' })).toBeVisible();
    await expect(last(page).getByText('hints used on 1 question')).toBeVisible();
    await last(page).getByRole('button', { name: 'Try the quiz again' }).click();
    await expect(last(page).getByText('Question 1 of 3')).toBeVisible();
  });

  test('a quiz can be done with the keyboard alone', async ({ page }) => {
    await start(page, 'Quiz me on photosynthesis');
    await ready(page);
    const radio = last(page).getByRole('radio', { name: 'Carbon dioxide' });
    await radio.focus();
    await page.keyboard.press('Space');
    await expect(radio).toBeChecked();
    await last(page).getByRole('button', { name: 'Check answer' }).focus();
    await page.keyboard.press('Enter');
    await expect(last(page).getByRole('status').filter({ hasText: 'Correct!' })).toBeVisible();
    await expectAxeClean(page, 'quiz after checking');
  });

  test('6. flashcards flip, move and keep count', async ({ page }) => {
    await start(page, 'Make flashcards on photosynthesis');
    await ready(page);
    const deck = last(page).locator('section[aria-label="Photosynthesis"]');
    await expect(deck.getByText('Card 1 of 3')).toBeVisible();
    const card = deck.getByRole('button', { name: /What does photosynthesis make/ });
    await expect(card).toHaveAttribute('aria-pressed', 'false');
    await card.click();
    await expect(deck.getByRole('button', { name: /Glucose and oxygen/ })).toHaveAttribute('aria-pressed', 'true');
    await deck.getByRole('button', { name: 'I knew it' }).click();
    await expect(deck.getByText('Card 2 of 3 · knew 1 of 3')).toBeVisible();
    await deck.getByRole('button', { name: 'Previous' }).click();
    await expect(deck.getByText('Card 1 of 3')).toBeVisible();
  });

  test('7. a process diagram shows its stages and a balanced equation with subscripts', async ({ page }) => {
    await start(page, 'Show me a diagram of photosynthesis');
    await ready(page);
    await expect(last(page).getByText('Light is absorbed')).toBeVisible();
    await expect(last(page).getByText('Glucose is made')).toBeVisible();
    const equation = last(page).getByRole('img', { name: /6CO2 plus 6H2O.*gives C6H12O6 plus 6O2/ });
    await expect(equation).toBeVisible();
    // 6CO2 6H2O C6H12O6 6O2: subscripts 2, 2, 6, 12, 6, 2.
    await expect(equation.locator('sub')).toHaveCount(6);
    await expectAxeClean(page, 'process diagram');
  });

  test('8 and 9. a literary comparison with quotation cards: with nothing to check them against they are NEVER shown as verified', async ({ page }) => {
    await start(page, 'Compare these two quotations side by side');
    await ready(page);
    await expect(last(page).locator('table')).toBeVisible();
    const cards = last(page).locator('figure[data-verification]');
    await expect(cards).toHaveCount(2);
    for (const card of await cards.all()) {
      await expect(card).toHaveAttribute('data-verification', 'UNVERIFIED');
      await expect(card.getByText('Not verified')).toBeVisible();
      // Why it could not be checked varies (no search, a search that found no pages); that it is NOT shown as checked does not.
      await expect(card.getByText(/could not be checked|returned no pages|No page could be read|not available/)).toBeVisible();
      await expect(card.getByRole('button', { name: /Copy this quotation/ })).toHaveCount(0);
    }
    await expect(last(page).getByText(/Checked: exact words|Checked: close to the text/)).toHaveCount(0);
  });

  test('10. a worked solution is revealed one step at a time', async ({ page }) => {
    await start(page, 'Take me through 2x + 7 = 19 step by step, one step at a time');
    await ready(page);
    const solution = last(page).locator('section[aria-label="Solve 2x + 7 = 19"]');
    await expect(solution.getByText('0 of 3 steps shown')).toBeVisible();
    await solution.getByRole('button', { name: 'Hint for step 1' }).click();
    await expect(solution.getByText('What undoes adding 7?')).toBeVisible();
    await solution.getByRole('button', { name: 'Show the first step' }).click();
    await expect(solution.getByText('Take 7 from both sides.')).toBeVisible();
    await expect(solution.locator('.katex')).toHaveCount(1);
    await expect(solution.getByText('Divide both sides by 2.')).toHaveCount(0);
    await solution.getByRole('button', { name: 'Show the next step' }).click();
    await expect(solution.getByText('2 of 3 steps shown')).toBeVisible();
    await solution.getByRole('button', { name: 'Show all steps' }).click();
    await expect(solution.getByText('Answer:')).toBeVisible();
    await expect(solution.getByText('12 / 2 = 6')).toBeVisible();
    await solution.getByRole('button', { name: 'Hide the steps and try again' }).click();
    await expect(solution.getByText('0 of 3 steps shown')).toBeVisible();
  });

  test('11. an interface streams in with its controls off, and they work when it is checked and complete', async ({ page }) => {
    await start(page, 'Quiz me on photosynthesis [slow]');
    await expect(page.locator('[data-streaming="true"]')).toBeVisible({ timeout: 30_000 });
    // Drawn while it arrives, but nothing can be used yet.
    await expect(page.getByText(/Question 1 of/)).toBeVisible({ timeout: 30_000 });
    for (const button of await last(page).getByRole('button', { name: /Check answer|Show a hint/ }).all()) await expect(button).toBeDisabled();
    await expect(page.locator('[data-streaming="true"]')).toHaveCount(0, { timeout: 60_000 });
    await last(page).getByRole('radio', { name: 'Carbon dioxide' }).check();
    await expect(last(page).getByRole('button', { name: 'Check answer' })).toBeEnabled();
  });

  test('12. Stop cancels an interface: nothing half-built stays, and the box works again', async ({ page }) => {
    await start(page, 'Quiz me on photosynthesis [slow]');
    await expect(page.locator('[data-streaming="true"]')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /stop/i }).click();
    await expect(page.locator('[data-streaming="true"]')).toHaveCount(0);
    await expect(page.locator(INTERFACE)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /send/i })).toBeVisible();
    await ask(page, 'Explain photosynthesis');
    await expect(last(page)).toContainText('Good question');
  });

  test('13 and 14. an interface that never becomes valid is dropped, and the answer is given in words, without the program, and the chat carries on', async ({ page }) => {
    const wires: string[] = [];
    page.on('request', (r) => wires.push(r.url()));
    for (const marker of ['[ui:invalid]', '[ui:truncated]', '[ui:script]', '[ui:action]']) {
      if (marker === '[ui:invalid]') await start(page, `Quiz me on photosynthesis ${marker}`);
      else await ask(page, `Quiz me on photosynthesis ${marker}`);
      await expect(last(page)).toContainText('I could not build the interactive version, so here is the explanation in words.', { timeout: 30_000 });
      await expect(page.locator(INTERFACE)).toHaveCount(0);
      await expect(page.getByText(/root = Answer|NotARealComponent|openui/)).toHaveCount(0);
      await expect(page.locator('script', { hasText: 'alert(1)' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
    }
    expect(wires.filter((u) => u.includes('evil.example')), 'nothing was fetched from an address a program named').toEqual([]);
    // The conversation is intact: it carries on.
    await ask(page, 'Explain photosynthesis');
    await expect(last(page)).toContainText('Good question');
  });

  test('a wrong answer key is caught and corrected before the quiz is shown', async ({ page }) => {
    await start(page, 'Quiz me on photosynthesis [ui:fixable]');
    await ready(page);
    // The corrected quiz has the right key for 6 × 7.
    const quiz = last(page);
    await quiz.getByRole('radio', { name: 'Carbon dioxide' }).check();
    await quiz.getByRole('button', { name: 'Check answer' }).click();
    await quiz.getByRole('button', { name: 'Next question' }).click();
    await quiz.getByLabel('Your answer').fill('chlorophyll');
    await quiz.getByRole('button', { name: 'Check answer' }).click();
    await quiz.getByRole('button', { name: 'Next question' }).click();
    await quiz.getByRole('radio', { name: '42' }).check();
    await quiz.getByRole('button', { name: 'Check answer' }).click();
    await expect(quiz.getByRole('status').filter({ hasText: 'Correct!' })).toBeVisible();
  });

  test('15. a reopened chat shows the interface again, working', async ({ page }) => {
    await start(page, 'Quiz me on photosynthesis');
    await ready(page);
    await page.reload();
    await hydrated(page);
    await page.getByRole('region', { name: 'Your chats' }).getByRole('button', { name: 'Quiz me on photosynthesis', exact: true }).click();
    await expect(page.locator(INTERFACE)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Question 1 of 3')).toBeVisible();
    await page.getByRole('radio', { name: 'Carbon dioxide' }).check();
    await page.getByRole('button', { name: 'Check answer' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Correct!' })).toBeVisible();
  });

  test('16. a follow-up button asks the question in the conversation, as the student, through the ordinary route', async ({ page }) => {
    await start(page, 'Quiz me on photosynthesis');
    await ready(page);
    const asked: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/assistant/chat') && r.method() === 'POST') asked.push(r.postData() ?? '');
    });
    await last(page).getByRole('button', { name: 'Explain the word equation' }).click();
    await expect(page.locator('article[aria-label="You"]').last()).toContainText('Explain the word equation');
    await expect(last(page)).toContainText('Good question', { timeout: 30_000 });
    expect(asked).toHaveLength(1);
    expect(JSON.parse(asked[0]!)).toMatchObject({ text: 'Explain the word equation' });
    expect(Object.keys(JSON.parse(asked[0]!)).sort()).toEqual(['fileIds', 'sessionId', 'text']);
  });

  test('17. an interface cannot reach anything privileged: the chat route refuses a named model, and the status carries no model, key or address', async ({ page }) => {
    await enrolled(page);
    await open(page);
    const refused = await page.request.post('/api/assistant/chat', { data: { text: 'hello', adultAck: true, model: 'beam' } });
    expect(refused.status()).toBe(400);
    expect((await refused.json()).code).toBe('bad_model');
    const status = await (await page.request.get('/api/assistant/status')).text();
    expect(status).not.toMatch(/models|OLLAMA|nvapi|NVIDIA|ollama\.com|api[_-]?key/i);
    expect(JSON.parse(status).interactive).toBe(true);
  });

  test('18. the layout holds on a phone and on a desktop: nothing makes the page scroll sideways, wide tables scroll inside themselves', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await start(page, 'Compare these two quotations side by side');
    await ready(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow(), 'phone: no sideways scroll').toBeLessThanOrEqual(1);
    await expect(last(page).getByRole('group', { name: 'Side by side' })).toBeVisible();
    await page.screenshot({ path: 'test-results/openui-phone-comparison.png', fullPage: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(await overflow(), 'desktop: no sideways scroll').toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'test-results/openui-desktop-comparison.png', fullPage: false });
  });

  test('19. keyboard and accessibility: every control is reachable and focus is visible, and axe finds nothing on the quiz, graph and flashcards', async ({ page }) => {
    await start(page, 'Plot y = x² and let me move it');
    await ready(page);
    await last(page).getByLabel('Value of a').focus();
    await page.keyboard.press('ArrowRight');
    await expect(last(page).getByText(/^a = 0\.5$|^a = 1\.5$/)).toBeVisible();
    const outline = await last(page).getByLabel('Value of a').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
    await expectAxeClean(page, 'graph');
    await ask(page, 'Make flashcards on photosynthesis');
    await expect(last(page).getByText('Card 1 of 3')).toBeVisible({ timeout: 30_000 });
    await expectAxeClean(page, 'flashcards');
  });

  test('a timeline, a checklist and an open question work too', async ({ page }) => {
    await start(page, 'Show me a timeline of the war');
    await ready(page);
    await expect(last(page).getByText('The war begins')).toBeVisible();
    await ask(page, 'Give me a revision checklist on photosynthesis');
    await expect(last(page).getByText('0 of 2 done')).toBeVisible({ timeout: 30_000 });
    await last(page).getByRole('checkbox', { name: 'I can write the word equation' }).check();
    await expect(last(page).getByText('1 of 2 done')).toBeVisible();
    await expectAxeClean(page, 'timeline and checklist');
  });
});
