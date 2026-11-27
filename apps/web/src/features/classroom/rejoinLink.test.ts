import { describe, expect, it, vi } from 'vitest';
import { freshJoinToken } from './rejoinLink';

const target = { kind: 'lesson' as const, id: 'lesson-1' };
const answer = (status: number, body: object = {}) => new Response(JSON.stringify(body), { status });

describe('getting back into a lesson', () => {
  it('renews a sign-in that lapsed during the lesson and carries on', async () => {
    const asked: string[] = [];
    const replies = [answer(401, { message: 'Sign in again to rejoin.' }), answer(200), answer(200, { token: 'fresh' })];
    const fetcher = vi.fn(async (url: string) => { asked.push(url.split('?')[0]); return replies.shift()!; });
    await expect(freshJoinToken(target, fetcher as unknown as typeof fetch, 0)).resolves.toBe('fresh');
    expect(asked).toEqual(['/api/classroom/token', '/api/account/refresh', '/api/classroom/token']);
  });

  it('keeps asking while the site is restarting or unreachable', async () => {
    const replies = [() => { throw new TypeError('offline'); }, () => answer(502), () => answer(200, { token: 'fresh' })];
    const fetcher = vi.fn(async () => replies.shift()!());
    await expect(freshJoinToken(target, fetcher as unknown as typeof fetch, 0)).resolves.toBe('fresh');
  });

  it('takes a real refusal as final', async () => {
    const fetcher = vi.fn(async () => answer(403, { message: 'The classroom for this lesson is not open.' }));
    await expect(freshJoinToken(target, fetcher as unknown as typeof fetch, 0)).rejects.toThrow('not open');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
