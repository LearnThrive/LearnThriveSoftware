import { test, expect } from '@playwright/test';
import { PUBLIC_ROUTES } from './support';

// plan13.md task 9: a static regression guard against the legacy site's obsolete enquiry-flow
// description ("the booking form prepares a draft email on your device for you to review and
// send") ever being reintroduced anywhere on the current site, which sends enquiries directly
// (apps/web/src/app/api/enquiry/route.ts genuinely calls Resend and emails a confirmation — this
// isn't just copy, the described behaviour is what the route actually does). Also guards the one
// real drift this task's own sweep found: legal-faqs.tsx's registered-office address had silently
// diverged (en-dash, missing "United Kingdom") from site.ts's siteConfig.correspondenceAddress,
// the value shown in the footer of every page.

const OBSOLETE_PHRASES = [
  'prepares an email draft',
  'prepares a draft email',
  'draft email',
  'email draft',
  'open email to review',
  'review and send it using your email',
  'does not send the enquiry',
  'does not send or store',
];

test.describe('content consistency: no stale enquiry-flow wording anywhere (task 9)', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route}: no obsolete draft-email language`, async ({ request }) => {
      const html = await (await request.get(route)).text();
      const lower = html.toLowerCase();
      for (const phrase of OBSOLETE_PHRASES) {
        expect(lower, `found obsolete phrase "${phrase}" on ${route}`).not.toContain(phrase);
      }
    });
  }
});

test.describe('content consistency: the current direct-send flow is described consistently (task 9)', () => {
  const DIRECT_SEND_ROUTES = ['/book', '/faq', '/privacy', '/cookies', '/terms'];

  for (const route of DIRECT_SEND_ROUTES) {
    test(`${route}: describes the enquiry as sent directly, not held for review`, async ({ request }) => {
      const html = (await (await request.get(route)).text()).replace(/<!-- -->/g, '');
      // Every one of these pages' own copy uses "directly" together with either "sends"/"sent" —
      // matching the API route's actual behaviour (resend.emails.send(...) to LearnThrive,
      // awaited, then a separate confirmation email back to the parent).
      expect(html).toMatch(/sen(d|t)s? (them|your enquiry|it)? ?directly|sen(d|t)s? directly/i);
    });
  }
});

test.describe('content consistency: company details match the canonical siteConfig values (task 9)', () => {
  test('the registered-office address is identical wherever it appears, not a drifted duplicate', async ({ request }) => {
    // apps/web/src/lib/site.ts's siteConfig.correspondenceAddress, shown in every page's footer —
    // the one place a visitor actually sees it repeatedly, so it's the value everything else
    // should match rather than silently drifting from over time.
    const CANONICAL_ADDRESS = '71-75 Shelton Street, Covent Garden, London, United Kingdom, WC2H 9JQ';

    const home = await (await request.get('/')).text();
    expect(home).toContain(CANONICAL_ADDRESS);

    const faq = await (await request.get('/faq')).text();
    expect(faq).toContain(CANONICAL_ADDRESS);
  });

  test('the company number is identical wherever it appears', async ({ request }) => {
    const CANONICAL_COMPANY_NUMBER = '16680738';
    const faq = await (await request.get('/faq')).text();
    expect(faq).toContain(CANONICAL_COMPANY_NUMBER);
  });

  test('the contact email is identical wherever it appears, no stale addresses', async ({ request }) => {
    const CANONICAL_EMAIL = 'info@learnthrivetuition.co.uk';
    for (const route of ['/', '/contact', '/book', '/faq', '/privacy', '/cookies', '/terms']) {
      const html = await (await request.get(route)).text();
      expect(html, `${route} should reference the canonical contact email`).toContain(CANONICAL_EMAIL);
    }
  });
});
