import { afterEach, describe, expect, it, vi } from 'vitest';
import { logOutcome } from './log';
import { SfuCallError, sfuFailureDetails } from './sfu';
import { turnFailureDetails } from './signalling';

// Launch checklist 3.8: the classroom server's log lines are structured and can carry nothing personal or secret.
describe('the classroom server log line', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes one JSON object, routine outcomes to stdout and the rest to stderr', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logOutcome('classroom-turn', 'ok');
    logOutcome('classroom-turn', 'failed', { status: 401 });
    expect(info.mock.calls).toEqual([['{"event":"classroom-turn","outcome":"ok"}']]);
    expect(warn.mock.calls).toEqual([['{"event":"classroom-turn","outcome":"failed","status":401}']]);
  });

  it('drops anything that is not a number, a boolean or a short code', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logOutcome('classroom-sfu', 'failed', {
      op: 'tracks.new',
      name: 'Jamie Patel',
      sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1',
      token: 'x'.repeat(41),
      count: Number.NaN,
      ok: true,
    });
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toEqual({ event: 'classroom-sfu', outcome: 'failed', op: 'tracks.new', ok: true });
  });
});

describe('what a failed Cloudflare call may log', () => {
  it('names the SFU operation and Cloudflare status and code, or the kind of failure', () => {
    expect(sfuFailureDetails('tracks.new', new SfuCallError(500, 'internal_error'))).toEqual({ op: 'tracks.new', status: 500, code: 'internal_error' });
    expect(sfuFailureDetails('session.new', new SfuCallError(401))).toEqual({ op: 'session.new', status: 401 });
    expect(sfuFailureDetails('renegotiate', Object.assign(new Error('x'), { name: 'TimeoutError' }))).toEqual({ op: 'renegotiate', reason: 'timeout' });
    expect(sfuFailureDetails('tracks.close', new TypeError('fetch failed'))).toEqual({ op: 'tracks.close', reason: 'network' });
    expect(sfuFailureDetails({ op: 'injected' }, new Error('Cloudflare SFU returned no session id'))).toEqual({ op: 'unknown', reason: 'unexpected' });
  });

  it('keeps the SFU error message free of anything but the status and code', () => {
    expect(new SfuCallError(429, 'rate_limited').message).toBe('Cloudflare SFU answered 429 rate_limited');
  });

  it('names the TURN status, or the kind of failure, and never the message', () => {
    expect(turnFailureDetails(Object.assign(new Error('key abc123 rejected'), { status: 401 }))).toEqual({ status: 401 });
    expect(turnFailureDetails(Object.assign(new Error('x'), { name: 'AbortError' }))).toEqual({ reason: 'timeout' });
    expect(turnFailureDetails(new TypeError('fetch failed'))).toEqual({ reason: 'network' });
    expect(turnFailureDetails('a string')).toEqual({ reason: 'unexpected' });
  });
});
