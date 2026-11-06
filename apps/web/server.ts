import http from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { parse } from 'node:url';
import next from 'next';
import { createSignallingServer } from '@learnthrive/realtime/signalling';
import { applyLocalSupabaseEnv } from './src/lib/dev/localSupabase';
import { logOutcome } from './src/lib/log';
import { heartbeatFields, registerClassroom } from './src/lib/observability';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
// One line every five minutes saying the process is alive and how busy the classroom is (launch checklist 3.8, docs/OBSERVABILITY.md).
const HEARTBEAT_MS = 5 * 60 * 1000;

// Read port from -p arg or PORT env var, default 3000
let port = 3000;
const pIndex = process.argv.indexOf('-p');
if (pIndex !== -1 && process.argv[pIndex + 1]) {
  port = parseInt(process.argv[pIndex + 1], 10);
} else if (process.env.PORT) {
  port = parseInt(process.env.PORT, 10);
}

// Development only, and only when asked for (npm run dev:supabase): point the site at the local Supabase stack, before Next starts.
if (dev) {
  const local = applyLocalSupabaseEnv();
  if (local.message) console.log(local.message);
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function startServer() {
  await app.prepare();

  let realtime: ReturnType<typeof createSignallingServer>; // eslint-disable-line prefer-const -- assigned once below, but read inside the http.createServer callback defined before that assignment runs

  // Create Node HTTP server
  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url || '/', true);
    const pathname = parsedUrl.pathname || '';

    // Route /health or /api/turn-credentials to realtime Express app
    if (pathname === '/health' || pathname.startsWith('/api/turn-credentials')) {
      realtime.app(req, res);
      return;
    }

    // All other HTTP requests are handled by Next.js
    handle(req, res, parsedUrl);
  });

  // Attach signalling server to the HTTP server
  realtime = createSignallingServer({
    httpServer: server,
    disconnectGraceMs: process.env.DISCONNECT_GRACE_MS ? Number(process.env.DISCONNECT_GRACE_MS) : undefined,
  });

  // The readiness check (/api/health/ready) looks for this: a plain `next start` would serve the site with no classroom at all.
  registerClassroom({ media: realtime.media.mode, maxStudents: realtime.media.maxStudents, stats: realtime.stats });

  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();
  const heartbeat = setInterval(() => {
    logOutcome('server', 'heartbeat', heartbeatFields({
      uptimeSeconds: process.uptime(),
      memory: process.memoryUsage(),
      eventLoopDelayP99Ms: loopDelay.percentile(99) / 1e6,
      classroom: { media: realtime.media.mode, ...realtime.stats() },
    }));
    loopDelay.reset();
  }, HEARTBEAT_MS);
  heartbeat.unref();

  server.listen(port, () => {
    logOutcome('server', 'started', { mode: dev ? 'development' : 'production', media: realtime.media.mode, maxStudents: realtime.media.maxStudents });
    console.log(`> LearnThrive unified server ready on port ${port} (${dev ? 'development' : 'production'}: site, classroom signalling and TURN credentials on one origin)`);
    if (realtime.media.mode === 'sfu') console.log(`> Classroom media: Cloudflare SFU, up to ${realtime.media.maxStudents} students per lesson`);
    else console.warn(`> Classroom media: peer-to-peer mesh, at most ${realtime.media.maxStudents} students per lesson. Set CLOUDFLARE_SFU_APP_ID and CLOUDFLARE_SFU_APP_SECRET for the Cloudflare SFU (up to 10 students).`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    logOutcome('server', 'failed', { code: err.code ?? 'unknown' });
    console.error('Server error:', err);
    process.exit(1);
  });

  const shutdown = (signal: NodeJS.Signals) => {
    // A deploy or restart ends any lesson in progress (rooms are in memory): this line says how many it ended.
    logOutcome('server', 'stopping', { signal, ...realtime.stats() });
    clearInterval(heartbeat);
    loopDelay.disable();
    realtime.io.close(() => {
      server.close(() => {
        process.exit(0);
      });
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
