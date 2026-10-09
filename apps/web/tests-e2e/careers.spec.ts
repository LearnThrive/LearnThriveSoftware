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
