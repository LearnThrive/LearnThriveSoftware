import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { hydrated } from './careers-support';

// AuthCard (plan19.md section 7 and Phase C). Runs against the dev bench /dev/ui-components/auth-card: one
// interactive card (data-testid="demo") plus every state under [data-state="..."]. Nothing here touches a server.

const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const WCAG22 = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const BENCH = '/dev/ui-components/auth-card';
const STATES = ['sign-in', 'sign-up', 'reset', 'verify-sent', 'reset-sent', 'sign-in-error', 'sign-up-errors', 'busy', 'providers', 'providers-sign-up'];

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
  await expect(page.getByTestId('demo')).toBeVisible();
}

const demo = (page: Page) => page.getByTestId('demo');
const email = (card: Locator) => card.getByLabel('Email', { exact: true });
const password = (card: Locator) => card.getByLabel('Password', { exact: true });
const summary = (card: Locator) => card.getByRole('alert');
const log = (page: Page) => page.getByTestId('demo-log');

test.describe('AuthCard', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe (WCAG 2.2 AA) over every mode and state, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await open(page);
      for (const state of STATES) await expect(page.locator(`[data-state="${state}"]`)).toBeVisible();
      await expectNoAxeViolations(page, `${scheme}: all states`);
    });

    test(`axe in the live card: errors, shown password, each mode, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await open(page);
      const card = demo(page);
      await card.getByRole('button', { name: 'Sign in' }).click();
      await expect(summary(card)).toBeVisible();
      await expectNoAxeViolations(page, `${scheme}: sign-in with errors`);

      await card.getByRole('button', { name: 'Show password' }).click();
      await expectNoAxeViolations(page, `${scheme}: password shown`);

      await card.getByRole('button', { name: 'Create an account' }).click();
      await card.getByRole('button', { name: 'Create account' }).click();
      await expect(summary(card)).toContainText('There are 3 things to check.');
      await expectNoAxeViolations(page, `${scheme}: sign-up with errors`);

      await card.getByRole('button', { name: 'Sign in', exact: true }).click();
      await card.getByRole('link', { name: 'Forgot password?' }).click();
      await expect(card.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
      await expectNoAxeViolations(page, `${scheme}: reset`);
    });
  }

  test('sign-in is completable with the keyboard alone', async ({ page }) => {
    await open(page);
    const card = demo(page);
    await email(card).focus();
    await page.keyboard.type('parent@example.com');
    await page.keyboard.press('Tab'); // Forgot password?
    await expect(card.getByRole('link', { name: 'Forgot password?' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(password(card)).toBeFocused();
    await page.keyboard.type('a-long-password-1');
    await page.keyboard.press('Tab');
    await expect(card.getByRole('button', { name: 'Show password' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(card.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(log(page)).toContainText('sign-in: parent@example.com, password of 17 characters');
  });

  test('sign-up is completable with the keyboard alone, and lands on "check your email"', async ({ page }) => {
    await open(page);
    const card = demo(page);
    const toSignUp = card.getByRole('button', { name: 'Create an account' });
    await toSignUp.focus();
    await page.keyboard.press('Enter');
    // A change of mode moves focus to the new heading, so the change is announced and the next Tab starts in the form.
    await expect(card.getByRole('heading', { name: 'Create your account' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(email(card)).toBeFocused();
    await page.keyboard.type('parent@example.com');
    await page.keyboard.press('Tab');
    await expect(password(card)).toBeFocused();
    await page.keyboard.type('three-unrelated-words');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const adult = card.getByRole('checkbox', { name: /18 or over/ });
    await expect(adult).toBeFocused();
    await expect(adult).not.toBeChecked(); // never pre-ticked
    await page.keyboard.press('Space');
    await expect(adult).toBeChecked();
    await page.keyboard.press('Enter'); // Enter in a checkbox submits the form
    await expect(log(page)).toContainText('sign-up: parent@example.com');
    await expect(log(page)).toContainText('18 or over: yes');
    await expect(card.getByRole('heading', { name: 'Check your email' })).toBeFocused();
    await expect(card).toContainText('parent@example.com');
    await expect(card).toContainText('You cannot sign in until you have.');
  });

  test('sign-up links the privacy notice and terms, and explains under-18 profiles', async ({ page }) => {
    await open(page);
    const card = page.locator('[data-state="sign-up"]');
    await expect(card.getByRole('link', { name: /privacy notice/ })).toHaveAttribute('href', '/privacy');
    await expect(card.getByRole('link', { name: /terms/ })).toHaveAttribute('href', '/terms');
    await expect(card).toContainText('Students under 18 do not need an email address of their own');
    await expect(page.locator('[data-state="sign-in"]').getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
  });

  test('the password toggle is a real, accurate, keyboard-operable button that does not submit', async ({ page }) => {
    await open(page);
    const card = demo(page);
    const toggle = card.getByRole('button', { name: 'Show password' });
    await expect(toggle).toHaveAttribute('type', 'button');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(password(card)).toHaveAttribute('type', 'password');
    await email(card).fill('parent@example.com');
    await password(card).fill('a-long-password-1');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(password(card)).toHaveAttribute('type', 'text');
    await expect(log(page)).toHaveText('Nothing submitted yet.');

    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(password(card)).toHaveAttribute('type', 'password');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(log(page)).toHaveText('Nothing submitted yet.');
    await expect(password(card)).toHaveValue('a-long-password-1');
  });

  test('fields have real labels and the right input types and autocomplete values', async ({ page }) => {
    await open(page);
    const signIn = page.locator('[data-state="sign-in"]');
    await expect(email(signIn)).toHaveAttribute('type', 'email');
    // "username" on sign-in is what password managers key on (and is a WCAG 1.3.5 input-purpose token).
    await expect(email(signIn)).toHaveAttribute('autocomplete', 'username');
    await expect(password(signIn)).toHaveAttribute('autocomplete', 'current-password');
    const signUp = page.locator('[data-state="sign-up"]');
    await expect(email(signUp)).toHaveAttribute('autocomplete', 'email');
    await expect(password(signUp)).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.locator('[data-state="reset"]').getByLabel('Email', { exact: true })).toHaveAttribute('autocomplete', 'email');
    // The adult confirmation is a required tick-box and never pre-ticked.
    const adult = signUp.getByRole('checkbox', { name: /18 or over/ });
    await expect(adult).toHaveAttribute('required', '');
    await expect(adult).not.toBeChecked();
    // Nothing here may be persisted or autofilled by us: no storage, no hidden fields, no password in a value attribute.
    expect(await page.locator('input[type="hidden"]').count()).toBe(0);
    // Every card's ids are its own: the bench shows many cards at once, so a clash would break label association.
    const ids = await page.locator('[data-state] input[id]').evaluateAll((nodes) => nodes.map((n) => n.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('a failed submit takes focus to the summary; fields carry aria-invalid and aria-describedby', async ({ page }) => {
    await open(page);
    const card = demo(page);
    await card.getByRole('button', { name: 'Create an account' }).click();
    await email(card).fill('not-an-email');
    await email(card).press('Enter');

    await expect(summary(card)).toBeFocused();
    await expect(summary(card)).toContainText('There are 3 things to check.');
    await expect(email(card)).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await email(card).getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy}"]`)).toContainText('name@example.com');

    const adult = card.getByRole('checkbox', { name: /18 or over/ });
    await expect(adult).toHaveAttribute('aria-invalid', 'true');
    const adultDescribedBy = await adult.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${adultDescribedBy}"]`)).toContainText('Confirm that you are 18 or over');
    await expect(log(page)).toHaveText('Nothing submitted yet.'); // the client check stopped it

    // A summary link moves focus to its field.
    await summary(card).getByRole('link', { name: /Choose a password/ }).click();
    await expect(password(card)).toBeFocused();

    // Correcting a field clears its error without pulling focus anywhere.
    await password(card).fill('three-unrelated-words');
    await expect(password(card)).toBeFocused();
    await expect(password(card)).toHaveAttribute('aria-invalid', 'false');
    await expect(summary(card)).toContainText('There are 2 things to check.');
  });

  test('a server answer is announced in the summary, takes focus, and goes when the person edits', async ({ page }) => {
    await open(page);
    const card = demo(page);
    await email(card).fill('parent@example.com');
    await password(card).fill('wrong-password-1');
    await password(card).press('Enter');
    await expect(summary(card)).toBeFocused();
    await expect(summary(card)).toContainText('Email or password is not right.');
    await password(card).fill('another-password-2');
    await expect(summary(card)).toHaveCount(0);
    await password(card).press('Enter');
    await expect(log(page)).toContainText('password of 18 characters');
    await expect(summary(card)).toHaveCount(0);

    // A field-level server answer lands on its field.
    await card.getByRole('button', { name: 'Create an account' }).click();
    await email(card).fill('taken@example.com');
    await password(card).fill('three-unrelated-words');
    await card.getByRole('checkbox', { name: /18 or over/ }).check();
    await card.getByRole('button', { name: 'Create account' }).click();
    await expect(summary(card)).toBeFocused();
    await expect(email(card)).toHaveAttribute('aria-invalid', 'true');
    await expect(summary(card)).toContainText('We could not use that email address');
  });

  test('busy: the button says so, aria-busy is set and a status is announced', async ({ page }) => {
    await open(page);
    const busy = page.locator('[data-state="busy"]');
    const button = busy.getByRole('button', { name: 'Signing in…' });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(busy.getByRole('status')).toHaveText('Signing in, please wait.');
    await expect(busy.locator('form')).toHaveAttribute('aria-busy', 'true');
    // The live region must not sit inside the aria-busy form: aria-busy can make a screen reader hold its text back.
    await expect(busy.locator('form').getByRole('status')).toHaveCount(0);
  });

  test('busy keeps the submit label readable (4.5:1) in light and dark', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await open(page);
      const ratio = await page.locator('[data-state="busy"] button[type="submit"]').evaluate((button) => {
        const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
        const luminance = ([r, g, b]: number[]) => {
          const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const style = getComputedStyle(button);
        const opacity = parseFloat(style.opacity);
        const card = parse(getComputedStyle(button.closest('[data-state]')!.firstElementChild!).backgroundColor);
        const mix = (top: number[], below: number[]) => top.slice(0, 3).map((c, i) => c * opacity + below[i] * (1 - opacity));
        const bg = mix(parse(style.backgroundColor), card);
        const fg = mix(parse(style.color), card);
        const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
        return (hi + 0.05) / (lo + 0.05);
      });
      expect(ratio, `${scheme}: busy submit label contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the field outline is at least 3:1 against the card (WCAG 1.4.11), ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await open(page);
      const ratio = await page.locator('[data-state="sign-in"] input[type="email"]').evaluate((input) => {
        const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
        const luminance = ([r, g, b]: number[]) => {
          const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const border = parse(getComputedStyle(input.parentElement!).borderTopColor);
        const card = parse(getComputedStyle(input.closest('[data-state]')!.firstElementChild!).backgroundColor);
        const [hi, lo] = [luminance(border), luminance(card)].sort((a, b) => b - a);
        return (hi + 0.05) / (lo + 0.05);
      });
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  }

  test('the same server answer twice in a row is shown, and takes focus, both times', async ({ page }) => {
    await open(page);
    const card = demo(page);
    await email(card).fill('parent@example.com');
    await password(card).fill('wrong-password-1');
    await password(card).press('Enter');
    await expect(summary(card)).toBeFocused();
    await expect(summary(card)).toContainText('Email or password is not right.');
    await password(card).fill('wrong-password-2');
    await password(card).fill('wrong-password-1'); // editing hides it...
    await expect(summary(card)).toHaveCount(0);
    await password(card).press('Enter'); // ...and an identical answer to the next submit brings it back
    await expect(summary(card)).toBeFocused();
    await expect(summary(card)).toContainText('Email or password is not right.');
  });

  test('there is no "remember me" control anywhere, in any state', async ({ page }) => {
    await open(page);
    await expect(page.getByText(/remember me|keep me signed in|stay signed in/i)).toHaveCount(0);
    await expect(page.locator('input[type="radio"]')).toHaveCount(0);
    // The only tick-boxes anywhere are the sign-up "18 or over" confirmations.
    const labels = await page.locator('input[type="checkbox"]').evaluateAll((nodes) => nodes.map((n) => (n as HTMLInputElement).labels?.[0]?.textContent ?? ''));
    for (const label of labels) expect(label).toMatch(/18 or over/);
  });

  test('Google uses its dark-theme colours on the dark site theme and Apple stays white', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await open(page);
    const enabled = page.locator('[data-state="providers"]');
    const style = (name: string) =>
      enabled.getByRole('button', { name }).evaluate((node) => {
        const s = getComputedStyle(node);
        return [s.backgroundColor, s.color, s.borderTopColor];
      });
    expect(await style('Sign in with Google')).toEqual(['rgb(19, 19, 20)', 'rgb(227, 227, 227)', 'rgb(142, 145, 143)']);
    expect((await style('Sign in with Apple')).slice(0, 2)).toEqual(['rgb(255, 255, 255)', 'rgb(0, 0, 0)']);
  });

  test('Google and Apple buttons are absent unless enabled, and follow the brand wording when they are', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await open(page);
    for (const state of STATES.filter((s) => !s.startsWith('providers'))) {
      const card = page.locator(`[data-state="${state}"]`);
      await expect(card.getByRole('button', { name: /google|apple/i })).toHaveCount(0);
    }
    await expect(demo(page).getByRole('button', { name: /google|apple/i })).toHaveCount(0);
    const enabled = page.locator('[data-state="providers"]');
    await expect(enabled.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(enabled.getByRole('button', { name: 'Sign in with Apple' })).toBeVisible();
    const signUp = page.locator('[data-state="providers-sign-up"]');
    await expect(signUp.getByRole('button', { name: 'Sign up with Google' })).toBeVisible();
    await expect(signUp.getByRole('button', { name: 'Sign up with Apple' })).toBeVisible();
    // The marks are inline SVG, hidden from assistive tech (the button's text is its name).
    await expect(enabled.getByRole('button', { name: /with (Google|Apple)/ }).locator('svg[aria-hidden="true"]')).toHaveCount(2);
    // Brand label contrast: dark text on the white buttons.
    const colours = await enabled.locator('button:has(svg)').evaluateAll((nodes) => nodes.filter((n) => /with (Google|Apple)/.test(n.textContent ?? '')).map((n) => getComputedStyle(n).color));
    expect(colours).toEqual(['rgb(31, 31, 31)', 'rgb(0, 0, 0)']);
  });

  test('provider buttons do nothing but call back (type=button, no submit)', async ({ page }) => {
    await open(page);
    const button = page.locator('[data-state="providers"]').getByRole('button', { name: 'Sign in with Google' });
    await expect(button).toHaveAttribute('type', 'button');
  });

  for (const width of [360, 640]) {
    test(`no horizontal scrolling at ${width}px wide (360 is the floor; 640 is 200% zoom of 1280)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page);
      await demo(page).getByRole('button', { name: 'Create an account' }).click();
      await demo(page).getByRole('button', { name: 'Create account' }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const clipped = await page.locator('[data-state] > div').evaluateAll((cards) => cards.filter((c) => c.scrollWidth > c.clientWidth + 1).length);
      expect(clipped).toBe(0);
    });
  }

  test('200% zoom: the card still fits and reflows', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('reduced motion: nothing is animating, and every one of the three switches makes transitions static', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    const control = page.locator('[data-state="sign-in"] input[type="email"]').locator('..');
    // The site's own reduced-motion rule may leave 0.00001s rather than 0s: both mean "no visible transition".
    const duration = () => control.evaluate((element) => Math.max(...getComputedStyle(element).transitionDuration.split(',').map(parseFloat)));
    expect(await duration()).toBeLessThan(0.001); // prefers-reduced-motion (emulated in beforeEach)

    // The other two switches, with the OS preference off: the site's tier and the visitor's own toggle.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await duration()).toBeGreaterThan(0.05);
    for (const [attribute, value] of [['data-motion-tier', 'reduced'], ['data-motion', 'reduce']] as const) {
      const before = await page.evaluate((name) => document.documentElement.getAttribute(name), attribute);
      await page.evaluate(([name, v]) => document.documentElement.setAttribute(name, v), [attribute, value]);
      expect(await duration(), attribute).toBeLessThan(0.001);
      await page.evaluate(([name, v]) => (v === null ? document.documentElement.removeAttribute(name) : document.documentElement.setAttribute(name, v)), [attribute, before] as const);
    }
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test('no console errors or page errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });
    await open(page);
    const card = demo(page);
    await card.getByRole('button', { name: 'Sign in', exact: true }).click();
    await card.getByRole('button', { name: 'Create an account' }).click();
    await card.getByRole('button', { name: 'Sign in', exact: true }).click();
    await card.getByRole('link', { name: 'Forgot password?' }).click();
    await email(card).fill('parent@example.com');
    await card.getByRole('button', { name: 'Send reset link' }).click();
    await expect(card.getByRole('heading', { name: 'Check your email' })).toBeFocused();
    await expect(card).toContainText('If there is an account for parent@example.com');
    expect(problems).toEqual([]);
  });
});
