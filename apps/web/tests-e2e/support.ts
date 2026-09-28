import { test } from '@playwright/test';

/** Every spec here runs against one shared dev server (see playwright.config.ts) whose data
 * provider is in-memory and lives as long as that server does — including across a *retry* of the
 * same test. So a test that creates a record under a fixed name and then finds it by that name
 * passes on the first attempt and can never pass on a retry: the first attempt's record is still
 * sitting there, so the locator matches two elements (Playwright strict mode) or a count
 * assertion doubles.
 *
 * That turned a single transient timeout in the Tutor navigation journey — the suite's heaviest
 * test, which passes in ~8s on its own — into a hard failure reported as "strict mode violation:
 * resolved to 2 elements", which says nothing about why it actually failed. It also meant the
 * config's deliberate `retries: 1` did nothing for precisely the tests most likely to need it.
 *
 * Suffixing every name that is created and then searched for gives each attempt its own records,
 * so a retry starts from a state equivalent to a fresh run. Attempt 0 keeps the bare name, so a
 * normal green run is unchanged. */
export function uniqueLabel(base: string): string {
  const { retry } = test.info();
  return retry === 0 ? base : `${base} (retry ${retry})`;
}

/** Every public marketing route — shared by the motion specs, which all sweep the whole site. */
export const PUBLIC_ROUTES = [
  '/',
  '/subjects',
  '/maths-tuition',
  '/english-tuition',
  '/science-tuition',
  '/11-plus-tuition',
  '/about',
  '/book',
  '/contact',
  '/faq',
  '/safeguarding',
  '/privacy',
  '/cookies',
  '/terms',
  '/tuition-terms',
  '/complaints',
  '/accessibility',
];
