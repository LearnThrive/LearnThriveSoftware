import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { hydrated } from './careers-support';

// The Study Buddy activity panel (the one indicator inside an answer). Runs against the development bench /dev/ui-components/activity-panel:
// every state of the panel as a fixture, and one live turn that is moved along one event at a time with the same functions the page uses, so the
// panel can be looked at between any two events. Nothing here touches a server.

const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const WCAG22 = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const BENCH = '/dev/ui-components/activity-panel';
const PANEL = 'section[aria-label="What LearnThrive AI did for this answer"]';

async function expectNoAxeViolations(page: Page, label: string) {
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = (await page.evaluate(async (tags) => {
    // @ts-expect-error injected global, no types installed for the browser build
    return await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
  }, WCAG22)) as { violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> };
  const lines = results.violations.map((v) => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`);
  expect(results.violations, `${label}: ${results.violations.length} accessibility violation(s)\n\n${lines.join('\n\n')}`).toEqual([]);
}

async function open(page: Page) {
  await page.goto(BENCH);
  await hydrated(page);
  await expect(page.getByRole('heading', { level: 1, name: 'ActivityPanel' })).toBeVisible();
}

const panelIn = (page: Page, id: string) => page.locator(`#bench-${id} ${PANEL}`);
const head = (panel: Locator) => panel.getByRole('button').first();
const live = (page: Page) => page.getByTestId('live');
const press = (page: Page, name: string) => live(page).getByRole('button', { name, exact: true });

async function infiniteAnimations(page: Page): Promise<number> {
  return page.evaluate(() => document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations === Infinity).length);
}

test.describe('ActivityPanel: states', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  const SAYS: Array<[string, string]> = [
    ['running', 'Reading www.folger.edu…'],
    ['verifying', 'Checking quotations and facts against the sources…'],
    ['done', 'Research and verification completed'],
    ['research-only', 'Research completed'],
    ['partial', 'Sources read, but some checks could not finish'],
    ['limited', 'Sources could not be reached'],
    ['failed', 'Could not finish checking'],
    ['stopped', 'Stopped'],
    ['calculation', 'Checks completed'],
  ];

  test('every state says only what is true of its steps', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    await open(page);
    for (const [id, words] of SAYS) await expect(head(panelIn(page, id)), id).toContainText(words);
    // "Completed" needs a page that was read AND no failed check: the two states that lack one say something else.
    await expect(page.locator(`#bench-partial ${PANEL}`)).not.toContainText('Research and verification completed');
    await expect(page.locator(`#bench-limited ${PANEL}`)).not.toContainText('completed');
    expect(problems).toEqual([]);
  });

  test('a finished panel is one folded row that opens by keyboard to the sources and closes again', async ({ page }) => {
    await open(page);
    const panel = panelIn(page, 'done');
    const button = head(panel);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toContainText('2 sources');
    await expect(panel.getByRole('list', { name: 'Steps' })).toBeHidden();
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const links = panel.getByRole('link');
    await expect(links).toHaveCount(2);
    await expect(links.first()).toHaveAttribute('href', 'https://www.folger.edu/read');
    await expect(links.first()).toHaveAttribute('rel', /noopener/);
    await expect(links.first()).toHaveAttribute('target', '_blank');
    await expect(panel.getByText('www.folger.edu · primary text · read in a browser')).toBeVisible();
    // The failed page is listed as failed, with no link.
    await expect(panel.getByRole('listitem').filter({ hasText: 'Reading www.example.org' })).toContainText('did not work');
    await expect(panel.getByRole('listitem').filter({ hasText: 'Reading www.example.org' }).getByRole('link')).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.getByRole('list', { name: 'Steps' })).toBeHidden();
  });

  test('a panel with nothing to list cannot be opened', async ({ page }) => {
    await open(page);
    const pending = head(panelIn(page, 'pending'));
    await expect(pending).toBeDisabled();
    await expect(pending).not.toHaveAttribute('aria-expanded', /.*/);
  });

  test('the panel is not a live region: a screen reader is told once by the page, not by every step', async ({ page }) => {
    await open(page);
    await expect(page.locator(`${PANEL}[aria-live], ${PANEL} [aria-live], ${PANEL} [role="status"], ${PANEL} [role="alert"]`)).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`no accessibility violations, every state (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
      await open(page);
      // Open them all, so the lists and links are part of what is checked.
      for (const [id] of SAYS) {
        const button = head(panelIn(page, id));
        if ((await button.getAttribute('aria-expanded')) === 'false') await button.click();
      }
      await expectNoAxeViolations(page, `activity panel (${scheme})`);
    });
  }

  for (const width of [360, 1280]) {
    test(`nothing overflows sideways at ${width}px, with everything open`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      for (const [id] of SAYS) {
        const button = head(panelIn(page, id));
        if ((await button.getAttribute('aria-expanded')) === 'false') await button.click();
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('under reduced motion nothing in the panel loops', async ({ page }) => {
    await open(page);
    expect(await infiniteAnimations(page)).toBe(0);
  });
});

test.describe('ActivityPanel: a live turn', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('it shows the step in progress, one indicator, then folds into one row when the turn finishes', async ({ page }) => {
    await open(page);
    const panel = live(page).locator(PANEL);
    const button = head(panel);
    // Just sent: one panel, saying so, nothing to list yet.
    await expect(panel).toHaveCount(1);
    await expect(button).toContainText('Working through it…');
    await expect(panel).toHaveAttribute('data-phase', 'running');

    await press(page, 'Next event').click(); // analyse running
    await expect(button).toContainText('Understanding your question…');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await press(page, 'Next event').click(); // analyse done
    await press(page, 'Next event').click(); // search running
    await expect(button).toContainText('Searching the web for sources…');
    await press(page, 'Next event').click(); // search done
    await press(page, 'Next event').click(); // read running
    await expect(button).toContainText('Reading www.bbc.co.uk…');
    // The step in progress is marked as such; the finished ones are done. Exactly one thing is in progress.
    await expect(panel.getByRole('listitem').filter({ hasText: 'in progress' })).toHaveCount(1);
    await expect(panel.getByRole('listitem').filter({ hasText: 'Searching the web for sources' })).toContainText('done');
    await press(page, 'Next event').click(); // read done: a source appears, linked
    await expect(panel.getByRole('link', { name: /Photosynthesis - Bitesize/ })).toHaveAttribute('href', 'https://www.bbc.co.uk/read');
    await press(page, 'Next event').click(); // verify running
    await expect(button).toContainText('Checking names and terms against the sources…');
    await press(page, 'Next event').click(); // verify done
    await expect(press(page, 'Next event')).toBeDisabled();
    await expect(panel).toHaveAttribute('data-phase', 'running');
    await expect(button).toHaveAttribute('aria-expanded', 'true');

    await press(page, 'Finish').click();
    // The turn is over: one folded row, a true summary, nothing spinning, the steps and sources one press away.
    await expect(panel).toHaveAttribute('data-phase', 'done');
    await expect(button).toHaveText(/Research and verification completed/);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toContainText('1 source');
    await expect(panel.getByRole('list', { name: 'Steps' })).toBeHidden();
    expect(await infiniteAnimations(page)).toBe(0);
    await button.click();
    await expect(panel.getByRole('listitem')).toHaveCount(4);
    await expect(panel.getByRole('listitem').filter({ hasText: 'in progress' })).toHaveCount(0);
  });

  test('Fail ends every step that was in progress as failed, and the row says it could not finish', async ({ page }) => {
    await open(page);
    const panel = live(page).locator(PANEL);
    for (let i = 0; i < 5; i += 1) await press(page, 'Next event').click(); // a page read is in progress
    await expect(panel.getByRole('listitem').filter({ hasText: 'in progress' })).toHaveCount(1);
    await press(page, 'Fail').click();
    await expect(panel).toHaveAttribute('data-phase', 'failed');
    await expect(head(panel)).toContainText('Could not finish checking');
    await head(panel).click();
    await expect(panel.getByRole('listitem').filter({ hasText: 'in progress' })).toHaveCount(0);
    await expect(panel.getByRole('listitem').filter({ hasText: 'Reading www.bbc.co.uk' })).toContainText('did not work');
    await expect(press(page, 'Finish')).toBeDisabled();
  });

  test('Stop leaves nothing in progress and says Stopped', async ({ page }) => {
    await open(page);
    const panel = live(page).locator(PANEL);
    for (let i = 0; i < 3; i += 1) await press(page, 'Next event').click();
    await press(page, 'Stop').click();
    await expect(panel).toHaveAttribute('data-phase', 'stopped');
    await expect(head(panel)).toContainText('Stopped');
    expect(await infiniteAnimations(page)).toBe(0);
    await head(panel).click();
    await expect(panel.getByRole('listitem').filter({ hasText: 'in progress' })).toHaveCount(0);
  });

  test('a panel the student opened stays open when the turn finishes; one they left alone folds', async ({ page }) => {
    await open(page);
    const panel = live(page).locator(PANEL);
    await press(page, 'Next event').click();
    await press(page, 'Next event').click();
    await press(page, 'Next event').click();
    // Fold it during the turn: it stays folded, and finishing does not re-open it.
    await head(panel).click();
    await expect(head(panel)).toHaveAttribute('aria-expanded', 'false');
    await press(page, 'Finish').click();
    await expect(head(panel)).toHaveAttribute('aria-expanded', 'false');
    await head(panel).click();
    await expect(head(panel)).toHaveAttribute('aria-expanded', 'true');
  });

  test('Reset starts a new turn with a fresh, single panel', async ({ page }) => {
    await open(page);
    await press(page, 'Next event').click();
    await press(page, 'Finish').click();
    await press(page, 'Reset').click();
    const panel = live(page).locator(PANEL);
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute('data-phase', 'running');
    await expect(head(panel)).toContainText('Working through it…');
  });

  test('while it runs, the spinner is the only motion and it is one element (motion allowed)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page);
    const panel = live(page).locator(PANEL);
    await press(page, 'Next event').click();
    const tier = await page.locator('html').getAttribute('data-motion-tier');
    // At most one looping animation in the whole panel: never a second indicator.
    const loops = await panel.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.effect?.getComputedTiming().iterations === Infinity).length);
    expect(loops).toBeLessThanOrEqual(1);
    if (tier !== 'full') expect(loops).toBe(0);
  });
});
