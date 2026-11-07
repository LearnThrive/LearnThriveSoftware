import { request } from '@playwright/test';

/**
 * Compiles the routes this suite reaches by *clicking*, before any test runs.
 *
 * Why: the e2e servers run `next dev`, which compiles a route the first time it is asked for. On a
 * 2-vCPU CI runner that first compile takes seconds — and when it happens inside an assertion's
 * timeout, the assertion loses a race it was never about. From the 2026-11-03 main runs:
 *
 *   navigation.spec.ts:43   "○ Compiling /dashboard/admin/tutors/[id] ..." starts, the 10 s
 *                           toHaveURL times out, and the retry serves the same page in 674 ms.
 *   one-sign-in.spec.ts:48  "GET /library/ai 200 in 9.4s (next.js: 9.2s)" against the 10 s
 *                           toHaveURL for /library/ai.
 *   learner.spec.ts:30      "○ Compiling /library/ai ..." at the moment it failed, on its own
 *                           server (3103) with its own build folder, so 3101's compile is no help.
 *
 * A route a spec reaches with `page.goto()` is not the problem: the navigation itself waits. The
 * problem is a route reached by a click, where only the assertion that follows is waiting. So this
 * warms those, per server: each of the four dev servers has its own NEXT_DIST_DIR and compiles
 * independently (see playwright.config.ts), hence the per-port lists.
 *
 * These requests are made signed out and with placeholder ids. Neither matters: `next dev`
 * compiles the route segment before the page's own code decides to redirect or 404, and
 * src/proxy.ts is a no-op outside production (lib/portal.ts `decide` returns "next" whenever
 * NODE_ENV !== "production"), so the request does reach the route. Nothing here signs in, writes
 * anything or depends on seeded data, so it cannot disturb the state the specs set up.
 *
 * This does not change what any test asserts. It moves a dev-server build cost out of the middle
 * of the assertions and into one place that is allowed to take as long as it takes.
 */

/** Routes reached by a click rather than a goto, per dev-server port. */
const ROUTES_BY_PORT: Record<string, string[]> = {
  // The default server: nearly every spec, and all of the admin journeys.
  '3100': [
    '/login',
    '/dashboard',
    // navigation.spec.ts:43's two profile pages, both click-reached from the people lists.
    '/dashboard/admin/tutors/warm-up',
    '/dashboard/admin/students/warm-up',
    // The rest of the Admin and Tutor journeys, click-reached through the sidebar.
    '/dashboard/admin/people/tutors',
    '/dashboard/admin/people/students',
    '/dashboard/admin/people/clients',
    '/dashboard/admin/assignments',
    '/dashboard/calendar',
    '/dashboard/lessons',
    '/dashboard/lessons/warm-up',
    '/dashboard/reports',
    '/dashboard/notifications',
    '/dashboard/settings',
    '/dashboard/students',
    '/dashboard/children',
    '/dashboard/progress/warm-up',
    '/dashboard/tutor/availability',
    // navigation.spec.ts:81 joins the real classroom; that page is only ever click-reached.
    '/dev/classroom',
    '/403',
  ],
  // The Library with its catalogue open: library-open, one-sign-in and the study-buddy specs.
  '3101': [
    '/login',
    '/dashboard',
    '/library/ai',
    '/library/search',
    '/library/free-samples',
    '/library/terms',
    '/library/subject/maths',
    // library-open.spec.ts clicks from a subject into a topic.
    '/library/subject/maths/algebra',
    '/account',
    '/account/learners',
  ],
  // Subscriptions open, with the fake Stripe.
  '3102': ['/login', '/dashboard', '/pricing', '/library/ai', '/account', '/account/billing/success'],
  // Learner identity: learner.spec.ts clicks "View as Kit" straight into /library/ai.
  '3103': ['/login', '/dashboard', '/library/ai', '/account', '/account/learners'],
};

/** A cold compile on two vCPUs can take far longer than any per-test timeout; that is the point. */
const PER_ROUTE_TIMEOUT_MS = 180_000;
/**
 * A ceiling per server, so this can never become the reason a CI job overruns. If warming is still
 * going after this, the rest is left to the tests — which is the behaviour without this file at
 * all, so the worst case is the status quo rather than a stuck run.
 */
const PER_SERVER_BUDGET_MS = 10 * 60_000;

/**
 * Is this server actually up? Playwright starts every `webServer` whatever `--project` was asked
 * for, so in practice all four are, and warming is keyed on what answers rather than on what the
 * projects declare — the `chromium` project inherits its baseURL from the top-level `use` and does
 * not carry one of its own, so reading it back off the config is the less reliable of the two.
 * Costs nothing when a server is already warm: an already-compiled route answers in ~0.2 s.
 */
async function isUp(port: string): Promise<boolean> {
  try {
    const context = await request.newContext({ baseURL: `http://localhost:${port}` });
    try {
      await context.get('/', { timeout: 30_000, maxRedirects: 0 });
      return true;
    } finally {
      await context.dispose();
    }
  } catch {
    return false;
  }
}

async function warmServer(port: string, routes: string[]): Promise<string[]> {
  const context = await request.newContext({ baseURL: `http://localhost:${port}` });
  const slow: string[] = [];
  const deadline = Date.now() + PER_SERVER_BUDGET_MS;
  try {
    // One at a time per server: these are single-process dev servers, and asking for ten cold
    // routes at once makes every one of them slower rather than finishing sooner.
    for (const route of routes) {
      if (Date.now() > deadline) {
        console.log(`  ${port} out of warm-up budget; leaving the remaining routes to the tests`);
        break;
      }
      const startedAt = Date.now();
      try {
        await context.get(route, { timeout: PER_ROUTE_TIMEOUT_MS, maxRedirects: 0 });
      } catch (error) {
        // A warm-up is best-effort. A route that cannot answer is reported and left to the test
        // that actually cares, which will fail with a far more useful message than this would.
        console.log(`  ${port} ${route} could not be warmed: ${(error as Error).message.split('\n')[0]}`);
        continue;
      }
      const ms = Date.now() - startedAt;
      if (ms >= 1000) slow.push(`${route} ${(ms / 1000).toFixed(1)}s`);
    }
  } finally {
    await context.dispose();
  }
  return slow;
}

export default async function warmRoutes() {
  const known = Object.keys(ROUTES_BY_PORT);
  const reachable = await Promise.all(known.map(async (port) => [port, await isUp(port)] as const));
  const work = reachable.filter(([, up]) => up).map(([port]) => port);
  if (work.length === 0) return;

  const startedAt = Date.now();
  console.log(`Warming dev routes on ${work.join(', ')} so no first compile lands inside a test's timeout.`);
  // Across servers in parallel: they are separate processes with separate build folders.
  const results = await Promise.all(work.map(async (port) => [port, await warmServer(port, ROUTES_BY_PORT[port])] as const));
  for (const [port, slow] of results) {
    if (slow.length > 0) console.log(`  ${port} compiled: ${slow.join(', ')}`);
  }
  console.log(`Warmed ${work.length} server(s) in ${((Date.now() - startedAt) / 1000).toFixed(0)}s.`);
}
