import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Matches accessibility.spec.ts's own established pattern for injecting axe-core.
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

// plan13.md task 1: Brian's homepage stakeholder feedback on ProductTabs (the "See it in action"
// tab switcher on /) — no coverage existed for this component before this task. Three fixes:
// the status/pill group (.mockCardMeta) centred as a whole rather than left-aligned, the Student
// "Live lesson" card white like Parent/Tutor instead of full-navy, with navy/green kept as
// accents on the tiles inside it rather than the whole surface.

test.describe('ProductTabs (task 1)', () => {
  test('switches panels on click, and the pill groups are centred as a whole', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('#platform');
    await section.scrollIntoViewIfNeeded();

    // Parents (default): the two-pill group is centred, not left-aligned inside its card.
    const parentMeta = section.locator('[class*="mockCardMeta"]').first();
    await expect(parentMeta).toHaveCSS('justify-content', 'center');

    // Tutors: the three-pill report-workflow group is the same fix.
    await section.getByRole('tab', { name: 'Tutors' }).click();
    const tutorMeta = section.locator('[class*="mockCardMeta"]').first();
    await expect(tutorMeta).toHaveCSS('justify-content', 'center');
    await expect(tutorMeta.getByText('Draft')).toBeVisible();
    await expect(tutorMeta.getByText('Submitted')).toBeVisible();
    await expect(tutorMeta.getByText('Approved')).toBeVisible();
  });

  test('the Student live-lesson card is a white surface, not full-navy, with navy/green accents inside', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('#platform');
    await section.scrollIntoViewIfNeeded();
    await section.getByRole('tab', { name: 'Students' }).click();

    // CSS module classnames are hashed as "ProductTabs-module__<hash>__mockCard", and mockCard's
    // own label/body/title/meta siblings all share that literal string as a *prefix*
    // ("...__mockCardLabel" etc) — `[class*="mockCard"]` alone matches those too, so this needs
    // the class to *end* with mockCard specifically, matching only the real card div.
    const liveLessonCard = section.locator('[class$="mockCard"]').filter({ hasText: 'Live lesson' });
    await expect(liveLessonCard).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    // The accent moved inside: the participant tiles are navy, the whiteboard tile is green —
    // still the brand's navy/green vocabulary, just no longer the whole card.
    // rgb(14, 42, 71) is --colour-navy-900 (globals.css) — the token var(--lt-navy) actually
    // resolves to in this component's scope, not home.module.css's locally-scoped #143152
    // override; confirmed directly rather than assumed. rgb(7, 95, 82) is --lt-green-dark.
    const tutorTile = section.getByText('Tutor', { exact: true });
    const boardTile = section.getByText('Whiteboard', { exact: true });
    await expect(tutorTile).toHaveCSS('background-color', 'rgb(14, 42, 71)');
    await expect(boardTile).toHaveCSS('background-color', 'rgb(7, 95, 82)');
  });

  test('all three tab states use the same white card surface (one design system, not two)', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('#platform');
    await section.scrollIntoViewIfNeeded();

    for (const name of ['Parents', 'Students', 'Tutors']) {
      await section.getByRole('tab', { name }).click();
      const cards = section.locator('[class$="mockCard"]');
      const count = await cards.count();
      for (let i = 0; i < count; i++) {
        await expect(cards.nth(i)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      }
    }
  });

  test('keyboard: ArrowRight/ArrowLeft/Home/End move focus and switch panels, with no overlap or jump', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('#platform');
    await section.scrollIntoViewIfNeeded();

    const parentsTab = section.getByRole('tab', { name: 'Parents' });
    const studentsTab = section.getByRole('tab', { name: 'Students' });
    const tutorsTab = section.getByRole('tab', { name: 'Tutors' });

    await parentsTab.focus();
    await expect(parentsTab).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(studentsTab).toBeFocused();
    await expect(studentsTab).toHaveAttribute('aria-selected', 'true');
    await expect(section.getByText('Live lesson')).toBeVisible();

    await page.keyboard.press('End');
    await expect(tutorsTab).toBeFocused();
    await expect(tutorsTab).toHaveAttribute('aria-selected', 'true');
    await expect(section.getByText('Report workflow')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(studentsTab).toBeFocused();

    await page.keyboard.press('Home');
    await expect(parentsTab).toBeFocused();
    await expect(parentsTab).toHaveAttribute('aria-selected', 'true');
    await expect(section.getByText('Lesson report')).toBeVisible();

    // Exactly one tab is ever selected/visible — no stale panel left behind by the switch.
    await expect(section.getByRole('tab', { selected: true })).toHaveCount(1);
    await expect(section.getByRole('tabpanel')).toHaveCount(1);
  });

  test('reduced motion: panels still switch, with the shortened transition, no stuck/hidden state', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const section = page.locator('#platform');
    await section.scrollIntoViewIfNeeded();

    await section.getByRole('tab', { name: 'Students' }).click();
    await expect(section.getByText('Live lesson')).toBeVisible();
    await expect(section.getByRole('tabpanel')).toHaveCSS('opacity', '1');

    await section.getByRole('tab', { name: 'Tutors' }).click();
    await expect(section.getByText('Report workflow')).toBeVisible();
    await expect(section.getByRole('tabpanel')).toHaveCSS('opacity', '1');
  });

  test('produces no console/page errors while switching tabs', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto('/');
    const section = page.locator('#platform');
    await section.scrollIntoViewIfNeeded();
    for (const name of ['Students', 'Tutors', 'Parents']) {
      await section.getByRole('tab', { name }).click();
    }
    expect(errors).toEqual([]);
  });

  test('axe: no WCAG 2 A/AA violations in any of the three tab states, including the new Student tile colours', async ({ page }) => {
    // accessibility.spec.ts's own established fix for the same class of false positive: axe
    // scores contrast on whatever's actually rendered at the instant it runs, and the panel swap
    // is a real opacity 0->1 entrance (AnimatePresence) — catching one mid-fade is a genuine
    // reading of a state real visitors only pass through, not the steady-state design. Emulating
    // reduced motion removes that timing confound entirely rather than guessing a settle delay.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const section = page.locator('#platform');
    await section.scrollIntoViewIfNeeded();
    await page.addScriptTag({ content: AXE_SOURCE });

    for (const name of ['Parents', 'Students', 'Tutors']) {
      await section.getByRole('tab', { name }).click();
      // AnimatePresence mode="wait" genuinely removes the outgoing panel before mounting the
      // incoming one — a real, brief gap where the tab's aria-controls target doesn't exist yet.
      // Scanning mid-transition is scanning a state a user never rests on; wait for the panel to
      // actually be there first.
      await expect(section.getByRole('tabpanel')).toHaveAttribute('id', await section.getByRole('tab', { name }).getAttribute('aria-controls') ?? '');
      // Mounting isn't settled: even under reduced motion the panel still runs an 80ms opacity
      // 0->1 transition (ProductTabs.tsx's transition duration is reduceMotion ? 0.08 : ...,
      // never 0). Scanning immediately after mount catches a real but transient blended colour
      // mid-fade (e.g. .mockCardLabel's #075f52 reads as ~65%-opacity #61968a) and fails contrast
      // on a state a user never rests on. Wait for the fade to actually finish first.
      await expect(section.getByRole('tabpanel')).toHaveCSS('opacity', '1');
      const results = await page.evaluate(async () => {
        // @ts-expect-error injected global, no types installed for the browser build
        return await window.axe.run(document.querySelector('#platform'), {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        });
      }) as { violations: Array<{ id: string; impact: string | null; help: string }> };
      expect(results.violations, `${name} tab: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
    }
  });
});
