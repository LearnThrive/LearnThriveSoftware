#!/usr/bin/env node
/**
 * The experiment's own server, on its own port. LearnThrive AI is not involved: this process reads no file from
 * apps/, opens no route of the app's, and touches no shared state.
 *
 * What it does:
 *   GET  /               the standalone test page (public/)
 *   GET  /api/config     what this page is connected to, so the screen can say it honestly (never the key)
 *   GET  /api/probe      tries the upstream handshake once and reports exactly what happened — the blocker evidence
 *   WS   /api/realtime   the browser's socket; the server opens the real one, with the key in an Authorization header
 *
 * The key stays here. The browser is never sent it, it is never logged, and it is never put in a URL unless the
 * operator explicitly chose NV_AUTH_STYLE=query for an endpoint that documents it.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attach, connect } from "./lib/ws.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A tiny .env reader, so the experiment needs no dependency to read its own (git-ignored) settings file. */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

const fileEnv = readEnvFile(path.join(HERE, ".env"));
const env = { ...fileEnv, ...process.env }; // the shell wins, so a one-off run needs no file edit
const PORT = Number(env.NV_PORT ?? 3999);
const UPSTREAM = env.NV_REALTIME_URL ?? "ws://127.0.0.1:8080/v1/realtime";
const AUTH_STYLE = (env.NV_AUTH_STYLE ?? "header").toLowerCase();
const INPUT_RATE = Number(env.NV_INPUT_RATE ?? 24000);
const OUTPUT_RATE = Number(env.NV_OUTPUT_RATE ?? 24000);
const KEY = (env.NVIDIA_API_KEY ?? "").trim();

/** Where the socket points, without any credential that a careless URL might carry. */
const safeUpstream = () => {
  try {
    const url = new URL(UPSTREAM);
    url.search = "";
    return url.toString();
  } catch {
    return "(not a valid URL)";
  }
};

/** Which of the three routes this run is on, so the page can label itself and nobody mistakes the stand-in for the model. */
const flavour = () => {
  let url;
  try {
    url = new URL(UPSTREAM);
  } catch {
    return "invalid";
  }
  if (url.port === "8080" || /realtime$/.test(url.pathname)) {
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return "local-or-standin";
  }
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" ? "local-or-standin" : "remote";
};

/** The upstream socket with authentication applied the way the operator configured it. */
async function connectUpstream() {
  const headers = {};
  let url = UPSTREAM;
  if (AUTH_STYLE === "header" && KEY) headers.Authorization = `Bearer ${KEY}`;
  if (AUTH_STYLE === "query" && KEY) {
    const parsed = new URL(url);
    parsed.searchParams.set("api_key", KEY);
    url = parsed.toString();
  }
  return connect(url, { headers, timeoutMs: 8000 });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const json = (res, status, body) => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/config") {
    json(res, 200, {
      app: "LearnThrive Nemotron VoiceChat experiment (isolated)",
      flavour: flavour(),
      upstream: safeUpstream(),
      upstreamIsLoopback: /^wss?:\/\/(127\.0\.0\.1|localhost)/.test(UPSTREAM),
      authStyle: AUTH_STYLE,
      keyPresent: KEY.length > 0,
      keyLength: KEY.length, // enough to tell "not set" from "set", never enough to use it
      inputRate: INPUT_RATE,
      outputRate: OUTPUT_RATE,
      packetMs: 80,
      labels: {
        "local-or-standin": "Connected to a LOCAL endpoint on this machine (NVIDIA's documented local runtime, or the synthetic stand-in). Timings describe this machine, not a hosted model.",
        remote: "Pointing at a REMOTE endpoint. NVIDIA has not documented a hosted VoiceChat realtime URL; see docs/ACCESS_RESEARCH.md before trusting this.",
        invalid: "NV_REALTIME_URL is not a valid WebSocket URL.",
      }[flavour()],
    });
    return;
  }

  if (url.pathname === "/api/probe") {
    const started = Date.now();
    connectUpstream()
      .then((conn) => {
        const events = [];
        const timer = setTimeout(() => {
          conn.close(1000);
          json(res, 200, { ok: true, ms: Date.now() - started, events, note: "the handshake completed; no audio was sent" });
        }, 1200);
        conn.on("message", (data, isBinary) => {
          if (isBinary) return;
          try {
            events.push(JSON.parse(data).type);
          } catch {
            events.push("(unparsable)");
          }
        });
        conn.on("close", () => {
          clearTimeout(timer);
          if (!res.writableEnded) json(res, 200, { ok: true, ms: Date.now() - started, events, note: "the handshake completed; the endpoint then closed" });
        });
      })
      .catch((error) => json(res, 200, { ok: false, ms: Date.now() - started, error: String(error.message ?? error), upstream: safeUpstream() }));
    return;
  }

  if (url.pathname === "/api/realtime") {
    res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Upgrade required: this path is a WebSocket.\n");
    return;
  }

  // Static files, from public/ only, with no path escaping it.
  const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const file = path.join(HERE, "public", relative);
  if (!file.startsWith(path.join(HERE, "public"))) {
    res.writeHead(403).end("Forbidden\n");
    return;
  }
  fs.readFile(file, (error, body) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found\n");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  });
});

let connections = 0;

attach(server, ["/api/realtime"], async (browser, req) => {
  const id = ++connections;
  const log = (line) => console.log(`[experiment ${id}] ${line}`);
  log(`browser connected; opening ${safeUpstream()} (auth: ${AUTH_STYLE}${KEY ? ", key present" : ", no key"})`);

  let upstream;
  try {
    upstream = await connectUpstream();
  } catch (error) {
    const detail = String(error.message ?? error);
    log(`BLOCKED: could not reach the upstream socket — ${detail}`);
    browser.sendJson({
      type: "experiment.error",
      code: "upstream_unreachable",
      detail,
      upstream: safeUpstream(),
      hint:
        "No audio was sent. Start the stand-in (`npm run mock`) or NVIDIA's documented local runtime (`nemo-speech serve`), or set NV_REALTIME_URL. There is no confirmed NVIDIA-hosted VoiceChat URL to fall back to.",
    });
    browser.close(1011);
    return;
  }

  log("upstream open");
  const counters = { toUpstream: 0, fromUpstream: 0, bytesUp: 0, bytesDown: 0 };
  let closed = false;
  const finish = (why) => {
    if (closed) return;
    closed = true;
    log(`closed (${why}); frames up ${counters.toUpstream} (${counters.bytesUp} B), down ${counters.fromUpstream} (${counters.bytesDown} B)`);
    try {
      browser.close(1000);
    } catch {
      /* gone */
    }
    try {
      upstream.close(1000);
    } catch {
      /* gone */
    }
  };

  browser.on("message", (data, isBinary) => {
    counters.toUpstream += 1;
    counters.bytesUp += isBinary ? data.length : Buffer.byteLength(data);
    // The only thing ever written to the log about traffic is its type: no audio, no transcripts, no key.
    if (!isBinary) {
      try {
        const type = JSON.parse(data).type;
        if (type !== "input_audio_buffer.append") log(`→ ${type}`);
      } catch {
        /* not JSON: forwarded as-is */
      }
    }
    upstream.send(data);
  });
  upstream.on("message", (data, isBinary) => {
    counters.fromUpstream += 1;
    counters.bytesDown += isBinary ? data.length : Buffer.byteLength(data);
    browser.send(data);
  });
  browser.on("close", () => finish("the browser closed"));
  upstream.on("close", () => {
    if (!browser.closed) {
      browser.sendJson({ type: "experiment.error", code: "upstream_closed", detail: "the upstream socket closed during the session", upstream: safeUpstream() });
    }
    finish("the upstream closed");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[experiment] http://127.0.0.1:${PORT}  (upstream ${safeUpstream()}, auth ${AUTH_STYLE}${KEY ? ", key present" : ", no key"})`);
  console.log(`[experiment] Isolated from LearnThrive AI: no app file is touched and nothing is written outside this folder.`);
  if (flavour() === "remote") console.log(`[experiment] NOTE: the upstream is remote. No NVIDIA-hosted VoiceChat URL is documented; see docs/ACCESS_RESEARCH.md.`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
