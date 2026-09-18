# Production Gaps

This document lists what stands between this prototype and real use with LearnThrive students, parents and tutors. **Nothing here is implemented in this task, and nothing here should be inferred as "in progress" — these are gaps, not a roadmap commitment.**

## Identity and access

- **Authentication.** There is none. A display name is a self-declared string with no verification.
- **Parent/student/tutor identity.** A `role` (tutor/student) exists now, but it's entirely self-declared by the client and validated only against the two capacity rules (one tutor, up to three students) — the server has no way to confirm the person claiming "tutor" is actually the tutor. No accounts, no verified identity, no concept of a specific parent/student pairing.
- **Scheduled lesson authorisation.** Anyone with a room code can join at any time; there is no link between a room and a specific booked lesson, time window, or pair of people.
- **Expiring room credentials.** Room codes are permanent for the lifetime of the (in-memory) server process. Production needs server-issued, time-limited, single-lesson credentials rather than a bearer code.
- **Room authorisation.** The server enforces the 1-tutor/3-student capacity and room isolation (verified by an adversarial review, twice, during this build), but it does not enforce *who* is allowed to claim the tutor seat or any given student seat — anyone with the room link can currently claim whichever role their client declares, subject only to the capacity rules.

## Infrastructure

- **Production signalling hosting.** The signalling server runs as a local dev process (`tsx watch`) on loopback. Production needs a hosted, supervised, horizontally-scalable deployment with a real process manager and restart policy.
- **Managed TURN — architecture built, not yet proven against a real account.** The server-side Cloudflare Realtime TURN credential-generation endpoint (`GET /api/turn-credentials`, short-lived per-session credentials, the long-lived key/token pair never reaching the browser), the client's fetch/cache/refresh/STUN-fallback logic, and `?forceTurn=1` forced-relay debug mode are all implemented — see [TURN_TESTING.md](TURN_TESTING.md). What's still missing: this build has no actual Cloudflare Realtime TURN key, so the happy path (a real relay call, confirmed via `?forceTurn=1`) has never been exercised, only the "not configured" 503 fallback (which does have an automated test). A working relay call, and TURN across a genuinely different network (not just a tunnel), are both still required before this is production-ready — see TURN_TESTING.md's status note and TESTING.md's physical/different-network rows.
- **SFU migration (Cloudflare Realtime).** Media currently travels over a direct P2P mesh — each participant uploads directly to every other one (up to 3 simultaneous outgoing streams at the 4-person maximum). A Cloudflare Realtime SFU is the intended target architecture (controlled per-client upload, easier multi-party screen sharing, centrally-managed quality) but needs a real Cloudflare account and app credentials that this build doesn't have, so it hasn't been attempted. See [README.md's Architecture section](README.md#architecture) for the reasoning and the exact mesh design this is standing in for.
- **Production HTTPS/domain.** Local development uses `localhost`/loopback, or a temporary Cloudflare Quick Tunnel for manual two-device testing. Neither is a production origin, certificate, or domain strategy.
- **Availability monitoring.** Nothing watches whether the signalling server is up, degraded, or leaking memory over time.
- **Backups / config recovery.** There is no persistent state to back up today (rooms and chat are intentionally in-memory and ephemeral), but as soon as any persistent identity/scheduling data is added, it will need a real backup and recovery plan.

## Abuse and safety

- **Abuse controls.** Beyond input validation and room-membership scoping, there are no controls against a participant behaving badly once inside a room (no reporting, no blocking, no moderation beyond the tutor moderation tools described in [CLASSROOM_FEATURES.md](CLASSROOM_FEATURES.md)).
- **Force-mute and stop-share are directives, not real enforcement.** The architecture is a pure P2P mesh — the signalling server never touches media, so it has no way to actually silence a track. "The tutor muted you" and "the tutor stopped your share" are instructions the target's own client complies with voluntarily (the same code path its own mute/stop-share button uses). A modified or hostile client could ignore either directive entirely and keep transmitting. Real enforcement would need an SFU or media relay the server controls, which is exactly the migration described below.
- **Production rate limits.** The chat rate limiter is a lightweight, per-connection anti-spam measure (documented in README.md's Current Limitations), not a production-grade control — it resets on reconnect and isn't tied to any durable identity. Signalling events (offers/answers/ICE/media/screen-share) have no rate limiting at all beyond the transport-level message size cap. Production needs abuse-resistant limits tied to authenticated identity, not just a live socket id.
- **Safeguarding integration.** For a platform used by students (potentially minors), there is no safeguarding policy integration: no recording-for-safety option, no supervisory visibility, no incident reporting path. This is a policy and product decision, not just an engineering one, and needs to happen before real lessons run through this or any successor system.
- **Data protection review.** No formal review of what data is collected (currently: transient display names and ephemeral chat text, nothing persisted) against applicable data protection requirements (e.g., UK GDPR, given the target audience).
- **Legal review before handling live students.** Beyond data protection specifically, a full legal/compliance review is needed before any real tutoring session runs through this system — this covers safeguarding obligations, terms of service, consent, and liability, none of which this prototype addresses.

## Observability

- **Observability.** No structured production logging, metrics, tracing, or alerting exists beyond categorised `console.*` output intended for a developer's own browser devtools during local testing. Production needs centralised logs, connection-quality metrics aggregated across real sessions, and alerting on signalling-server health.

## Browser/device coverage

- **Final Safari/iOS testing.** This prototype was built and automated-tested on Windows (Chrome and Firefox via Playwright). Safari and iOS Safari have not been tested at all — see [BROWSER_SUPPORT.md](BROWSER_SUPPORT.md) for the full consolidated matrix and [TESTING.md](TESTING.md)'s test matrix. Given LearnThrive students plausibly join from iPhones/iPads, this is a real gap to close before considering any wider trial, not just a formality.
- **Screen-share audio has not been verified with real hardware.** The mixing logic (Web Audio, mic + tab/system audio) is implemented and typechecked, but there is no automated harness for real screen capture, and no human has yet confirmed the mixed audio is actually audible and correctly balanced on the receiving end. See [LAPTOP_PHONE_TEST.md](LAPTOP_PHONE_TEST.md).
- **Frontend bundle size grew substantially with the whiteboard.** `@excalidraw/excalidraw` pulls in its own dependency tree (including optional diagram/chart/math-rendering support this app never uses) — the production build now exceeds Vite's 500KB chunk-size warning threshold on its largest chunks. Not yet addressed: `manualChunks`/code-splitting so the whiteboard bundle only loads when Board mode is actually opened, rather than as part of the initial page load.
- **Whiteboard page rename has no keyboard-only path.** Renaming a page tab requires a double-click; there's no visible button or keyboard shortcut equivalent yet. See [WHITEBOARD_ARCHITECTURE.md](WHITEBOARD_ARCHITECTURE.md).
- **No formal accessibility audit of the newest UI** (whiteboard toolbar/page tabs, Class controls' poll/timer/announcement forms, the Help Queue). Built following the same aria-label/keyboard-dismiss patterns already established and adversarially reviewed elsewhere in this app, but not independently re-audited with a screen reader or an automated tool (e.g. axe-core, not installed in this project).

## Considered but intentionally not built this pass

- **Background blur.** Investigated only, not implemented. A real virtual-background/blur feature needs either a browser-native API (no stable, widely-supported one exists for `getUserMedia` video across target browsers today) or a client-side segmentation model (e.g. MediaPipe Selfie Segmentation) run per frame — a real performance and bundle-size cost that needs its own evaluation, not something to bolt on inside an unrelated feature pass. Left for a dedicated future piece of work.
- **Draggable/corner-snapping local preview.** The local preview tile is currently fixed-position (bottom-right, per breakpoint). Making it draggable was explicitly optional in scope and was skipped to avoid adding drag-state complexity/risk to the tile component during a pass already carrying a critical negotiation fix.
- **Double-click-to-fullscreen on the main tile.** Explicitly optional; skipped because reliably distinguishing single-click (focus swap) from double-click (fullscreen) without any click-handling regressions would need its own careful testing pass. A dedicated fullscreen button already exists and works.
- **Friendly connection-detail popover on the quality pill.** Explicitly optional; skipped since the `?debug=1` panel already exposes RTT/jitter/loss/bitrate in full for anyone testing, and a second, simplified user-facing surface for the same data would duplicate it.

None of these block real use of the prototype as it stands; they're straightforward to pick up later.

## Classroom V2 — deferred to future initiatives

Capacity stays at 1 tutor + up to 3 students (4 total) for now — a corrected, deliberately smaller target than an earlier draft spec that assumed 10 students behind a Cloudflare Realtime SFU. At 4 participants a full P2P mesh is entirely reasonable (up to 6 edges), which is why the SFU migration below is still not attempted: its stated justification doesn't hold at this size. Room lock, waiting-room deny, tutor moderation, chat moderation, quick polls, Understanding Check, the collaborative whiteboard, Call/Board/Present workspace modes, tutor announcements, and the Help Queue are now all implemented — see [CLASSROOM_FEATURES.md](CLASSROOM_FEATURES.md) for the full feature matrix. What remains deferred, each needing its own dedicated spec and planning pass:

- **Cloudflare Realtime SFU migration** (see the Infrastructure section above for why it wasn't attempted this pass — note this is distinct from, and unaffected by, the newly-implemented Cloudflare *TURN* credential generation, a much smaller piece of the same platform).
- **Speaker view** as a named-in-passing layout mode beyond Focus/Side-by-side/Gallery/Present actually built.
- **Pin / Spotlight** as distinct concepts from the click-to-focus already built.
- **Data Saver / audio-only mode, and simulcast** beyond what a future SFU migration would need anyway.
- **Attendance tracking / class analytics.**
- **A Class Resources panel** (tutor-shared links/notes/files) and a **tutor-only local notes scratchpad** — both named in the source spec but not built this pass; deferred rather than half-built, since a resources panel in particular raises file-handling questions (see the file-serving caution in the source spec) worth their own design pass.
- **Persistent Student Status** (Ready/Working/Need help, beyond the existing Understanding Check and Help Queue) — the Help Queue was judged the higher-value subset of this idea and was built; the broader always-on status concept was left for later to avoid duplicating/confusing it with Understanding Check.

## What this prototype does establish

To be clear about what *is* already solid, so the gaps above are read in context: room isolation, session-pairing staleness rejection, the 1-tutor/3-student capacity and waiting-room enforcement, mesh-edge isolation (a signal on one edge cannot reach a third participant), and the chat/screen-share/device surface have all been through adversarial security review with no must-fix issues found. The reliability work (reconnection, negotiation correctness, leave/rejoin, a waiting student surviving a brief disconnect) has real regression tests, not just manual spot checks. The gap is specifically the *production* concerns above — identity, hosting, abuse-resistance at scale, and safety policy — not the core WebRTC/signalling architecture itself.
