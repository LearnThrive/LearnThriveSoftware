/**
 * A fresh join link for somebody reconnecting to a lesson or meeting (app/api/classroom/token applies the same rules as the first join).
 * Nobody is to be shut out by a passing problem: a sign-in that lapsed during a long lesson is renewed, and a site that is still restarting is
 * asked again. A real refusal (not their lesson, or outside its join window) is final.
 */
export async function freshJoinToken(target: { kind: 'lesson' | 'meeting'; id: string }, fetcher: typeof fetch = fetch, pauseMs = 3000): Promise<string> {
  let message = 'We could not rejoin. Open it again from your dashboard.';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    try {
      const response = await fetcher('/api/classroom/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(target) });
      const data = await response.json().catch(() => ({})) as { token?: unknown; message?: unknown };
      if (response.ok && typeof data.token === 'string') return data.token;
      if (typeof data.message === 'string') message = data.message;
      // The access token lapses after about an hour, and nothing else on the classroom page renews it. The answer to this request sets the new one.
      if (response.status === 401) await fetcher('/api/account/refresh?next=%2Fdashboard', { redirect: 'manual', cache: 'no-store' });
      else if (response.status < 500 && response.status !== 429) break;
    } catch {
      // Offline for a moment, or the site is restarting.
    }
  }
  throw new Error(message);
}
