# TURN Testing

How to configure real Cloudflare Realtime TURN credentials for this prototype, and how to prove the relay path actually carries media rather than just being configured. See [README.md's TURN section](README.md#ice-and-optional-turn) for the architecture; this document is the step-by-step test procedure.

**Status of this document as written:** the backend endpoint (`GET /api/turn-credentials`) and the frontend consumption/fallback/`?forceTurn=1` logic are implemented and covered by an automated test for the "not configured" (503) path. **The happy path against a real Cloudflare account has not been exercised** — this build has no Cloudflare Realtime TURN key. Section 3 below (a real relay call) and the different-network test in [TESTING.md](TESTING.md) are still required before this is considered proven end-to-end. Do not mark those as done without actually performing them.

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

## 4. Credential refresh over a long session

Cloudflare TURN credentials are generated with a TTL (`TURN_CREDENTIAL_TTL_SECONDS` in `server/signalling.ts`, currently 4 hours). `src/ice.ts` refetches proactively — about 2 minutes before a cached credential set would expire — whenever a new peer connection is about to be created (a new participant joining, or a reconnect), not on a fixed timer. To test this without waiting 4 hours, temporarily lower `TURN_CREDENTIAL_TTL_SECONDS` in `server/signalling.ts` (e.g. to `120`) and `REFRESH_MARGIN_SECONDS` in `src/ice.ts` (e.g. to `30`), then watch the server terminal / a network tab for a second `/api/turn-credentials` request after the shortened TTL elapses and a new participant joins. Revert both before committing.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `?forceTurn=1` call never connects | TURN genuinely isn't working — wrong/expired Cloudflare credentials, a firewall blocking outbound UDP/TCP to the relay, or the key was revoked. Check the server terminal for a 502 from `/api/turn-credentials` first. |
| Candidate path is "Direct" or "Reflexive" even with `?forceTurn=1` | This shouldn't be possible — `iceTransportPolicy: 'relay'` should make a non-relay connection fail outright rather than succeed via another path. If you see this, something is wrong with how `getIceConfiguration()`'s `forceTurn` flag is being read; check the URL actually has `?forceTurn=1` (not `&forceTurn=1` with no leading `?`) and that `src/ice.ts` was actually rebuilt (hard-refresh). |
| `/api/turn-credentials` always 503 | `CLOUDFLARE_TURN_KEY_ID`/`CLOUDFLARE_TURN_API_TOKEN` aren't set in the environment the server process actually sees — confirm `.env` is in the project root and the dev server was restarted after editing it. |
| Works locally, not over a tunnel | Confirm the tunnel proxies `/api` as well as `/socket.io` — `vite.config.ts`'s dev proxy handles this automatically; a from-scratch production reverse proxy would need the same route added by hand. |
