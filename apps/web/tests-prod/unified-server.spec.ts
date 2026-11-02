import { test, expect } from '@playwright/test';

// The classroom's browser code calls Socket.IO and /api/turn-credentials on the SITE'S OWN origin, and only the unified server
// (apps/web/serve.mjs, which starts server.ts in production mode) serves them: `next start` does not. So this file runs only
// against that server, and is skipped against a plain `next start`:
//
//   npm run build && PORT=3210 npm run serve --workspace=apps/web          (one terminal)
//   PROD_SERVER=unified PROD_BASE_URL=http://localhost:3210 npm run test:prod-smoke -- unified-server    (another)
//
// Nothing here joins a room or needs a Cloudflare key: with no TURN key the credential endpoint answers 503, which is the
// intended "STUN only" state and is accepted here; with a key it must answer 200 with ICE servers and a lifetime.
test.describe('the unified production server', () => {
  test.skip(process.env.PROD_SERVER !== 'unified', 'Start the unified server (npm run serve) and set PROD_SERVER=unified.');

  test('Socket.IO answers on the site origin', async ({ request }) => {
    const response = await request.get('/socket.io/?EIO=4&transport=polling');
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('"sid"');
  });

  test('the TURN credential endpoint is on the site origin and says plainly whether TURN is configured', async ({ request }) => {
    const response = await request.get('/api/turn-credentials');
    expect([200, 503]).toContain(response.status());
    const body = await response.json();
    if (response.status() === 200) {
      expect(body.iceServers).toBeTruthy();
      expect(typeof body.ttlSeconds).toBe('number');
    } else {
      expect(String(body.error)).toMatch(/not configured/i);
    }
  });

  test('the pages are still served by Next, with the production headers and a closed portal', async ({ request }) => {
    const home = await request.get('/');
    expect(home.status()).toBe(200);
    expect(home.headers()['content-security-policy']).toBeTruthy();
    expect((await request.get('/api/health')).status()).toBe(200);
    expect((await request.get('/api/dev/reset', { maxRedirects: 0 })).status()).toBe(404);
  });
});
