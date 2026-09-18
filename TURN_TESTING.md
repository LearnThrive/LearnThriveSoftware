# TURN Testing

How to configure real Cloudflare Realtime TURN credentials for this prototype, and how to prove the relay path actually carries media rather than just being configured. See [README.md's TURN section](README.md#ice-and-optional-turn) for the architecture; this document is the step-by-step test procedure.

**Status of this document as written:** a real Cloudflare Realtime TURN key is now configured in this environment's `.env`, and the full happy path has been exercised end to end — see the real observed results in section 3 below. The backend endpoint (`GET /api/turn-credentials`) and the frontend consumption/fallback/`?forceTurn=1` logic are covered by automated tests for the "not configured" (503), "configured but rejected" (502), and rate-limited (429) paths — see section 4. **The different-network test in [TESTING.md](TESTING.md) is still required** — this environment has no second physical network to test against; a forced-relay call over loopback (both participants on the same machine, same network) is not the same test as a genuinely different network, even though it does prove the relay itself works. Do not mark the different-network row as done without actually performing it on two real networks.

## 1. Get a Cloudflare Realtime TURN key

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/) and open **Realtime** (or **Calls**) → **TURN**.
2. Create a TURN key. Cloudflare gives you a **Key ID** and an **API Token** — copy both immediately; the token is not shown again.
3. These two values are a server secret pair, not a per-call credential — the backend endpoint below uses them to *generate* short-lived, per-session ICE server credentials on demand. Never put them in a `VITE_`-prefixed variable or any browser-visible config.

## 2. Configure the server

Add both values to `.env` (create it from `.env.example` first if you don't have one):

```dotenv
CLOUDFLARE_TURN_KEY_ID=your-key-id
CLOUDFLARE_TURN_API_TOKEN=your-api-token
```

Restart `npm run dev` (or just the server half) so `tsx watch` picks up the new environment variables. Confirm the endpoint responds:

```powershell
curl http://127.0.0.1:5173/api/turn-credentials
```

- **200** with an `iceServers` object/array and a `ttlSeconds` — configured correctly.
- **503** `{"error":"TURN is not configured on this server."}` — the two env vars aren't set (this is also what happens on a fresh clone with no Cloudflare account, and is the expected STUN-only fallback state, not a bug).
- **502** — the two env vars are set but Cloudflare rejected the request (wrong/revoked key, expired token, etc.); check the server's terminal output for the logged error.
- **429** — you've requested credentials more than the per-minute rate limit (20/min) allows; this is a deliberate abuse guard, not a real-world concern for a 4-person classroom.

## 3. Prove the relay path actually works (`?forceTurn=1`)

Configuration alone doesn't prove TURN *works* — a relay entry can be present in `iceServers` and still fail (wrong credentials, a firewalled relay port, an expired token) while calls keep connecting fine via direct/STUN paths, silently hiding the problem. `?forceTurn=1` closes that gap by setting `iceTransportPolicy: 'relay'`, so a call can only succeed by actually using the relay — if TURN is broken, the call simply fails to connect, which is the point.

1. Open two participants on the *same* room, both with `?forceTurn=1` in the URL, e.g. `http://localhost:5173/meeting?forceTurn=1&debug=1&room=<code>`. Include `?debug=1` too, or append `&debug=1`.
2. Join both, admit the student, and wait for the connection to reach **Connected**. If it never connects, TURN isn't actually working — see Troubleshooting below.
3. Open the development diagnostics panel (bottom of the page) on both sides and confirm, per peer:
   - **Candidate path** reads **Relay (TURN)** — not Direct or Reflexive (STUN). This is only possible under `iceTransportPolicy: 'relay'`, so seeing anything else here (rather than a failed connection) would itself be a bug.
   - **RTT / Jitter** show real numbers, not `n/a`.
   - **Packets sent / received** are non-zero and increasing on repeated checks.
   - **Frames encoded / decoded** are non-zero and increasing — proof video is actually flowing through the relay, not just that signalling/ICE succeeded.
   - The remote tile shows live, moving video and (with real hardware) audible audio — the strongest proof of all, and one the diagnostics panel can't substitute for.
4. Repeat without `?forceTurn=1` and confirm the candidate path is normally Direct or Reflexive (STUN) on a typical network — establishing that the forced-relay run in step 3 was a genuine, non-trivial test, not just what would have happened anyway.

Record the actual result (pass/fail, and the observed candidate path) in [TESTING.md](TESTING.md)'s test matrix — don't mark this row passed without having actually run it.

### Actual observed results (this environment, real Cloudflare Realtime TURN key)

Performed via two automated Chromium contexts (Playwright, synthetic `--use-fake-device-for-media-stream` video/audio), both on `?forceTurn=1&debug=1`, both on the same machine/network (loopback — this proves the relay itself works, not a different-network path; see the status note above). Read directly from the development diagnostics panel after ~6 seconds connected:

| Metric | Tutor side (viewing Student) | Student side (viewing Tutor) |
| --- | --- | --- |
| Candidate path | **Relay (TURN)** (local relay, remote relay, udp) | **Relay (TURN)** (local relay, remote relay, udp) |
| RTT / Jitter | 19 ms / 3 ms | 20 ms / 2 ms |
| Bitrate | in 351 kbps / out 351 kbps | in 351 kbps / out 351 kbps |
| Bytes sent / received | 199,594 / 201,104 | 201,187 / 199,513 |
| Packets sent / received | 440 / 440 | 441 / 439 |
| Frames encoded / decoded | 90 / 91 | 91 / 90 |
| Remote video | 640×360 @ 20fps, live | 640×360 @ 20fps, live |
| Packet loss | 0 | 0 |

Both sides selected a genuine relay candidate pair (not host/srflx) and carried real, increasing frame/packet/byte counts — proof media actually flowed through Cloudflare's relay, not just that ICE completed. **Baseline (no `forceTurn`), same network:** candidate path was Direct (local host, remote host, udp) — confirming the forced-relay run above was a real, non-trivial test rather than what would have happened anyway.

**Still required, not covered by the above:** the same proof across two genuinely different networks (see [TESTING.md](TESTING.md) and section 8 of the different-network test), and with real hardware/camera rather than synthetic media.

### Failure-path proof (deliberately broken configuration)

Rather than editing the real `.env` (which would require re-entering the real secret afterward), the failure paths were proven with environment overrides scoped to individual automated tests in `server/signalling.test.ts`, run against the real Cloudflare endpoint:

- **Not configured (503):** both env vars unset — `GET /api/turn-credentials` returns `503 {"error":"TURN is not configured on this server."}` immediately, no network call made. Client (`src/ice.ts`) catches this, logs a dev-only warning, and falls back to STUN-only — never surfaces a raw error to the user.
- **Configured but rejected (502):** obviously-fake credentials (`not-a-real-key-id-...`) — a real network call to Cloudflare's endpoint, which rejected it (HTTP 404 from Cloudflare itself, for an unrecognized key ID). The server logs the real error server-side (`console.error`) and returns a clean `502 {"error":"Could not generate temporary TURN credentials."}` to the client — confirmed the response body never contains "cloudflare" or any part of Cloudflare's own error payload. Client falls back to STUN-only exactly as in the 503 case.
- **Rate-limited (429):** 21 rapid requests from the same client with configured-but-bogus credentials — the first 20 each reach Cloudflare and get a real 502; the 21st is rejected by the server's own rate limiter (20/min) before it would even attempt a 21st Cloudflare call, returning `429 {"error":"Too many TURN credential requests. Please slow down."}`.
- **Direct P2P still works when TURN is down:** the existing `?forceTurn=1` proof above is unaffected by any of this — a normal (non-forced) call with TURN unavailable still connects via STUN/host candidates, exactly as the "baseline" row in section 3 shows, since `getIceConfiguration()` always returns a valid STUN-only configuration when the Cloudflare cache is empty.

All three failure paths are permanent automated regression tests (`server/signalling.test.ts`), not one-off manual runs — they'll keep failing loudly if this behavior ever regresses. The real `.env` credentials were never modified, read into a test, or printed at any point; each test only ever set short-lived, obviously-fake override values on `process.env` for its own duration.

## 4. Credential refresh over a long session

Cloudflare TURN credentials are generated with a TTL (`TURN_CREDENTIAL_TTL_SECONDS` in `server/signalling.ts`, currently 4 hours). `src/ice.ts` refetches proactively — about 2 minutes before a cached credential set would expire — whenever a new peer connection is about to be created (a new participant joining, or a reconnect), not on a fixed timer. To test this without waiting 4 hours, temporarily lower `TURN_CREDENTIAL_TTL_SECONDS` in `server/signalling.ts` (e.g. to `120`) and `REFRESH_MARGIN_SECONDS` in `src/ice.ts` (e.g. to `30`), then watch the server terminal / a network tab for a second `/api/turn-credentials` request after the shortened TTL elapses and a new participant joins. Revert both before committing.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `?forceTurn=1` call never connects | TURN genuinely isn't working — wrong/expired Cloudflare credentials, a firewall blocking outbound UDP/TCP to the relay, or the key was revoked. Check the server terminal for a 502 from `/api/turn-credentials` first. |
| Candidate path is "Direct" or "Reflexive" even with `?forceTurn=1` | This shouldn't be possible — `iceTransportPolicy: 'relay'` should make a non-relay connection fail outright rather than succeed via another path. If you see this, something is wrong with how `getIceConfiguration()`'s `forceTurn` flag is being read; check the URL actually has `?forceTurn=1` (not `&forceTurn=1` with no leading `?`) and that `src/ice.ts` was actually rebuilt (hard-refresh). |
| `/api/turn-credentials` always 503 | `CLOUDFLARE_TURN_KEY_ID`/`CLOUDFLARE_TURN_API_TOKEN` aren't set in the environment the server process actually sees — confirm `.env` is in the project root and the dev server was restarted after editing it. |
| Works locally, not over a tunnel | Confirm the tunnel proxies `/api` as well as `/socket.io` — `vite.config.ts`'s dev proxy handles this automatically; a from-scratch production reverse proxy would need the same route added by hand. |
