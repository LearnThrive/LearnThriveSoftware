import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { PUBLIC_ROUTES } from './support';

// plan11.md — the public marketing site's motion runtime. Like motion.spec.ts these are
// state-based, never timing-based: "what tier is this device in", "did hydration complain", "is
// this content readable now" — never "wait N ms and compare a transform". Frame-by-frame assertions
// would break on every future duration or easing tweak for no functional reason, and the arithmetic
// behind the decisions is unit-tested in tests/motion.test.mjs anyway.

/**
 * The tier depends on navigator.hardwareConcurrency and deviceMemory, so a CI runner with two cores
 * would put every test in "light" and quietly change what they exercise. Pin both, so the tier a
 * test sees is decided by the viewport, pointer and motion preference it set up — and only those.
 */
async function pinCapabilities(
  page: Page,
  { cores, memory }: { cores: number | undefined; memory: number | undefined } = { cores: 8, memory: 8 },
) {
  await page.addInitScript(
    ({ cores, memory }) => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores, configurable: true });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => memory, configurable: true });
    },
    { cores, memory },
  );
}

/** Hydration mismatches surface as console errors/warnings in dev, or as uncaught page errors. */
function watchForHydrationProblems(page: Page) {
  const problems: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (['error', 'warning'].includes(message.type()) && /hydrat|did not match|server rendered/i.test(message.text())) {
      problems.push(message.text());
    }
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

/**
 * MotionRuntime writes data-motion-tier onto <html> from an effect, i.e. only after hydration has
 * finished — which makes the attribute both the thing under test and a reliable "hydrated" signal.
 */
async function tierOf(page: Page) {
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-motion-tier', /^(full|standard|light|reduced)$/);
  return html.getAttribute('data-motion-tier');
}

test.describe('capability tiers — desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a capable, wide, fine-pointer desktop is full', async ({ page }) => {
    await pinCapabilities(page);
    await page.goto('/');
    expect(await tierOf(page)).toBe('full');
  });

  test('prefers-reduced-motion is reduced, whatever the hardware', async ({ page }) => {
    await pinCapabilities(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    expect(await tierOf(page)).toBe('reduced');
  });

  test('no capability evidence at all falls back to standard, not full', async ({ page }) => {
    await pinCapabilities(page, { cores: undefined, memory: undefined });
    await page.goto('/');
    expect(await tierOf(page)).toBe('standard');
  });

  test('a device reporting little memory is light even on a wide screen', async ({ page }) => {
    await pinCapabilities(page, { cores: 8, memory: 2 });
    await page.goto('/');
    expect(await tierOf(page)).toBe('light');
  });

  test('the tier follows the viewport live, through media-query changes rather than resize polling', async ({ page }) => {
    await pinCapabilities(page);
    await page.goto('/');
    expect(await tierOf(page)).toBe('full');

    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.locator('html')).toHaveAttribute('data-motion-tier', 'standard');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('html')).toHaveAttribute('data-motion-tier', 'light');

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('html')).toHaveAttribute('data-motion-tier', 'full');
  });

  test('turning reduced motion on while the page is open takes effect without a reload', async ({ page }) => {
    await pinCapabilities(page);
    await page.goto('/');
    expect(await tierOf(page)).toBe('full');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-motion-tier', 'reduced');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.locator('html')).toHaveAttribute('data-motion-tier', 'full');
  });
});

test.describe('capability tiers — touch devices', () => {
  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a phone is light, however capable', async ({ page }) => {
      await pinCapabilities(page);
      await page.goto('/');
      expect(await tierOf(page)).toBe('light');
    });
  });

  test.describe('tablet', () => {
    test.use({ viewport: { width: 834, height: 1112 }, hasTouch: true, isMobile: true });

    test('a tablet is standard', async ({ page }) => {
      await pinCapabilities(page);
      await page.goto('/');
      expect(await tierOf(page)).toBe('standard');
    });
  });
});

test.describe('hydration — no console mismatch warnings', () => {
  // One test per motion preference, looping the routes: setup cost is paid once, and the failure
  // message still names the route. Reduced motion is the case that has actually broken hydration
  // before (the server can never know the visitor's preference), so it is not optional here.
  for (const reducedMotion of [false, true]) {
    test(`every public route hydrates cleanly with reduced motion ${reducedMotion ? 'on' : 'off'}`, async ({ page }) => {
      test.slow();
      await pinCapabilities(page);
      if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
      const problems = watchForHydrationProblems(page);

      for (const route of PUBLIC_ROUTES) {
        const before = problems.length;
        await page.goto(route);
        await expect(page.locator('main h1').first()).toBeVisible();
        await tierOf(page); // hydrated
        expect(problems.slice(before), `${route} logged hydration problems`).toEqual([]);
      }
    });
  }
});

// ── Reveal vocabulary (plan11.md task 6) ─────────────────────────────────────────────────────
// Driven through /dev/motion, a fixed bench with one of each variant far below the fold, so the
// assertions are about the primitive and not about whatever a real page says this week.

const REVEAL_VARIANTS = ['soft', 'mask', 'scale', 'side', 'editorial', 'static'] as const;
const IDENTITY_TRANSFORM = /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/;

/** Where a variant's opacity/transform lives: `mask` moves an inner child; the rest move themselves. */
const revealTarget = (page: Page, variant: (typeof REVEAL_VARIANTS)[number]) =>
  page.locator(variant === 'mask' ? '[data-reveal="mask"] [data-reveal-inner]' : `[data-reveal="${variant}"]`);

test.describe('reveal vocabulary', () => {
  test('each animated variant waits below the fold, then arrives at a readable final state', async ({ page }) => {
    await pinCapabilities(page);
    await page.goto('/dev/motion');
    await tierOf(page); // hydrated

    // Before anything scrolls: hidden by opacity — except `mask`, which hides by translating its
    // content out of a clip, and `static`, which never hides at all.
    for (const variant of REVEAL_VARIANTS) {
      const target = revealTarget(page, variant);
      if (variant === 'static') await expect(target).toHaveCSS('opacity', '1');
      else if (variant === 'mask') await expect(target).not.toHaveCSS('transform', IDENTITY_TRANSFORM);
      else await expect(target).toHaveCSS('opacity', '0');
    }

    for (const variant of REVEAL_VARIANTS) {
      await page.locator(`[data-testid="reveal-${variant}"]`).scrollIntoViewIfNeeded();
      const target = revealTarget(page, variant);
      await expect(target).toHaveCSS('opacity', '1');
      await expect(target).toHaveCSS('transform', IDENTITY_TRANSFORM);
      await expect(page.locator(`[data-testid="reveal-${variant}"]`)).toBeVisible();
    }
    // The editorial variant also draws a rule; it must end fully drawn.
    await expect(page.locator('[data-reveal-rule]')).toHaveCSS('transform', IDENTITY_TRANSFORM);
  });

  test('a revealed block stays revealed when scrolled away and back (once)', async ({ page }) => {
    await pinCapabilities(page);
    await page.goto('/dev/motion');
    const heading = page.locator('[data-testid="reveal-soft"]');
    await heading.scrollIntoViewIfNeeded();
    await expect(revealTarget(page, 'soft')).toHaveCSS('opacity', '1');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(400);
    await expect(revealTarget(page, 'soft')).toHaveCSS('opacity', '1');
  });

  test('with reduced motion every variant is readable at once, without scrolling to it', async ({ page }) => {
    await pinCapabilities(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dev/motion');
    for (const variant of REVEAL_VARIANTS) {
      const target = revealTarget(page, variant);
      await expect(target).toHaveCSS('opacity', '1');
      await expect(target).toHaveCSS('transform', IDENTITY_TRANSFORM);
    }
    await expect(page.locator('[data-reveal-rule]')).toHaveCSS('transform', IDENTITY_TRANSFORM);
  });

  test('every variant is server-rendered with its content in the HTML', async ({ request }) => {
    // React separates adjacent text nodes with <!-- --> markers; they are not content.
    const html = (await (await request.get('/dev/motion')).text()).replace(/<!-- -->/g, '');
    for (const variant of REVEAL_VARIANTS) {
      expect(html).toContain(`data-reveal="${variant}"`);
      expect(html).toContain(`Readable final content for the ${variant} variant.`);
    }
  });
});

test.describe('reveals on real pages', () => {
  test('reduced motion: nothing on any public route is left hidden or displaced by a reveal', async ({ page }) => {
    test.slow();
    await pinCapabilities(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);
      await tierOf(page);
      const stuck = await page.evaluate(() =>
        [...document.querySelectorAll('[data-reveal], [data-reveal-inner]')]
          .filter((el) => {
            const style = getComputedStyle(el);
            return style.opacity !== '1' || !/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(style.transform);
          })
          .map((el) => el.getAttribute('data-reveal') ?? 'inner'),
      );
      expect(stuck, `${route} has reveals stuck in their start state under reduced motion`).toEqual([]);
    }
  });
});

test.describe('reveals without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the homepage shows everything below the fold, because <noscript> forces the final state', async ({ page }) => {
    await page.goto('/');
    const revealed = page.locator('[data-reveal]');
    expect(await revealed.count()).toBeGreaterThan(10);
    for (const index of [0, 5, 10, await revealed.count() - 1]) {
      await expect(revealed.nth(index)).toHaveCSS('opacity', '1');
    }
    await expect(page.getByRole('heading', { name: /Let.s help your child thrive/ })).toBeVisible();
  });
});
