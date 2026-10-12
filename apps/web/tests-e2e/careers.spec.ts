import { test, expect, type Page } from '@playwright/test';
import { testimonials } from '../src/lib/site';
import { expectNoAxeViolations, hydrated } from './careers-support';

// The careers hub, the role pages and the agreement and privacy pages (CAREERS_PROMPT.md). The dev server
// opens the application forms for testing (playwright.config.ts), so these pages show the "open" state; the
// closed state, which is how the site ships, is covered against the production build in tests-prod/smoke.spec.ts.

const sameOriginOnly = async (page: Page, action: () => Promise<void>) => {
  const hosts = new Set<string>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'http:' || url.protocol === 'https:') hosts.add(url.host);
  });
  await action();
  expect([...hosts], 'a careers page may talk only to its own origin').toEqual(['localhost:3100']);
};

test.describe('the careers hub', () => {
  test('says what the work is, in the owner-confirmed facts and no others', async ({ page }) => {
    await page.goto('/careers');
    await expect(page.getByRole('heading', { level: 1, name: 'Tutor with LearnThrive' })).toBeVisible();
    const main = page.locator('main');
    const text = (await main.innerText()).replace(/\s+/g, ' ');

    // The confirmed facts.
    for (const fact of [
      '£10 an hour per student',
      'Hours depend on student availability.',
      'No formal training is currently provided.',
      'Self-employed',
      'Opportunities to progress may exist later.',
      'We will reply within 5 working days.',
      'Tahasin Hasan',
      'Abdurrahman Mustafa',
      'No tutor teaches any student, or has any contact with one, until every check is complete.',
      'Tutors reconfirm the safeguarding agreement every year, and whenever a new version is issued.',
      'Enhanced DBS check including the Children’s Barred List',
    ]) {
      expect(text, fact).toContain(fact);
    }

    // Nothing the owner has not confirmed.
    for (const forbidden of [/induction/i, /refresher/i, /introductory/i, /intro(duction)? offer/i, /guaranteed/i, /award[- ]winning/i, /accredited/i, /flexible hours/i, /\bbenefits\b/i]) {
      expect(text, String(forbidden)).not.toMatch(forbidden);
    }
  });

  test('lists the four open roles and the register-your-interest option, each with a way to view and apply', async ({ page }) => {
    await page.goto('/careers');
    const roles = page.locator('#open-roles article');
    await expect(roles).toHaveCount(5);
    for (const [title, slug] of [
      ['Maths Tutor', 'maths-tutor'],
      ['English Tutor', 'english-tutor'],
      ['Science Tutor', 'science-tutor'],
      ['11+ Preparation Tutor', '11-plus-tutor'],
      ['Register your interest', 'register-interest'],
    ] as const) {
      const card = roles.filter({ has: page.getByRole('heading', { name: title }) });
      await expect(card.getByRole('link', { name: new RegExp(`View role`) })).toHaveAttribute('href', `/careers/${slug}`);
      await expect(card.getByRole('link', { name: /^Apply/ })).toHaveAttribute('href', `/careers/apply?role=${slug}`);
      await expect(card).toContainText('£10 an hour per student.');
    }
  });

  test('the hiring steps are the seven the owner set, and only those', async ({ page }) => {
    await page.goto('/careers');
    const steps = page.getByRole('heading', { level: 3, name: /^Step \d: / });
    await expect(steps).toHaveCount(7);
    await expect(steps.nth(0)).toContainText('Apply online');
    await expect(steps.nth(3)).toContainText('Identity and right-to-work checks');
    await expect(steps.nth(4)).toContainText('Enhanced DBS check');
    await expect(steps.nth(6)).toContainText('You start teaching');
    await expect(steps.nth(6).locator('xpath=ancestor::li')).toContainText('No tutor teaches any student before then.');
  });

  test('says how applications are judged, including degree-level results and no fixed references', async ({ page }) => {
    await page.goto('/careers');
    await expect(page.locator('main')).toContainText('results across GCSE, A Level and any degree (undergraduate or higher)');
    await expect(page.locator('main')).toContainText('A strong later result is taken into account even if earlier results were weaker.');
    await expect(page.locator('main')).toContainText('We do not ask for a fixed number of references.');
  });

  test('the families section reuses the site testimonials word for word', async ({ page }) => {
    await page.goto('/careers');
    for (const testimonial of testimonials.slice(0, 3)) {
      await expect(page.locator('main')).toContainText(testimonial.quote);
      await expect(page.locator('main')).toContainText(testimonial.attribution);
    }
  });

  test('the applicant FAQ answers the questions, and the DBS answer carries the one definition of a suitable certificate', async ({ page }) => {
    await page.goto('/careers');
    const faq = page.locator('#faq-heading').locator('xpath=ancestor::section');
    await expect(faq.locator('details')).toHaveCount(13);
    await faq.getByText('What about the DBS check, and who pays?').click();
    await expect(faq).toContainText('Every tutor must agree to an Enhanced DBS check including the Children’s Barred List.');
    await expect(faq).toContainText('subscribed to the DBS Update Service');
    await expect(faq).toContainText('LearnThrive decides whether to accept it.');
    await faq.getByText('Which files can I upload, and how big can they be?').click();
    await expect(faq).toContainText('up to 3 MB');
    await expect(faq).toContainText('12 MB or less');
  });

  test('safeguarding is firm and specific, and links to the full agreement and the safeguarding page', async ({ page }) => {
    await page.goto('/careers');
    const section = page.locator('#safeguarding-heading').locator('xpath=ancestor::section');
    await expect(section).toContainText('Our safeguarding lead is Tahasin Hasan and our deputy safeguarding lead is Abdurrahman Mustafa.');
    await expect(section).toContainText('Every applicant must read and agree to the safeguarding agreement as part of applying.');
    await expect(section).toContainText('LearnThrive arranges it and pays for it, unless you already hold a suitable certificate or choose to pay for your own check.');
    await expect(section.getByRole('link', { name: /Read the safeguarding agreement/ })).toHaveAttribute('href', '/careers/safeguarding-agreement');
    await expect(section.getByRole('link', { name: /Our safeguarding information/ })).toHaveAttribute('href', '/safeguarding');
  });

  test('has the equal-opportunities statement with a way to ask for an adjustment', async ({ page }) => {
    await page.goto('/careers');
    const section = page.locator('#adjustments-heading').locator('xpath=ancestor::section');
    await expect(section).toContainText('Everyone should be able to apply');
    await expect(section.getByRole('link', { name: 'info@learnthrivetuition.co.uk' })).toBeVisible();
    await expect(section.getByRole('link', { name: '+44 7459 839595' })).toBeVisible();
  });

  test('is in the footer, and the footer also links the applicant privacy notice', async ({ page }) => {
    await page.goto('/about');
    const footer = page.locator('footer');
    await expect(footer.getByRole('link', { name: 'Careers' })).toHaveAttribute('href', '/careers');
    await expect(footer.getByRole('link', { name: 'Applicant privacy' })).toHaveAttribute('href', '/careers/privacy');
  });

  test('no cookies, no browser storage written by the careers pages, and no third-party requests', async ({ page }) => {
    await sameOriginOnly(page, async () => {
      for (const route of ['/careers', '/careers/maths-tutor', '/careers/privacy', '/careers/safeguarding-agreement']) {
        await page.goto(route, { waitUntil: 'networkidle' });
      }
    });
    const stored = await page.evaluate(() => ({ cookie: document.cookie, local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
    expect(stored.cookie).toBe('');
    expect(stored.local).toEqual([]);
    expect(stored.session).toEqual([]);
  });
});

test.describe('role pages', () => {
  test('a vacancy page shows the role, the facts and a way to apply for it', async ({ page }) => {
    await page.goto('/careers/maths-tutor');
    await expect(page.getByRole('heading', { level: 1, name: 'Maths Tutor' })).toBeVisible();
    const side = page.getByRole('complementary', { name: 'Key facts about this role' });
    await expect(side).toContainText('Self-employed');
    await expect(side).toContainText('£10 an hour per student.');
    await expect(side).toContainText('Hours depend on student availability.');
    await expect(side).toContainText('No formal training is currently provided.');
    await expect(page.getByRole('link', { name: 'Apply for this role' }).first()).toHaveAttribute('href', '/careers/apply?role=maths-tutor');
    await expect(page.getByRole('heading', { name: 'What you will do' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What we are looking for' })).toBeVisible();
    // Nothing confirmed about preferred extras, so the section is left out rather than invented.
    await expect(page.getByRole('heading', { name: 'Nice to have' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Maths Tutor');
  });

  test('carries no JobPosting markup until the owner has confirmed the date the role went live', async ({ page }) => {
    await page.goto('/careers/maths-tutor');
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.some((block) => block.includes('"JobPosting"'))).toBe(false);
    expect(blocks.some((block) => block.includes('"BreadcrumbList"'))).toBe(true);
  });

  test('every open role has a page, and the register-your-interest page is not a vacancy', async ({ page }) => {
    for (const [slug, title] of [
      ['english-tutor', 'English Tutor'],
      ['science-tutor', 'Science Tutor'],
      ['11-plus-tutor', '11+ Preparation Tutor'],
      ['register-interest', 'Register your interest'],
    ]) {
      const response = await page.goto(`/careers/${slug}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    }
  });

  test('an unknown role is the site’s not-found page', async ({ page }) => {
    const response = await page.goto('/careers/astronaut');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('That page is not here');
  });
});

test.describe('the safeguarding agreement page and the applicant privacy notice', () => {
  test('the agreement shows every part and every clause, its version and its date', async ({ page }) => {
    await page.goto('/careers/safeguarding-agreement');
    await expect(page.getByRole('heading', { level: 1, name: 'Safeguarding agreement for tutors' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Version 1.0');
    for (const part of 'ABCDEFG') await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^Part ${part}:`) })).toBeVisible();
    await expect(page.locator('main')).toContainText('I will report any safeguarding concern to the safeguarding lead, Tahasin Hasan, immediately, and never later than the same day');
    await expect(page.locator('main')).toContainText('I will not teach, or have any contact with, any LearnThrive student until every check is complete.');
    await expect(page.locator('main')).toContainText('Definitions');
    await expect(page.getByRole('link', { name: 'reconfirmation page' })).toHaveAttribute('href', '/safeguarding/reconfirm');
  });

  test('the applicant privacy notice names the providers, the DBS rule and the retention periods', async ({ page }) => {
    await page.goto('/careers/privacy');
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    for (const expected of [
      'LearnThrive Tuition Ltd',
      'Resend',
      'Render',
      'IONOS',
      'Enhanced DBS check including the Children’s Barred List',
      'DBS certificate information is not collected through this website.',
      'Up to 6 months after the decision',
      'Up to 12 months after the decision',
      'While you work with LearnThrive, and for 12 months after',
      'for 6 years after',
      'Information Commissioner’s Office',
      'do not use it for automated decisions or profiling',
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(text).not.toMatch(/Google/);
  });
});

test.describe('accessibility of the careers pages', () => {
  for (const route of ['/careers', '/careers/maths-tutor', '/careers/safeguarding-agreement', '/careers/privacy']) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${route} is axe-clean (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
        await page.goto(route);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoAxeViolations(page, `${route} (${scheme})`);
      });
    }
  }

  test('the hub has no horizontal overflow at 360px and its section links are real anchors', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/careers');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.locator('#open-roles')).toBeAttached();
  });
});

// ── the rest of the site ───────────────────────────────────────────────────────────────────────────────
// The safeguarding wording pass and the places that point at careers: the home page, the About page, the
// palette, the safeguarding page and the privacy and cookie notices.

test.describe('the rest of the site', () => {
  test('the home page says no tutor teaches until every check is complete, and ends with a careers band', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'No tutor teaches until every check is complete' })).toBeVisible();
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('Enhanced DBS check including the Children’s Barred List');
    expect(text).not.toMatch(/thorough hiring process/i);
    const band = page.getByRole('region', { name: 'Tutor? Teach with LearnThrive.' });
    await expect(band).toContainText('We are recruiting self-employed online tutors.');
    await expect(band.getByRole('link', { name: /See open roles/ })).toHaveAttribute('href', '/careers');
  });

  test('the About page points tutors to the hub', async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByRole('link', { name: 'See how to teach with LearnThrive' })).toHaveAttribute('href', '/careers');
  });

  test('the site search finds Careers', async ({ page }) => {
    await page.goto('/about');
    await hydrated(page);
    await page.getByRole('button', { name: 'Search the site' }).click();
    const palette = page.getByRole('dialog', { name: 'Search LearnThrive' });
    await page.getByRole('combobox', { name: 'Search LearnThrive' }).fill('tutor jobs');
    await expect(palette.getByRole('option', { name: /Careers/ }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/careers$/);
  });

  test('the safeguarding page names the lead and deputy, states the rule firmly and keeps the independent numbers', async ({ page }) => {
    await page.goto('/safeguarding');
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    for (const fact of [
      'safeguarding lead is Tahasin Hasan',
      'deputy safeguarding lead is Abdurrahman Mustafa',
      'No tutor teaches any student, or has any contact with one, until every check is complete.',
      'Enhanced DBS check including the Children’s Barred List',
      'LearnThrive pays for it unless the tutor already holds a suitable certificate or chooses to pay for their own check',
      'reconfirm the safeguarding agreement every year',
      'If a child is in immediate danger, call 999 first.',
      'LearnThrive lessons are not recorded by default.',
      '0808 800 5000',
      '0800 1111',
    ]) {
      expect(text, fact).toContain(fact);
    }
    for (const gone of [/thorough hiring process/i, /induction/i, /refresher/i, /code of conduct/i]) expect(text).not.toMatch(gone);
    await expect(page.getByRole('link', { name: 'Read the safeguarding agreement' })).toHaveAttribute('href', '/careers/safeguarding-agreement');
  });

  test('the privacy notice covers applicants and subject requests and names the providers; the cookie notice covers the forms', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('link', { name: 'applicant privacy notice' }).first()).toHaveAttribute('href', '/careers/privacy');
    const privacy = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    expect(privacy).toContain('Render hosts the website, Resend delivers the emails the website sends, and IONOS hosts');
    expect(privacy).toContain('A subject request is kept until that subject is added, or for 12 months');
    expect(privacy).not.toMatch(/Google/);
    await page.goto('/cookies');
    const cookies = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    expect(cookies).toContain('the tutor application form and the subject request form');
    expect(cookies).toContain('it sets no cookies, saves nothing and contacts no outside service');
  });
});

// ── the layout of the hub (plan18) ─────────────────────────────────────────────────────────────────────
// The four subject roles are one balanced group and "Register your interest" is a wide card of its own beneath them,
// so no card is left alone on a row. The families' reviews have room to read, each at the height its own text needs.

const roleBoxes = (page: Page) =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('#open-roles article')].map((card) => {
      const r = card.getBoundingClientRect();
      const value = card.querySelectorAll('dd');
      const facts = [...card.querySelectorAll('dl > div')].map((row) => {
        const label = row.querySelector('dt')!.getBoundingClientRect();
        const text = row.querySelector('dd')!.getBoundingClientRect();
        return { labelRight: label.right, labelTop: label.top, valueLeft: text.left, valueTop: text.top };
      });
      return { title: card.querySelector('h3')!.textContent!.trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, facts, valueLefts: [...value].map((dd) => Math.round(dd.getBoundingClientRect().left)) };
    });
    return cards;
  });

test.describe('the open roles layout', () => {
  test('on a wide screen: four equal subject cards in one row, then Register your interest across the full width', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/careers');
    const cards = await roleBoxes(page);
    expect(cards.map((c) => c.title)).toEqual(['Maths Tutor', 'English Tutor', 'Science Tutor', '11+ Preparation Tutor', 'Register your interest']);
    const subjects = cards.slice(0, 4);
    const interest = cards[4];
    expect(new Set(subjects.map((c) => Math.round(c.top))).size, 'the four subject cards share one row').toBe(1);
    expect(new Set(subjects.map((c) => Math.round(c.height))).size, 'and are the same height').toBe(1);
    expect(Math.max(...subjects.map((c) => c.width)) - Math.min(...subjects.map((c) => c.width))).toBeLessThan(2);
    expect(interest.top, 'Register your interest is under them').toBeGreaterThanOrEqual(subjects[0].bottom);
    const span = Math.max(...subjects.map((c) => c.right)) - Math.min(...subjects.map((c) => c.left));
    expect(interest.width, 'and as wide as the group above').toBeGreaterThanOrEqual(span - 2);
    expect(interest.left).toBeLessThanOrEqual(subjects[0].left + 2);
  });

  test('the title, summary, facts and buttons line up across the four cards', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/careers');
    const tops = await page.evaluate(() => {
      const row = [...document.querySelectorAll<HTMLElement>('#open-roles article')].slice(0, 4);
      const of = (selector: string) => row.map((card) => Math.round(card.querySelector(selector)!.getBoundingClientRect().top));
      return { title: of('h3'), summary: of('h3 + p'), facts: of('dl') };
    });
    expect(new Set(tops.title).size, 'titles').toBe(1);
    expect(new Set(tops.summary).size, 'summaries').toBe(1);
    expect(new Set(tops.facts).size, 'facts').toBe(1);
  });

  test('two by two below 1248px, with Register your interest underneath, and one column on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/careers');
    let cards = await roleBoxes(page);
    expect(new Set(cards.slice(0, 4).map((c) => Math.round(c.left))).size, 'two columns').toBe(2);
    expect(new Set(cards.slice(0, 4).map((c) => Math.round(c.top))).size, 'two rows').toBe(2);
    expect(cards[4].top).toBeGreaterThanOrEqual(cards[3].bottom);
    expect(cards[4].width).toBeGreaterThan(cards[0].width * 1.8);
    await page.setViewportSize({ width: 390, height: 844 });
    cards = await roleBoxes(page);
    expect(new Set(cards.map((c) => Math.round(c.left))).size, 'one column').toBe(1);
  });

  test('every fact keeps its value beside its label, and the values of a card line up in their column', async ({ page }) => {
    for (const width of [1440, 834, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/careers');
      for (const card of await roleBoxes(page)) {
        for (const fact of card.facts) {
          expect(fact.valueLeft, `${card.title} at ${width}px: a value starts after its label`).toBeGreaterThanOrEqual(fact.labelRight);
          expect(Math.abs(fact.valueTop - fact.labelTop), `${card.title} at ${width}px: and on the same line as its label`).toBeLessThan(4);
        }
        // One column of facts has one left edge. The wide card sets its facts in two columns of its own above a phone.
        const columns = card.title === 'Register your interest' && width > 640 ? 2 : 1;
        expect(new Set(card.valueLefts).size, `${card.title} at ${width}px: the values start at ${columns} left edge(s)`).toBeLessThanOrEqual(columns);
      }
    }
  });

  test('every role still states its terms and has a way to view it and to apply', async ({ page }) => {
    await page.goto('/careers');
    const roles = page.locator('#open-roles article');
    await expect(roles).toHaveCount(5);
    for (let i = 0; i < 5; i += 1) {
      const card = roles.nth(i);
      await expect(card).toContainText('Self-employed');
      await expect(card).toContainText('Online, one to one');
      await expect(card).toContainText('£10 an hour per student.');
      await expect(card).toContainText('Hours depend on student availability.');
      await expect(card.getByRole('link', { name: /^View role/ })).toHaveAttribute('href', /^\/careers\/[a-z0-9-]+$/);
      await expect(card.getByRole('link', { name: /^Apply/ })).toBeVisible();
    }
  });

  for (const width of [1440, 1280, 1100, 834, 768, 390, 360]) {
    test(`no horizontal overflow in the roles at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/careers');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      const overflowing = await page.evaluate(() => [...document.querySelectorAll('#open-roles article')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).length);
      expect(overflowing).toBe(0);
    });
  }
});

const familyBoxes = (page: Page) =>
  page.evaluate(() => {
    const section = document.querySelector('section[aria-labelledby="families-heading"]')!;
    const container = section.querySelector('.container')!.getBoundingClientRect();
    return {
      container: { left: container.left, right: container.right, width: container.width },
      cards: [...section.querySelectorAll('figure')].map((figure) => {
        const r = figure.getBoundingClientRect();
        const quote = figure.querySelector('blockquote')!;
        const lh = parseFloat(getComputedStyle(quote).lineHeight);
        const lines = Math.max(1, Math.round(quote.getBoundingClientRect().height / lh));
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, charsPerLine: (quote.textContent ?? '').length / lines, featured: figure.classList.contains('testimonial-card--featured') };
      }),
    };
  });

test.describe('the families section layout', () => {
  test('three cards side by side across the container, each wide enough to read, at the height its own text needs', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/careers');
    const { container, cards } = await familyBoxes(page);
    expect(cards).toHaveLength(3);
    expect(new Set(cards.map((c) => Math.round(c.top))).size, 'one row').toBe(1);
    for (const card of cards) {
      expect(card.width, 'a card is at least 320px wide').toBeGreaterThanOrEqual(320);
      expect(card.charsPerLine, 'about 30 to 60 characters a line').toBeGreaterThan(28);
      expect(card.charsPerLine).toBeLessThan(62);
      expect(card.right).toBeLessThanOrEqual(container.right + 1);
    }
    const used = Math.max(...cards.map((c) => c.right)) - Math.min(...cards.map((c) => c.left));
    expect(used / container.width, 'the cards use the whole width of the container').toBeGreaterThan(0.95);
    // Natural heights: a card is as tall as its own words need, not stretched to match its neighbour.
    expect(cards[2].height).toBeLessThan(cards[0].height);
  });

  test('on a tablet the navy review leads on its own row, and the other two sit side by side under it', async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1112 });
    await page.goto('/careers');
    const { container, cards } = await familyBoxes(page);
    const featured = cards.find((c) => c.featured)!;
    const others = cards.filter((c) => !c.featured);
    expect(featured.width).toBeGreaterThan(container.width * 0.95);
    expect(others.every((c) => c.top >= featured.bottom)).toBe(true);
    expect(new Set(others.map((c) => Math.round(c.top))).size, 'the other two share a row').toBe(1);
    expect(featured.charsPerLine, 'the wide card keeps a readable line').toBeLessThan(75);
  });

  test('one column on a phone, nothing clipped', async ({ page }) => {
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/careers');
      const { container, cards } = await familyBoxes(page);
      expect(new Set(cards.map((c) => Math.round(c.left))).size).toBe(1);
      for (const card of cards) {
        expect(card.right).toBeLessThanOrEqual(container.right + 1);
        expect(card.left).toBeGreaterThanOrEqual(container.left - 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
  });

  test('the reviews are the real ones, word for word', async ({ page }) => {
    await page.goto('/careers');
    const text = (await page.locator('section[aria-labelledby="families-heading"]').innerText()).replace(/\s+/g, ' ');
    for (const review of testimonials.slice(0, 3)) {
      expect(text).toContain(review.title);
      expect(text).toContain(review.quote.replace(/\s+/g, ' '));
      expect(text).toContain(review.attribution);
    }
  });
});

// ── the role pages and the safeguarding block (plan18 audit) ───────────────────────────────────────────────

test.describe('a role page', () => {
  test('has one way back to the hub in its hero, the breadcrumb, and no second link worded "All roles"', async ({ page }) => {
    await page.goto('/careers/maths-tutor');
    const hero = page.locator('section.page-hero');
    await expect(hero.getByRole('link', { name: 'All roles' })).toHaveCount(0);
    await expect(hero.locator('a[href="/careers"]')).toHaveCount(1);
    await expect(hero.getByRole('link', { name: 'Apply for this role' })).toBeVisible();
  });

  test('"Also open" is three cards across on a wide screen and one column below that, never a pair with one alone', async ({ page }) => {
    for (const [width, columns] of [[1440, 3], [1100, 3], [834, 1], [390, 1]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/careers/maths-tutor');
      const boxes = await page.evaluate(() => [...document.querySelectorAll('section[aria-labelledby="related-heading"] article')].map((card) => {
        const r = card.getBoundingClientRect();
        return { left: Math.round(r.left), right: r.right };
      }));
      expect(boxes, `three cards at ${width}px`).toHaveLength(3);
      expect(new Set(boxes.map((b) => b.left)).size, `${columns} column(s) at ${width}px`).toBe(columns);
      expect(Math.max(...boxes.map((b) => b.right)), `nothing past the screen at ${width}px`).toBeLessThanOrEqual(width);
    }
  });
});

test.describe('the safeguarding block on the hub', () => {
  test('on a wide screen the heading sits beside the facts, and no line of the lists runs past about ninety characters', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/careers');
    const result = await page.evaluate(() => {
      const section = document.querySelector('section[aria-labelledby="safeguarding-heading"]')!;
      const heading = section.querySelector('h2')!.getBoundingClientRect();
      const firstFact = section.querySelector('li')!.getBoundingClientRect();
      const measures = [...section.querySelectorAll('li')].map((li) => {
        const style = getComputedStyle(li);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
        const lines = Math.max(1, Math.round(li.getBoundingClientRect().height / lineHeight));
        return (li.textContent ?? '').length / lines;
      });
      return { headingRight: heading.right, factLeft: firstFact.left, longest: Math.max(...measures) };
    });
    expect(result.factLeft, 'the facts start to the right of the heading').toBeGreaterThan(result.headingRight - 1);
    expect(result.longest, 'a line is about 90 characters at most (it was 105 and more across the whole card)').toBeLessThan(95);
  });

  test('keeps its order on a phone: heading, facts, commitments, links', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/careers');
    const tops = await page.evaluate(() => {
      const section = document.querySelector('section[aria-labelledby="safeguarding-heading"]')!;
      const top = (el: Element | null) => el!.getBoundingClientRect().top;
      const links = [...section.querySelectorAll('a')].find((a) => (a.textContent ?? '').includes('Read the safeguarding agreement'));
      return [top(section.querySelector('h2')), top(section.querySelector('li')), top(section.querySelector('h3')), top(links ?? null)];
    });
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });
});
