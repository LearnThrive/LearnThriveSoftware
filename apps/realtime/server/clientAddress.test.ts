import { describe, expect, it } from 'vitest';
import { clientAddress } from './clientAddress';

// The TURN credential limit's idea of a visitor: the same rule as apps/web/src/lib/rate-limit.ts.
describe('the visitor address behind a proxy', () => {
  const PROXY = '10.0.0.7';

  it('reads X-Forwarded-For from the right, skipping one proxy by default, so a forged left-hand entry changes nothing', () => {
    expect(clientAddress({ 'x-forwarded-for': '203.0.113.5, 10.1.1.1' }, PROXY, {})).toBe('203.0.113.5');
    expect(clientAddress({ 'x-forwarded-for': '6.6.6.6, 203.0.113.5, 10.1.1.1' }, PROXY, {})).toBe('203.0.113.5');
  });

  it('tells two visitors behind the same proxy apart', () => {
    const first = clientAddress({ 'x-forwarded-for': '203.0.113.5, 10.1.1.1' }, PROXY, {});
    const second = clientAddress({ 'x-forwarded-for': '198.51.100.9, 10.1.1.1' }, PROXY, {});
    expect(first).not.toBe(second);
    expect(first).not.toBe(PROXY);
  });

  it('follows TRUSTED_PROXY_HOPS, and treats a nonsense value as the default', () => {
    const headers = { 'x-forwarded-for': '203.0.113.5, 10.1.1.1, 10.2.2.2' };
    expect(clientAddress(headers, PROXY, { TRUSTED_PROXY_HOPS: '2' })).toBe('203.0.113.5');
    expect(clientAddress(headers, PROXY, { TRUSTED_PROXY_HOPS: '0' })).toBe('10.2.2.2');
    expect(clientAddress(headers, PROXY, { TRUSTED_PROXY_HOPS: 'many' })).toBe('10.1.1.1');
    // More hops than entries: the left-most, never past the start.
    expect(clientAddress({ 'x-forwarded-for': '203.0.113.5' }, PROXY, { TRUSTED_PROXY_HOPS: '5' })).toBe('203.0.113.5');
  });

  it('uses CLIENT_IP_HEADER when it holds a valid address, and falls back when it does not', () => {
    const env = { CLIENT_IP_HEADER: 'True-Client-IP' };
    expect(clientAddress({ 'true-client-ip': '2001:db8::1', 'x-forwarded-for': '203.0.113.5, 10.1.1.1' }, PROXY, env)).toBe('2001:db8::1');
    expect(clientAddress({ 'true-client-ip': 'not an address', 'x-forwarded-for': '203.0.113.5, 10.1.1.1' }, PROXY, env)).toBe('203.0.113.5');
  });

  it('uses the connection address when nothing was forwarded (a direct connection) or the entry is not an address', () => {
    expect(clientAddress({}, '127.0.0.1', {})).toBe('127.0.0.1');
    expect(clientAddress({ 'x-forwarded-for': 'garbage, 10.1.1.1' }, PROXY, {})).toBe(PROXY);
    expect(clientAddress({}, undefined, {})).toBe('unknown');
  });
});
