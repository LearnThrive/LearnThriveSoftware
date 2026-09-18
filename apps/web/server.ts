import http from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { createSignallingServer } from '@learnthrive/realtime/signalling';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';

// Read port from -p arg or PORT env var, default 3000
let port = 3000;
const pIndex = process.argv.indexOf('-p');
if (pIndex !== -1 && process.argv[pIndex + 1]) {
  port = parseInt(process.argv[pIndex + 1], 10);
} else if (process.env.PORT) {
  port = parseInt(process.env.PORT, 10);
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

  server.listen(port, () => {
    console.log(`> LearnThrive unified server ready on http://${hostname}:${port}`);
  });

  server.on('error', (err) => {
    console.error('Server error:', err);
    process.exit(1);
  });

  const shutdown = () => {
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
