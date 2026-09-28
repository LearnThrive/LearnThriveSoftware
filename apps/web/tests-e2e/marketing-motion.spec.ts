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

// ── Parallax, pointer depth, scroll path, underline (plan11.md task 8) ─────────────────────────
// Also driven through /dev/motion.

/** translateY in px of the element a ParallaxLayer moves — the parent of the lab's test-id'd child. */
const layerOffset = (page: Page, testId: string) =>
  page.locator(`[data-testid="${testId}"]`).evaluate((element) => {
    const transform = getComputedStyle(element.parentElement as HTMLElement).transform;
    return transform === 'none' ? 0 : new DOMMatrix(transform).m42;
  });

/** "start": the section's top edge at the bottom of the viewport (scene progress 0); "end": its bottom edge at the top (progress 1). */
async function scrollSceneTo(page: Page, section: string, where: 'start' | 'end') {
  await page.evaluate(
    ({ section, where }) => {
      const element = document.querySelector(`[data-lab-section="${section}"]`) as HTMLElement;
      const rect = element.getBoundingClientRect();
      const top = where === 'start' ? rect.top + window.scrollY - window.innerHeight : rect.bottom + window.scrollY;
      window.scrollTo({ top, behavior: 'instant' });
    },
    { section, where },
  );
}

test.describe('ParallaxLayer', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('on the full tier it moves across exactly its authored range', async ({ page }) => {
    await pinCapabilities(page);
    await page.goto('/dev/motion');
    expect(await tierOf(page)).toBe('full');
    await scrollSceneTo(page, 'parallax', 'start');
    await expect.poll(() => layerOffset(page, 'parallax-layer')).toBeCloseTo(-20, 0);
    await scrollSceneTo(page, 'parallax', 'end');
    await expect.poll(() => layerOffset(page, 'parallax-layer')).toBeCloseTo(20, 0);
  });

  test('it never travels further than its bound at any point in the scene', async ({ page }) => {
    await pinCapabilities(page);
    await page.goto('/dev/motion');
    await tierOf(page);
    const section = await page.locator('[data-lab-section="parallax"]').evaluate((el) => ({
      top: el.getBoundingClientRect().top + window.scrollY,
      height: (el as HTMLElement).offsetHeight,
    }));
    for (let step = -2; step <= 12; step += 1) {
      const top = section.top - 900 + ((section.height + 900) * step) / 10;
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.max(0, top));
      await page.waitForTimeout(120);
      expect(Math.abs(await layerOffset(page, 'parallax-layer'))).toBeLessThanOrEqual(48);
    }
  });

  test('a phone gets a fraction of the depth (light tier scale)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await pinCapabilities(page);
    await page.goto('/dev/motion');
    expect(await tierOf(page)).toBe('light');
    await scrollSceneTo(page, 'parallax', 'end');
    // 20px authored × 0.35
    await expect.poll(() => layerOffset(page, 'parallax-layer')).toBeCloseTo(7, 0);
    await context.close();
  });

  test('with reduced motion there is no parallax at any point', async ({ page }) => {
    await pinCapabilities(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dev/motion');
    expect(await tierOf(page)).toBe('reduced');
    for (const where of ['start', 'end'] as const) {
      await scrollSceneTo(page, 'parallax', where);
      await page.waitForTimeout(300);
      expect(await layerOffset(page, 'parallax-layer')).toBe(0);
    }
  });

  test('a promoted layer is on its own compositor layer only while it is near the screen', async ({ page }) => {
    await pinCapabilities(page);
    await page.goto('/dev/motion');
    await tierOf(page);
    const willChange = () => page.locator('[data-testid="parallax-promoted"]').evaluate((el) => (el.parentElement as HTMLElement).style.willChange);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect.poll(willChange).toBe('');
    await page.locator('[data-testid="parallax-promoted"]').scrollIntoViewIfNeeded();
    await expect.poll(willChange).toBe('transform');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect.poll(willChange).toBe('');
  });
});

test.describe('ScrollProgressPath', () => {
  const drawn = (page: Page) =>
    page
      .locator('[data-testid="scroll-path"] [data-progress-path]')
      .evaluate((path) => parseFloat(getComputedStyle(path).strokeDasharray));

  test('draws as the scene scrolls, from nothing to complete', async ({ page }) => {
    await pinCapabilities(page);
    await page.goto('/dev/motion');
    await tierOf(page);
    await scrollSceneTo(page, 'parallax', 'start');
    await expect.poll(() => drawn(page)).toBeCloseTo(0, 1);
    await scrollSceneTo(page, 'parallax', 'end');
    await expect.poll(() => drawn(page)).toBeCloseTo(1, 1);
  });

  test('with reduced motion the path is simply drawn — it does not wait to be scrolled', async ({ page }) => {
    await pinCapabilities(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dev/motion');
    await tierOf(page);
    await expect.poll(() => drawn(page)).toBeCloseTo(1, 1);
  });

  test('is hidden from the accessibility tree', async ({ page }) => {
    await page.goto('/dev/motion');
    await expect(page.locator('[data-testid="scroll-path"] svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

test.describe('PointerDepth', () => {
  const depth = (page: Page) =>
    page.locator('[data-testid="depth-card"]').evaluate((element) => {
      const transform = getComputedStyle(element.parentElement as HTMLElement).transform;
      if (transform === 'none') return null;
      const matrix = new DOMMatrix(transform);
      return { tx: matrix.m41, ty: matrix.m42, rotation: [matrix.m12, matrix.m13, matrix.m21, matrix.m23] };
    });
  const movement = async (page: Page) => {
    const value = await depth(page);
    return value ? Math.abs(value.tx) + Math.abs(value.ty) : 0;
  };
  const card = async (page: Page) => {
    await page.locator('[data-testid="depth-card"]').scrollIntoViewIfNeeded();
    return (await page.locator('[data-testid="depth-card"]').boundingBox())!;
  };

  test.describe('mouse on a full-tier desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('leans toward the pointer, within 2° and 6px, and settles when it leaves', async ({ page }) => {
      await pinCapabilities(page);
      await page.goto('/dev/motion');
      expect(await tierOf(page)).toBe('full');
      const box = await card(page);

      await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9);
      await expect.poll(() => movement(page)).toBeGreaterThan(0.5);
      const value = (await depth(page))!;
      expect(Math.abs(value.tx)).toBeLessThanOrEqual(6.01);
      expect(Math.abs(value.ty)).toBeLessThanOrEqual(6.01);
      for (const term of value.rotation) expect(Math.abs(term)).toBeLessThanOrEqual(Math.sin((2.05 * Math.PI) / 180));
      expect(value.rotation.some((term) => Math.abs(term) > 1e-4), 'there should be some tilt').toBe(true);

      await page.mouse.move(4, 4);
      await expect.poll(() => movement(page)).toBeLessThan(0.05);
    });

    test('a control inside stays clickable while the card leans', async ({ page }) => {
      await pinCapabilities(page);
      await page.goto('/dev/motion');
      await tierOf(page);
      await card(page);
      const button = page.locator('[data-testid="depth-button"]');
      await button.hover();
      await expect.poll(() => movement(page)).toBeGreaterThan(0);
      await button.click();
      await expect(page.locator('[data-testid="depth-presses"]')).toHaveText('1');
      await button.click();
      await expect(page.locator('[data-testid="depth-presses"]')).toHaveText('2');
    });
  });

  test.describe('where it must stay inert', () => {
    test('a touch device gets no transform at all', async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 834, height: 1112 }, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      await pinCapabilities(page);
      await page.goto('/dev/motion');
      await tierOf(page);
      const box = await card(page);
      await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9);
      await page.waitForTimeout(400);
      expect(await depth(page)).toBeNull();
      await context.close();
    });

    test('reduced motion gets no transform at all', async ({ page }) => {
      await pinCapabilities(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/dev/motion');
      expect(await tierOf(page)).toBe('reduced');
      const box = await card(page);
      await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9);
      await page.waitForTimeout(400);
      expect(await depth(page)).toBeNull();
    });

    test('the light tier (a low-memory desktop) gets no transform at all', async ({ page }) => {
      await pinCapabilities(page, { cores: 8, memory: 2 });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/dev/motion');
      expect(await tierOf(page)).toBe('light');
      const box = await card(page);
      await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9);
      await page.waitForTimeout(400);
      expect(await depth(page)).toBeNull();
    });
  });
});

test.describe('AnimatedUnderline', () => {
  const line = (page: Page, testId: string) =>
    page
      .locator(`[data-testid="${testId}"]`)
      .evaluate((element) => getComputedStyle((element.closest('[data-underline]') as HTMLElement).querySelector('[data-underline-line]') as HTMLElement).transform);
  const UNDRAWN = 'matrix(0, 0, 0, 1, 0, 0)';

  test('draws under a link on hover and leaves when the pointer does', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dev/motion');
    const link = page.locator('[data-testid="underline-hover"]');
    await link.scrollIntoViewIfNeeded();
    expect(await line(page, 'underline-hover')).toBe(UNDRAWN);
    await link.hover();
    await expect.poll(() => line(page, 'underline-hover')).toMatch(IDENTITY_TRANSFORM);
    await page.mouse.move(4, 4);
    await expect.poll(() => line(page, 'underline-hover')).toBe(UNDRAWN);
  });

  test('draws for keyboard focus too, not only for the mouse', async ({ page }) => {
    await page.goto('/dev/motion');
    const link = page.locator('[data-testid="underline-hover"]');
    await link.scrollIntoViewIfNeeded();
    await link.focus();
    await expect.poll(() => line(page, 'underline-hover')).toMatch(IDENTITY_TRANSFORM);
  });

  test('an active item is underlined without any interaction', async ({ page }) => {
    await page.goto('/dev/motion');
    await page.locator('[data-testid="underline-active"]').scrollIntoViewIfNeeded();
    await expect.poll(() => line(page, 'underline-active')).toMatch(IDENTITY_TRANSFORM);
  });

  test('a scroll-drawn underline waits to be seen, then draws', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dev/motion');
    await tierOf(page);
    expect(await line(page, 'underline-view')).toBe(UNDRAWN);
    await page.locator('[data-testid="underline-view"]').scrollIntoViewIfNeeded();
    await expect.poll(() => line(page, 'underline-view')).toMatch(IDENTITY_TRANSFORM);
  });

  test('with reduced motion a scroll-drawn underline is already drawn, and a hover-only one is untouched', async ({ page }) => {
    await pinCapabilities(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dev/motion');
    await tierOf(page);
    expect(await line(page, 'underline-view')).toMatch(IDENTITY_TRANSFORM);
    expect(await line(page, 'underline-hover')).toBe(UNDRAWN);
  });
});
