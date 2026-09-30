import { test, expect } from '@playwright/test';

// plan13.md task 11.7. next.config.ts's headers() applies to every route via a `/:path*` source
// matcher, so checking one representative route (the homepage) and the in-app classroom fallback
// route (the specific page these headers could break) covers the policy as actually served.

test.describe('security headers (task 11.7)', () => {
  test('baseline headers are present on a public route', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  // The fix this test guards: camera=()/microphone=() (empty allowlist) denies the feature to
  // every context, including this site's own top-level pages — not just third-party embeds. That
  // broke the in-app classroom fallback ((classroom)/dashboard/lessons/[id]/classroom), which
  // calls getUserMedia directly (features/classroom/media.ts). (self) keeps the real protection —
  // no other origin, and no iframe without an explicit allow attribute, gets camera/mic — while
  // letting this site's own pages that need it keep working. geolocation is never used anywhere
  // in this app, so it stays fully denied.
  test('camera and microphone are allowed for this site\'s own pages (self), not blanket-denied', async ({ request }) => {
    const response = await request.get('/');
    const policy = response.headers()['permissions-policy'];
    expect(policy).toContain('camera=(self)');
    expect(policy).toContain('microphone=(self)');
    expect(policy).toContain('geolocation=()');
  });

  test('the same policy applies to the in-app classroom route, where camera/microphone are actually used', async ({ request }) => {
    const response = await request.get('/dashboard/lessons/nonexistent-id/classroom');
    const policy = response.headers()['permissions-policy'];
    expect(policy).toContain('camera=(self)');
    expect(policy).toContain('microphone=(self)');
  });
});
