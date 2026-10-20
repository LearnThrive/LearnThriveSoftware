import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// AiInput and its voice overlay (plan19.md sections 5.4 and 7), on the dev bench at /dev/ui-components/ai-input.
// The bench's first box runs a pretend voice pipeline: start -> listening, stop -> thinking -> idle with a
// transcript, cancel -> idle. Nothing here touches a microphone or a network.

const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const WCAG22 = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const PATH = '/dev/ui-components/ai-input';

async function runAxe(page: Page, label: string) {
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = (await page.evaluate(async (tags) => {
    // @ts-expect-error injected global, no types installed for the browser build
    return await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
  }, WCAG22)) as { violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> };
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
      .join('\n\n');
    throw new Error(`${label}: ${results.violations.length} accessibility violation(s)\n\n${summary}`);
  }
}

async function openBench(page: Page) {
  await page.goto(PATH);
  // MotionRuntime writes data-motion-tier from an effect, so it only exists once hydration has finished.
  await expect(page.locator('html')).toHaveAttribute('data-motion-tier', /.+/);
}

const interactive = (page: Page) => page.locator('#bench-interactive');
const mic = (page: Page) => interactive(page).getByRole('button', { name: 'Talk instead' });
const overlay = (page: Page) => page.getByRole('dialog', { name: 'Voice mode' });
const stateLabel = (page: Page) => overlay(page).locator('[data-voice-state]');
const events = (page: Page) => page.locator('#events');

async function infiniteAnimations(page: Page) {
  return page.evaluate(() =>
    document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity).length,
  );
}

const consoleErrors: string[] = [];
test.beforeEach(({ page }) => {
  consoleErrors.length = 0;
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
});
test.afterEach(() => {
  expect(consoleErrors, 'no console errors').toEqual([]);
});

test.describe('AiInput: automated accessibility (axe, WCAG 2.2 AA)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`every state on the page, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
      await openBench(page);
      await runAxe(page, `bench (${scheme})`);
    });

    for (const state of ['idle', 'listening', 'thinking', 'speaking'] as const) {
      test(`voice overlay open, ${state}, ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
        await openBench(page);
        await page.locator('#force-voice-state').selectOption(state);
        await mic(page).click();
        await expect(overlay(page)).toBeVisible();
        await expect(stateLabel(page)).toHaveAttribute('data-voice-state', state);
        await runAxe(page, `overlay ${state} (${scheme})`);
      });
    }
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`hover keeps 4.5:1 text contrast on the Talk and Send buttons, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
      await openBench(page);
      await mic(page).click();
      const ratios: number[] = [];
      for (const name of ['Talk', 'Close']) {
        const button = overlay(page).getByRole('button', { name, exact: true });
        await button.hover();
        ratios.push(
          await button.evaluate((element) => {
            const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
            const luminance = ([r, g, b]: number[]) => {
              const channel = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
              return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
            };
            const style = getComputedStyle(element);
            const [r, g, b, a = 1] = parse(style.backgroundColor);
            // A translucent hover tint sits on the dialog's own surface.
            const under = parse(getComputedStyle(element.closest('dialog')!).backgroundColor);
            const fill = [r, g, b].map((v, i) => v * a + under[i] * (1 - a));
            const [x, y] = [luminance(parse(style.color)), luminance(fill)];
            return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
          }),
        );
      }
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }

  test('with the focus ring and a filled transcript', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openBench(page);
    await mic(page).click();
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await expect(overlay(page).getByLabel(/What I heard/)).toHaveValue('What is a quadratic equation?');
    await runAxe(page, 'overlay with transcript');
  });
});

test.describe('AiInput: keyboard only', () => {
  test('Tab reaches every control in order; Enter and Space activate the buttons', async ({ page }) => {
    await openBench(page);
    await interactive(page).locator('select').focus();
    const box = interactive(page);
    await page.keyboard.press('Tab');
    await expect(box.getByRole('button', { name: 'Take a photo' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(box.getByRole('button', { name: 'Add an image' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(box.getByRole('button', { name: 'Add a file' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(box.getByRole('textbox', { name: 'Your message' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(box.getByRole('button', { name: 'Talk instead' })).toBeFocused();
    // Send is disabled while there is nothing to send, so Tab passes it by.
    await expect(box.getByRole('button', { name: 'Send' })).toBeDisabled();

    // Enter and Space both open the file chooser from the real buttons.
    await box.getByRole('button', { name: 'Add a file' }).focus();
    let chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    expect((await chooser).isMultiple()).toBe(true);
    chooser = page.waitForEvent('filechooser');
    await box.getByRole('button', { name: 'Add an image' }).focus();
    await page.keyboard.press('Space');
    expect((await chooser).isMultiple()).toBe(true);

    // Typing makes Send available and Tab reaches it; Space sends.
    await box.getByRole('textbox', { name: 'Your message' }).fill('Hello');
    await page.keyboard.press('Tab'); // mic
    await page.keyboard.press('Tab'); // send
    await expect(box.getByRole('button', { name: 'Send' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.locator('#last-submit')).toHaveAttribute('data-text', 'Hello');
    await expect(box.getByRole('textbox', { name: 'Your message' })).toBeFocused();
    await expect(box.getByRole('textbox', { name: 'Your message' })).toHaveValue('');
  });

  test('Enter sends and Shift+Enter inserts a newline', async ({ page }) => {
    await openBench(page);
    const text = interactive(page).getByRole('textbox', { name: 'Your message' });
    await text.click();
    await page.keyboard.type('line one');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('line two');
    await expect(text).toHaveValue('line one\nline two');
    await expect(page.locator('#last-submit')).toHaveAttribute('data-text', '');
    await page.keyboard.press('Enter');
    await expect(page.locator('#last-submit')).toHaveAttribute('data-text', 'line one\nline two');
    await expect(text).toHaveValue('');
  });

  test('the microphone opens the overlay, Tab stays inside it, Escape closes it and focus returns', async ({ page }) => {
    await openBench(page);
    await mic(page).focus();
    await expect(mic(page)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(overlay(page)).toBeVisible();
    await expect(overlay(page)).toHaveAttribute('aria-modal', 'true');
    await expect(overlay(page).getByRole('button', { name: 'Talk' })).toBeFocused();

    for (let i = 0; i < 9; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);
    }
    for (let i = 0; i < 9; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(mic(page)).toBeFocused();
    await expect(mic(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('a real mouse press (held for a normal click) on the microphone works while the pill is still collapsed', async ({ page }) => {
    // Regression: the pill used to grow on focus-within, so pressing a button moved it away before the click landed.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openBench(page);
    const box = (await mic(page).boundingBox())!;
    for (const hold of [60, 150]) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(hold);
      await page.mouse.up();
      await expect(overlay(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(overlay(page)).toHaveCount(0);
      await page.mouse.move(2, 2);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    }
    // The same press while the text box has focus (the pill is wide) must not take the focus out of the box first.
    const text = interactive(page).getByRole('textbox', { name: 'Your message' });
    await text.click();
    await interactive(page).getByRole('button', { name: 'Add a file' }).dispatchEvent('mousedown');
    await expect(text).toBeFocused();
  });

  test('sending the voice transcript keeps what was typed in the text box', async ({ page }) => {
    await openBench(page);
    await interactive(page).getByRole('textbox', { name: 'Your message' }).fill('my draft');
    await mic(page).click();
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await expect(overlay(page).getByLabel(/What I heard/)).toHaveValue('What is a quadratic equation?');
    await overlay(page).getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('#last-submit')).toHaveAttribute('data-text', 'What is a quadratic equation?');
    await page.keyboard.press('Escape');
    await expect(interactive(page).getByRole('textbox', { name: 'Your message' })).toHaveValue('my draft');
  });

  test('Close button also closes it and returns focus', async ({ page }) => {
    await openBench(page);
    await mic(page).click();
    await overlay(page).getByRole('button', { name: 'Close' }).click();
    await expect(overlay(page)).toHaveCount(0);
    await expect(mic(page)).toBeFocused();
  });

  test('push-to-talk by keyboard: hold Space to talk, release to stop', async ({ page }) => {
    await openBench(page);
    await mic(page).click();
    await expect(stateLabel(page)).toHaveText('Ready');
    await page.keyboard.down('Space');
    await expect(stateLabel(page)).toHaveText('Listening');
    await expect(overlay(page).getByRole('button', { name: 'Talk' })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(500);
    await page.keyboard.up('Space');
    await expect(events(page)).toHaveText('start,stop');
    await expect(overlay(page).getByLabel(/What I heard/)).toHaveValue('What is a quadratic equation?');
    await expect(stateLabel(page)).toHaveText('Ready');
  });

  test('toggle alternative, no sustained pressure: tap Space to start, tap again to stop', async ({ page }) => {
    await openBench(page);
    await mic(page).click();
    await page.keyboard.press('Enter');
    await expect(stateLabel(page)).toHaveText('Listening');
    await expect(events(page)).toHaveText('start');
    await page.keyboard.press('Space');
    await expect(events(page)).toHaveText('start,stop');
    await expect(overlay(page).getByLabel(/What I heard/)).toHaveValue('What is a quadratic equation?');
  });

  test('push-to-talk by pointer: hold to talk; a quick click toggles', async ({ page }) => {
    await openBench(page);
    await mic(page).click();
    const talk = overlay(page).getByRole('button', { name: 'Talk' });
    const box = (await talk.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(stateLabel(page)).toHaveText('Listening');
    await page.waitForTimeout(500);
    await page.mouse.up();
    await expect(events(page)).toHaveText('start,stop');
    await expect(stateLabel(page)).toHaveText('Ready');

    await talk.click(); // quick: starts and stays listening
    await expect(stateLabel(page)).toHaveText('Listening');
    await page.waitForTimeout(450);
    await expect(stateLabel(page)).toHaveText('Listening');
    await talk.click(); // quick: stops
    await expect(events(page)).toHaveText('start,stop,start,stop');
  });

  test('the transcript can be corrected and then sent; Escape while listening cancels', async ({ page }) => {
    await openBench(page);
    await mic(page).click();
    const send = overlay(page).getByRole('button', { name: 'Send' });
    await expect(send).toBeDisabled();
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    const transcript = overlay(page).getByLabel(/What I heard/);
    await expect(transcript).toHaveValue('What is a quadratic equation?');
    await transcript.fill('What is a quadratic formula?');
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.locator('#last-submit')).toHaveAttribute('data-text', 'What is a quadratic formula?');

    await overlay(page).getByRole('button', { name: 'Talk' }).focus();
    await page.keyboard.press('Space'); // tap: listening
    await expect(stateLabel(page)).toHaveText('Listening');
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(events(page)).toContainText('cancel');
    await expect(mic(page)).toBeFocused();
  });

  test('the state is announced in a status region and always written as text', async ({ page }) => {
    await openBench(page);
    await mic(page).click();
    const live = stateLabel(page);
    await expect(live).toHaveAttribute('role', 'status');
    await expect(live).toHaveText('Ready');
    // The same element changes text in place, which is what makes a screen reader announce it.
    const handle = await live.elementHandle();
    await page.keyboard.press('Space');
    await expect(live).toHaveText('Listening');
    await page.keyboard.press('Space');
    await expect(live).toHaveText('Thinking');
    await expect(live).toHaveText('Ready');
    expect(await handle!.evaluate((element) => element.isConnected)).toBe(true);
    for (const state of ['listening', 'thinking', 'speaking'] as const) {
      await overlay(page).getByRole('button', { name: 'Close' }).click();
      await page.locator('#force-voice-state').selectOption(state);
      await mic(page).click();
      await expect(live).toHaveText(state[0].toUpperCase() + state.slice(1));
    }
  });
});

test.describe('AiInput: files', () => {
  const png = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.alloc(2048, 1) });

  test('accept and capture attributes on the real file inputs', async ({ page }) => {
    await openBench(page);
    const box = interactive(page);
    const camera = box.getByTestId('ai-input-camera');
    await expect(camera).toHaveAttribute('type', 'file');
    await expect(camera).toHaveAttribute('accept', 'image/*');
    await expect(camera).toHaveAttribute('capture', 'environment');
    await expect(box.getByTestId('ai-input-image')).toHaveAttribute('accept', 'image/jpeg,image/png');
    await expect(box.getByTestId('ai-input-file')).toHaveAttribute('accept', 'image/jpeg,image/png,application/pdf');
  });

  test('picked files appear as a removable list with sizes; the limit and the type are enforced', async ({ page }) => {
    await openBench(page);
    const box = interactive(page);
    const input = box.getByTestId('ai-input-file');

    await input.setInputFiles([png('a.png'), pdf('b.pdf')]);
    const list = box.getByRole('list', { name: 'Attached files' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list).toContainText('2.0 KB');

    await input.setInputFiles([png('c.png'), png('d.png')]);
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(box.getByRole('alert')).toHaveText('You can attach up to 3 files.');

    await input.setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }]);
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(box.getByRole('alert')).toHaveText('Only JPEG, PNG, PDF files can be attached.');

    await box.getByRole('button', { name: 'Remove b.pdf' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(box.getByRole('alert')).toHaveCount(0);
    await expect(box.getByRole('textbox', { name: 'Your message' })).toBeFocused();

    // Files go out with the message.
    await box.getByRole('textbox', { name: 'Your message' }).fill('see attached');
    await page.keyboard.press('Enter');
    await expect(page.locator('#last-submit')).toHaveAttribute('data-files', 'a.png|c.png');
    await expect(list).toHaveCount(0);
  });

  test('the bench\'s controlled list removes by callback', async ({ page }) => {
    await openBench(page);
    const box = page.locator('#bench-attachments');
    await expect(box.getByRole('listitem')).toHaveCount(2);
    await expect(box).toContainText('470.7 KB');
    await box.getByRole('button', { name: 'Remove working-out.png' }).click();
    await expect(box.getByRole('listitem')).toHaveCount(1);
  });
});

test.describe('AiInput: states', () => {
  test('busy shows a visible "Thinking" and blocks sending; disabled blocks everything', async ({ page }) => {
    await openBench(page);
    const busy = page.locator('#bench-busy');
    await expect(busy.getByRole('status')).toHaveText('Thinking');
    await expect(busy.getByRole('button', { name: 'Send' })).toBeDisabled();
    await expect(busy.locator('form')).toHaveAttribute('aria-busy', 'true');

    const disabled = page.locator('#bench-disabled');
    for (const name of ['Take a photo', 'Add an image', 'Add a file', 'Talk instead', 'Send']) {
      await expect(disabled.getByRole('button', { name })).toBeDisabled();
    }
    await expect(disabled.getByRole('textbox')).toBeDisabled();
  });

  test('the error is announced, tied to the box, and the hint is always visible', async ({ page }) => {
    await openBench(page);
    const error = page.locator('#bench-error');
    await expect(error.getByRole('alert')).toContainText('You can attach up to 3 files');
    const box = error.getByRole('textbox');
    await expect(box).toHaveAttribute('aria-invalid', 'true');
    const described = (await box.getAttribute('aria-describedby')) ?? '';
    expect(described.split(' ').length).toBe(2);
    await expect(page.locator('#bench-error')).toContainText('Please do not type names, your school or addresses.');
  });

  test('the character count appears near the limit, and reaching it is announced', async ({ page }) => {
    await openBench(page);
    const long = page.locator('#bench-long');
    await expect(long).toContainText('of 120 characters');
    const limit = long.getByRole('status').filter({ hasNot: page.locator('i') }).first();
    await expect(limit).toHaveText('');
    await long.getByRole('textbox').fill('x'.repeat(120));
    await expect(limit).toHaveText('Character limit reached');
  });

  test('a transcript to check is announced by a status region, not only shown in the box', async ({ page }) => {
    await openBench(page);
    await mic(page).click();
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    await expect(overlay(page).getByRole('status').filter({ hasText: 'Your words are in the box below' })).toHaveCount(1);
  });

  test('the placeholder is a LearnThrive prompt, not the Uiverse one', async ({ page }) => {
    await openBench(page);
    await expect(interactive(page).getByRole('textbox')).toHaveAttribute('placeholder', 'Ask for help with your work');
  });
});

test.describe('AiInput: motion', () => {
  test('reduced motion (OS setting): no infinite animation anywhere, overlay open and busy shown', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openBench(page);
    expect(await infiniteAnimations(page)).toBe(0);
    await page.locator('#force-voice-state').selectOption('listening');
    await mic(page).click();
    await expect(overlay(page)).toBeVisible();
    await page.waitForTimeout(400);
    expect(await infiniteAnimations(page)).toBe(0);
    await expect(page.locator('[data-voice-orb]')).toHaveAttribute('data-animated', 'false');
  });

  test('reduced motion (the site\'s own toggle): an animating orb goes still when it is switched on', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openBench(page);
    const tier = await page.locator('html').getAttribute('data-motion-tier');
    await page.locator('#force-voice-state').selectOption('speaking');
    await mic(page).click();
    await expect(overlay(page)).toBeVisible();
    if (tier === 'full') await expect.poll(() => infiniteAnimations(page)).toBeGreaterThan(0);
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-motion', 'reduce');
      window.dispatchEvent(new Event('lt-motion-change'));
    });
    await expect.poll(() => infiniteAnimations(page)).toBe(0);
    await expect(page.locator('[data-voice-orb]')).toHaveAttribute('data-animated', 'false');
    // And the stylesheet by itself refuses to animate it under the toggle.
    const names = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-voice-orb], [data-voice-orb] *')).map((element) => getComputedStyle(element).animationName),
    );
    expect(names.every((name) => name === 'none')).toBe(true);
  });

  test('without reduced motion, the orb animates only on the full tier, and pauses when scrolled out of view', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 300 });
    await openBench(page);
    const tier = await page.locator('html').getAttribute('data-motion-tier');
    await page.locator('#force-voice-state').selectOption('listening');
    await mic(page).click();
    await expect(overlay(page)).toBeVisible();
    const orb = page.locator('[data-voice-orb]');
    if (tier !== 'full') {
      await expect(orb).toHaveAttribute('data-animated', 'false');
      expect(await infiniteAnimations(page)).toBe(0);
      test.info().annotations.push({ type: 'note', description: `tier was ${tier}, so only the static half was checked` });
      return;
    }
    await expect(orb).toHaveAttribute('data-animated', 'true');
    await expect.poll(() => infiniteAnimations(page)).toBeGreaterThan(0);
    // The short window makes the dialog scroll; with the orb scrolled out of it, the animations pause.
    await overlay(page).evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(orb).toHaveAttribute('data-paused', 'true');
    const states = await page.evaluate(() =>
      document.getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity)
        // Only the orb's own (the "Thinking" dots on the page behind the modal are a separate, cheap animation).
        .filter((animation) => (animation.effect as KeyframeEffect).target?.closest('[data-voice-orb]'))
        .map((animation) => animation.playState),
    );
    expect(states.length).toBeGreaterThan(5);
    expect(states.every((value) => value === 'paused')).toBe(true);
    await overlay(page).evaluate((element) => { element.scrollTop = 0; });
    await expect(orb).toHaveAttribute('data-paused', 'false');
  });

  test('the Thinking dots loop only on the full tier (no infinite animation on standard or light)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openBench(page);
    const tier = await page.locator('html').getAttribute('data-motion-tier');
    await expect(page.locator('#bench-busy').getByRole('status')).toHaveText('Thinking');
    if (tier === 'full') await expect.poll(() => infiniteAnimations(page)).toBeGreaterThan(0);
    else {
      await page.waitForTimeout(300);
      expect(await infiniteAnimations(page)).toBe(0);
    }
  });

  test('busy dots do not run under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openBench(page);
    await expect(page.locator('#bench-busy').getByRole('status')).toHaveText('Thinking');
    expect(await infiniteAnimations(page)).toBe(0);
  });
});

test.describe('AiInput: layout', () => {
  const overflow = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  test('360px wide: no horizontal scroll, with and without the overlay', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openBench(page);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // Every control stays inside the screen.
    const outside = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-ai-input] button, [data-ai-input] textarea')).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > window.innerWidth + 0.5 || rect.left < -0.5;
      }).length,
    );
    expect(outside).toBe(0);
    await mic(page).click();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const box = (await overlay(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  });

  test('200% zoom (a 640px-wide viewport and a 320px one): nothing overflows and the overlay still fits', async ({ page }) => {
    for (const [width, height] of [[640, 400], [320, 360]] as const) {
      await page.setViewportSize({ width, height });
      await openBench(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await mic(page).click();
      const box = (await overlay(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 0.5);
      // What does not fit scrolls inside the dialog, and the Talk button can still be reached.
      await overlay(page).getByRole('button', { name: 'Talk' }).scrollIntoViewIfNeeded();
      await expect(overlay(page).getByRole('button', { name: 'Talk' })).toBeInViewport();
      await page.keyboard.press('Escape');
    }
  });

  test('forced colours: the controls keep a visible boundary', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openBench(page);
    const border = await interactive(page).getByRole('button', { name: 'Talk instead' }).evaluate((element) => getComputedStyle(element).borderTopWidth);
    expect(border).toBe('1px');
  });
});
