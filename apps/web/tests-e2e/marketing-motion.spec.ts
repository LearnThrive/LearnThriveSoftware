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

  // A reveal's start state is in the server-rendered HTML, so whatever it wraps is invisible until the
  // script has loaded and the animation has run. On the first screen that is the page's LCP: profiling
  // found /subjects and /about at ~900-1000 ms (against ~200 ms before) and /contact, /faq at ~870 ms
  // for exactly this reason. The first reveal on each of these pages is the first-screen content, so
  // it must be the explicit opt-out; reveals further down are where the choreography belongs.
  for (const route of [
    '/subjects',
    '/about',
    '/contact',
    '/faq',
    '/maths-tuition',
    '/english-tuition',
    '/science-tuition',
    '/11-plus-tuition',
  ]) {
    test(`${route}: the first block after the hero is never held back by a reveal`, async ({ request }) => {
      const html = await (await request.get(route)).text();
      const first = html.match(/data-reveal="(\w+)"/)?.[1];
      expect(first, `${route} has no reveal at all`).toBeDefined();
      expect(first, `${route}'s first reveal hides first-screen content until the script runs (LCP)`).toBe('static');
    });
  }
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

// ── Responsive (plan11.md task 18) ──────────────────────────────────────────────────────────
// subject-worlds.spec.ts already covers this for the 4 subject-world routes, whose absolutely
// positioned decorative elements (SubjectWorld's path/dots/nodes) made them the likeliest to
// overflow; this is the same check for every other public route, at the narrowest common device
// width.

test.describe('no horizontal overflow at 360px', () => {
  for (const route of PUBLIC_ROUTES) {
    test(route, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const viewportWidth = document.documentElement.clientWidth;
        return { docWidth, viewportWidth, overflows: docWidth > viewportWidth };
      });
      expect(overflow.overflows, `${route} overflows at 360px: scrollWidth ${overflow.docWidth} > clientWidth ${overflow.viewportWidth}`).toBe(false);
    });
  }
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

  test('a fast reverse jump (end straight to start) recovers correctly, not just forward scroll', async ({ page }) => {
    // plan11.md task 19's "fast/reverse scroll does not corrupt scene state": the scene's position
    // is a pure function of the current scrollY (framer-motion's useScroll), not an accumulator, so
    // there is no state to corrupt — this is direct evidence for that, not just the architecture.
    await pinCapabilities(page);
    await page.goto('/dev/motion');
    expect(await tierOf(page)).toBe('full');
    await scrollSceneTo(page, 'parallax', 'end');
    await expect.poll(() => layerOffset(page, 'parallax-layer')).toBeCloseTo(20, 0);
    await scrollSceneTo(page, 'parallax', 'start');
    await expect.poll(() => layerOffset(page, 'parallax-layer')).toBeCloseTo(-20, 0);
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

// ── Cinematic composition primitives (plan12.md task 2) ────────────────────────────────────────
// Also driven through /dev/motion.

test.describe('SceneShell', () => {
  test('renders each tone with its data attribute, no client JS required to see the right one', async ({ page }) => {
    await page.goto('/dev/motion');
    await expect(page.locator('#lab-scene-navy')).toHaveAttribute('data-scene-tone', 'navy');
    await expect(page.locator('#lab-scene-cream')).toHaveAttribute('data-scene-tone', 'cream');
    await expect(page.locator('#lab-scene-mint')).toHaveAttribute('data-scene-tone', 'mint');
  });
});

test.describe('CinematicBackdrop', () => {
  test('the full-tier backdrop renders on a capable desktop', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dev/motion');
    expect(await tierOf(page)).toBe('full');
    await page.locator('[data-lab-section="cinematic-backdrop"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-testid="backdrop-full"]')).toBeVisible();
  });

  test('the light tier gets the cheaper stand-in, not the full backdrop', async ({ page }) => {
    await pinCapabilities(page, { cores: 8, memory: 2 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dev/motion');
    expect(await tierOf(page)).toBe('light');
    await page.locator('[data-lab-section="cinematic-backdrop"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-testid="backdrop-light"]')).toBeVisible();
    await expect(page.locator('[data-testid="backdrop-full"]')).toHaveCount(0);
  });

  test('reduced motion renders no atmosphere at all — the tone alone carries the section', async ({ page }) => {
    await pinCapabilities(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dev/motion');
    expect(await tierOf(page)).toBe('reduced');
    await page.locator('[data-lab-section="cinematic-backdrop"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-cinematic-backdrop]')).toHaveCount(0);
  });

  test('suspends (unmounts) once scrolled well away, and comes back on return', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dev/motion');
    await page.locator('[data-lab-section="cinematic-backdrop"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-testid="backdrop-full"]')).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect(page.locator('[data-cinematic-backdrop][data-backdrop-active="false"]')).toBeVisible();
    await expect(page.locator('[data-testid="backdrop-full"]')).toHaveCount(0);
  });
});

test.describe('MaskedText', () => {
  test('wipes in via clip-path/opacity, starting fully clipped, ending fully revealed', async ({ page }) => {
    await pinCapabilities(page);
    await page.goto('/dev/motion');
    await tierOf(page);
    const inner = page.locator('[data-masked-text-inner]');
    await expect(inner).toHaveCSS('opacity', '0');
    await inner.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(inner).toHaveCSS('opacity', '1', { timeout: 5000 });
    await expect.poll(() => inner.evaluate((el) => getComputedStyle(el).clipPath)).not.toMatch(/100%/);
    await expect(page.locator('[data-testid="masked-text"]')).toHaveText('An oversized statement');
  });

  test('with reduced motion the text is already fully revealed, without scrolling to it', async ({ page }) => {
    await pinCapabilities(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dev/motion');
    await expect(page.locator('[data-masked-text-inner]')).toHaveCSS('opacity', '1');
  });

  test('the statement is real text in the server HTML, not revealed only by script', async ({ request }) => {
    const html = (await (await request.get('/dev/motion')).text()).replace(/<!-- -->/g, '');
    expect(html).toContain('An oversized statement');
  });
});

test.describe('SectionHandoff', () => {
  test('renders a background bridging the two tones', async ({ page }) => {
    await page.goto('/dev/motion');
    const handoff = page.locator('[data-section-handoff]');
    await expect(handoff).toBeVisible();
    const background = await handoff.evaluate((el) => getComputedStyle(el).backgroundImage + getComputedStyle(el).backgroundColor);
    expect(background).not.toBe('none rgba(0, 0, 0, 0)');
  });

  test('never intercepts scroll or clicks', async ({ page }) => {
    await page.goto('/dev/motion');
    await expect(page.locator('[data-section-handoff]')).toHaveCSS('pointer-events', 'none');
  });
});

test.describe('ProductLayer', () => {
  test('renders its content, and still leans toward the pointer like a plain PointerDepth card', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dev/motion');
    expect(await tierOf(page)).toBe('full');
    const content = page.locator('[data-testid="product-layer"]');
    await content.scrollIntoViewIfNeeded();
    await expect(content).toHaveText('Product surface');
    const box = (await content.boundingBox())!;
    // ProductLayer nests content > .surface (plain, unstyled wrapper) > PointerDepth's inner m.div
    // (the actual transform target) > PointerDepth's outer listener div > ParallaxLayer's m.div —
    // two levels up from `content` reaches the transform, not one.
    const depthLayer = () => content.evaluate((el) => getComputedStyle(el.parentElement!.parentElement!).transform);
    const before = await depthLayer();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9);
    await expect.poll(depthLayer).not.toBe(before);
  });
});

// ── Hero WebGL atmosphere (plan12.md task 4) ────────────────────────────────────────────────
// The raw-WebGL interactive gradient is the one thing this suite can't run on /dev/motion (it
// needs the real hero, not a lab section) — driven against / directly instead.

test.describe('hero WebGL atmosphere', () => {
  test('a capable desktop gets the canvas, not the static glow', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    expect(await tierOf(page)).toBe('full');
    const hero = page.locator('[data-motion-scene="hero"]');
    await expect(hero.locator('canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a phone gets the static glow, never the canvas', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    expect(await tierOf(page)).toBe('light');
    const hero = page.locator('[data-motion-scene="hero"]');
    await expect(hero.locator('canvas')).toHaveCount(0);
  });

  test('reduced motion gets the static glow, never the canvas', async ({ page }) => {
    await pinCapabilities(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    expect(await tierOf(page)).toBe('reduced');
    const hero = page.locator('[data-motion-scene="hero"]');
    await expect(hero.locator('canvas')).toHaveCount(0);
  });

  test('the canvas is excluded from the accessibility tree', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const canvas = page.locator('[data-motion-scene="hero"] canvas');
    await expect(canvas).toBeVisible();
    await expect(page.locator('[data-motion-scene="hero"] > div[aria-hidden="true"]').filter({ has: page.locator('canvas') })).toHaveCount(1);
  });

  // Code-splitting (whether the dynamic import actually keeps HeroWebGLAtmosphere/heroGradient
  // out of the page's initial script payload) is a production-bundling question dev mode doesn't
  // answer the same way — confirmed instead by inspecting a real `next build`'s
  // .next/build-manifest.json directly (the chunk containing this code is absent from every
  // route's listed files there), not by an e2e test against the dev server this suite runs on.
});

// ── Product story: classroom-to-progress transformation (plan12.md task 8) ─────────────────────

test.describe('ProductStoryScene', () => {
  test('the device chrome persists while scenes advance through discrete, threshold-based state', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await tierOf(page);
    const section = page.locator('#lesson-story');
    await section.scrollIntoViewIfNeeded();
    await expect(section.locator('[class*="stageChrome"]').first()).toBeVisible();
    await expect(section.locator('[class*="stageInner"] [class*="stageLabel"]')).toHaveText('Match');
    expect(errors).toEqual([]);
  });

  test('the closing statement is real, pre-existing beat copy, present without scrolling to it', async ({ request }) => {
    const html = await (await request.get('/')).text();
    expect(html).toContain("Tuition doesn&#x27;t disappear when the call ends.");
  });

  test('mobile drops the sticky composition for a plain vertical story', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const stickyCol = page.locator('#lesson-story [class*="stickyCol"]');
    await expect(stickyCol).toHaveCSS('position', 'relative');
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

// ── About page brand story (plan12.md task 11) ──────────────────────────────────────────────

test.describe('about page composition (task 11)', () => {
  test('the mission statement is real, masked text — present in the server HTML, not revealed only by script', async ({ request }) => {
    const html = (await (await request.get('/about')).text()).replace(/<!-- -->/g, '');
    expect(html).toContain('A global platform where every student is understood');
  });

  test('both founder portraits move on a shared scroll source as the section scrolls (full tier)', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/about');
    expect(await tierOf(page)).toBe('full');
    const portraitTransform = (alt: string) =>
      page.getByAltText(alt).evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).transform);
    const abdurrahman = page.getByAltText('Abdurrahman Mustafa, co-founder');
    await abdurrahman.scrollIntoViewIfNeeded();
    const before = await portraitTransform('Abdurrahman Mustafa, co-founder');
    await page.evaluate(() => window.scrollBy({ top: 220, behavior: 'instant' }));
    await expect.poll(() => portraitTransform('Abdurrahman Mustafa, co-founder')).not.toBe(before);
    await expect.poll(() => portraitTransform('Tahasin Hasan, co-founder')).not.toBe('none');
  });

  test('with reduced motion neither portrait moves at all', async ({ page }) => {
    await pinCapabilities(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/about');
    expect(await tierOf(page)).toBe('reduced');
    const abdurrahman = page.getByAltText('Abdurrahman Mustafa, co-founder');
    await abdurrahman.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy({ top: 220, behavior: 'instant' }));
    await page.waitForTimeout(200);
    const transform = await abdurrahman.evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).transform);
    expect(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
  });

  test('the second founder card is offset from the grid row on desktop, not on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/about');
    const cards = page.locator('[class*="foundersGrid"] > *');
    const desktopOffset = await cards.nth(1).evaluate((el) => getComputedStyle(el).marginTop);
    expect(desktopOffset).not.toBe('0px');
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileOffset = await cards.nth(1).evaluate((el) => getComputedStyle(el).marginTop);
    expect(mobileOffset).toBe('0px');
  });
});

// ── Book, Contact and FAQ interaction craft (plan12.md task 12) ─────────────────────────────

test.describe('book page composition (task 12)', () => {
  test('the form shell has its corner frame, and a subtle atmosphere renders behind the layout (full tier)', async ({ page }) => {
    await pinCapabilities(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/book');
    expect(await tierOf(page)).toBe('full');
    await expect(page.locator('.booking-form-frame-corner--tl')).toBeVisible();
    await expect(page.locator('.booking-form-frame-corner--br')).toBeVisible();
    const backdrop = page.locator('[data-cinematic-backdrop]').first();
    await expect(backdrop).toHaveAttribute('data-backdrop-active', 'true');
    await expect(backdrop.locator('.booking-atmosphere')).toBeAttached();
  });

  test('with reduced motion there is no backdrop, but the form and its frame are unaffected', async ({ page }) => {
    await pinCapabilities(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/book');
    expect(await tierOf(page)).toBe('reduced');
    await expect(page.locator('[data-cinematic-backdrop]')).toHaveCount(0);
    await expect(page.locator('.booking-form-frame-corner--tl')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
  });

  test('the form heading is real SSR text, not revealed only by script', async ({ request }) => {
    const html = (await (await request.get('/book')).text()).replace(/<!-- -->/g, '');
    expect(html).toContain('A few details to get started');
  });
});

test.describe('contact page composition (task 12)', () => {
  test('each contact method has its own glyph, and essential details are visible without hovering', async ({ page }) => {
    await page.goto('/contact');
    await expect(page.locator('[class*="cardWhite"] [class*="cardIcon"]')).toBeVisible();
    await expect(page.locator('[class*="cardNavy"] [class*="cardIcon"]')).toBeVisible();
    await expect(page.locator('[class*="cardLink"]')).toBeVisible();
    await expect(page.locator('[class*="phoneNumber"]').first()).toBeVisible();
  });

  test('the guidance statement is real SSR text, not revealed only by script', async ({ request }) => {
    const html = (await (await request.get('/contact')).text()).replace(/<!-- -->/g, '');
    expect(html).toContain('What to include in an enquiry');
  });
});

test.describe('FAQ active category nav (task 12)', () => {
  test('the pills for the category row currently in view are marked active as the page scrolls', async ({ page }) => {
    // The category grid is two columns (faq.module.css's .faqSections), so a row holds two
    // categories at the same vertical position — getting-started/lessons in row 1, then
    // subjects-and-stages/working-together in row 2.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/faq');
    const gettingStarted = page.locator('a[href="#getting-started"]');
    const lessons = page.locator('a[href="#lessons"]');
    const subjects = page.locator('a[href="#subjects-and-stages"]');
    const working = page.locator('a[href="#working-together"]');
    // Before any scroll (the hero still fills the screen) nothing has entered the observer's band
    // yet — getting-started's aria-current comes only from the component's initial placeholder.
    await expect(gettingStarted).toHaveAttribute('aria-current', 'true');

    // Scroll so a row's top sits inside the observer's active band (the top ~15-30% of the
    // viewport — see FaqJumpNav.tsx's rootMargin) rather than relying on scrollIntoViewIfNeeded's
    // "minimal scroll" default, which can leave the target at the very bottom edge of the viewport.
    await page.evaluate(() => {
      const el = document.getElementById('getting-started')!;
      const top = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top - window.innerHeight * 0.2, behavior: 'instant' });
    });
    await expect.poll(() => gettingStarted.getAttribute('aria-current')).toBe('true');
    await expect.poll(() => lessons.getAttribute('aria-current')).toBe('true');

    // Row 1 and row 2 are close together (a grid gap apart), so scrolling row 2's top to the same
    // 20%-from-top offset used above would leave row 1's bottom edge still inside the band. Instead
    // scroll until row 1's own bottom edge has just cleared the band's top, which — given the two
    // rows are close together — reliably lands row 2's top inside the band too.
    await page.evaluate(() => {
      const bandTop = window.innerHeight * 0.15;
      const prevBottom = document.getElementById('getting-started')!.getBoundingClientRect().bottom + window.scrollY;
      window.scrollTo({ top: prevBottom - bandTop + 5, behavior: 'instant' });
    });
    await expect.poll(() => subjects.getAttribute('aria-current')).toBe('true');
    await expect.poll(() => working.getAttribute('aria-current')).toBe('true');
    await expect.poll(() => gettingStarted.getAttribute('aria-current')).toBeNull();
    await expect.poll(() => lessons.getAttribute('aria-current')).toBeNull();
  });
});

// ── Route and section handoffs (plan12.md task 14) ──────────────────────────────────────────

test.describe('route handoffs (task 14)', () => {
  const HANDOFF_ROUTES = ['/about', '/contact', '/faq'];

  for (const route of HANDOFF_ROUTES) {
    test(`${route}: a SectionHandoff bridges the hard navy -> cream tone break`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('[data-section-handoff]')).toHaveCount(1);
    });
  }

  test('the footer has its own decorative atmosphere, inert to pointer events', async ({ page }) => {
    await page.goto('/about');
    const atmosphere = page.locator('.footer-atmosphere');
    await atmosphere.scrollIntoViewIfNeeded();
    await expect(atmosphere).toHaveAttribute('aria-hidden', 'true');
    await expect(atmosphere).toHaveCSS('pointer-events', 'none');
    const backgroundImage = await atmosphere.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(backgroundImage).not.toBe('none');
  });
});
