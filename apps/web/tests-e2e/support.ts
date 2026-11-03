import { test, expect, type Page } from '@playwright/test';

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

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
type Weekday = (typeof WEEKDAYS)[number];
const DAY_MS = 86_400_000;

/** Today's date in London, as UTC midnight: the scheduling form reads its date and time as London wall-clock time, and
 * whole-day steps from UTC midnight never cross a clock change. */
function londonToday(): Date {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** A lesson day (yyyy-mm-dd) counted from today rather than written down, so the test can never outlive it: `weekday`
 * of the Monday-to-Sunday week (the calendar's own) `weeksAhead` weeks after this one. Two or more weeks ahead is clear
 * of both seeded lessons (the upcoming one is always within the next seven days) and of the lessons other specs book
 * for later today to reach the join window and "starting soon". Give each test its own day. */
export function dayInWeeks(weeksAhead: number, weekday: Weekday): string {
  const today = londonToday();
  const monday = today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY_MS;
  return isoDay(new Date(monday + (weeksAhead * 7 + WEEKDAYS.indexOf(weekday)) * DAY_MS));
}

/** The first `weekday` of the month after the one `weeksAhead` weeks from today. It falls on day 1 to 7, so a weekly
 * series starting there has its first three lessons in one calendar month, all on screen together. */
export function firstOfNextMonth(weeksAhead: number, weekday: Weekday): string {
  const then = new Date(londonToday().getTime() + weeksAhead * 7 * DAY_MS);
  const first = new Date(Date.UTC(then.getUTCFullYear(), then.getUTCMonth() + 1, 1));
  return isoDay(new Date(first.getTime() + ((WEEKDAYS.indexOf(weekday) - (first.getUTCDay() + 6) % 7 + 7) % 7) * DAY_MS));
}

/** The date and time fields for a lesson on `day` at `time` (London), an hour later on each retry. A retry shares its
 * first attempt's in-memory data (see uniqueLabel), so booking the same slot again would get the scheduling-clash
 * warning instead of the calendar. Lessons default to an hour, so attempts never overlap, and the day stays put, so
 * the weekday and the calendar month the test looks at do too. */
export function lessonSlot(day: string, time: string): { date: string; time: string } {
  const [hour, minute] = time.split(':');
  return { date: day, time: `${String(Number(hour) + test.info().retry).padStart(2, '0')}:${minute}` };
}

/** Moves the calendar, which opens on the current month, forward to the month holding `day`, however many weeks ahead
 * that is. Each step waits for the title to change rather than reading it straight back after the click. */
export async function showMonthOf(page: Page, day: string) {
  const [year, month] = day.split('-').map(Number);
  const target = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(Date.UTC(year, month - 1, 1));
  const title = page.locator('.fc-toolbar-title');
  for (let i = 0; i < 12; i += 1) {
    const shown = await title.innerText();
    if (shown === target) break;
    await page.locator('.fc-next-button').click();
    await expect(title).not.toHaveText(shown);
  }
  await expect(title).toHaveText(target);
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
  '/trust',
  // plan19 phase B2: the Library information pages.
  '/library',
  '/pricing',
  // plan: careers (CAREERS_PROMPT.md). The dev server opens the forms for testing, so the form pages are swept too.
  '/careers',
  '/careers/maths-tutor',
  '/careers/register-interest',
  '/careers/privacy',
  '/careers/safeguarding-agreement',
  '/careers/apply',
  '/safeguarding/reconfirm',
];

/**
 * Counts React commits. React reports every commit to `__REACT_DEVTOOLS_GLOBAL_HOOK__` if one is
 * installed before it loads, so a stub hook is enough to answer "did this animation go through React
 * on every frame?" — the question plan11.md is built around — with a number instead of an opinion.
 * A count-up that used to `setState` on each frame commits ~50 times; one that writes the DOM
 * directly commits a handful of times at most. Install before navigation.
 */
export async function installReactCommitCounter(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __reactCommits: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
    w.__reactCommits = 0;
    const renderers = new Map();
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers,
      isDisabled: false,
      inject(renderer: unknown) {
        const id = renderers.size + 1;
        renderers.set(id, renderer);
        return id;
      },
      onCommitFiberRoot() {
        w.__reactCommits += 1;
      },
      onPostCommitFiberRoot() {},
      onCommitFiberUnmount() {},
      checkDCE() {},
    };
  });
}

export async function reactCommits(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __reactCommits: number }).__reactCommits);
}

export async function resetReactCommits(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __reactCommits: number }).__reactCommits = 0;
  });
}
