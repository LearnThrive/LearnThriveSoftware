# LearnThrive Meeting Hardening & Feature Expansion Plan

**Goal:** Harden the existing 1:1 WebRTC prototype's reliability, then extend it with screen share, chat, device switching and connection-quality diagnostics — in that priority order. Treat the current implementation as a release candidate; do not rebuild what already works.

**Spec:** ../specs/2026-09-16-hardening-brief.md (verbatim user brief, 56 sections) and ../specs/2026-09-16-meeting-design.md (original architecture).

**Baseline (2026-09-16):** lint/typecheck/9 unit tests/build/1 Playwright e2e all green at commit `d867e84`. Adversarial Claude-only review (Codex/Gemini unavailable — CLI/account version skew, disclosed) of server/signalling.ts, server/index.ts, src/peer.ts, src/meeting.ts, src/media.ts, shared/protocol.ts found **no must-fix security holes** (room isolation, session-pairing staleness rejection, and 2-participant capacity enforcement all verified solid against adversarial analysis) and two real should-fix lifecycle races, captured as Task 1 below.

## Constraints

All writes stay in D:\LearnThriveSoftware. No database, no authentication, no SFU/multi-party, no recording/transcription. Keep credentials out of source. Do not prioritise cosmetic work ahead of reliability. Only report a defect as fixed if reproduced via a failing test first.

## Tasks

- [x] 1. **Reconnection & room-lifecycle correctness** (spec §3,4,5,6,7,27). Fixed both review findings, failing-test-first:
  - Ghost-participant race: fixed via Socket.IO `connectionStateRecovery` (native, no new dependency) so a transient reconnect reuses the same `socket.id`/`socket.data`, plus a `disconnectGraceMs` grace period (default 10s, env-overridable) on `disconnect` that holds the slot and emits `room:participant-reconnecting`/`-reconnected` instead of immediately declaring a departure; only explicit `room:leave` stays immediate. A newcomer can still immediately displace a stale pending slot rather than waiting out the grace period. Refresh still behaves as a fresh join (no recovery session survives a reload).
  - Lost-offer race: `PeerSession.negotiate()`/`sendOffer()` in src/peer.ts now bounded-retries (3 attempts, 3s apart) if still `have-local-offer` with no answer.
  - Client states: `signalling` connected/disconnected/reconnecting, `peerReconnecting` (peer-facing subtle note), `reconnectFailed` (manual Reconnect button, via capped `reconnectionAttempts`+Manager `reconnect_failed`).
  - Regression tests: 3 new server integration tests (reconnecting-then-left ordering, real recovery via `engine.close()`, stale-slot eviction) + 1 new Playwright test (real network drop via `context.setOffline`) — all reproduced red-then-green.
- [x] 2. **ICE restart & negotiation correctness** (spec §6,7). `onconnectionstatechange` triggers `negotiate(true)` (offer with `iceRestart:true`) only for the deterministic initiator, capped at `MAX_ICE_RESTARTS`; reuses the same bounded-retry path as the initial offer, so only one side ever creates an offer. `classifyConnectionStatus` extracted to src/callStatus.ts as a pure, unit-tested helper (brief §39's own guidance against mocking the WebRTC stack).
- [ ] 3. **TURN support hardening** (spec §8). Support multiple ICE servers via env (comma-separated already partly done in src/ice.ts — verify/extend), document STUN-only vs TURN-enabled mode clearly in README.
- [ ] 4. **Screen sharing** (spec §9,10,11). `getDisplayMedia()` + `RTCRtpSender.replaceTrack()`, no second peer connection, dominant tile when active, native "Stop sharing" via track `ended`, camera state restored correctly (on if it was on, off if it was off), mobile feature-detected.
- [ ] 5. **In-meeting text chat** (spec §12,13,14). Ephemeral Socket.IO chat, server-validated (length, rate limit, room membership), plain-text rendering only, collapsible desktop panel / mobile sheet, unread badge.
- [ ] 6. **Device selection & switching** (spec §15,16,17). Pre-join enumerateDevices() selectors, in-call switching via replaceTrack() without teardown, devicechange handling, facingMode camera flip on mobile when multiple cameras exist.
- [ ] 7. **Connection quality monitoring & diagnostics** (spec §18,19,20,21). getStats() polling every 2-3s, Excellent/Good/Fair/Poor indicator with conservative thresholds, expanded ?debug=1 diagnostics (candidate type, host/srflx/relay, RTT, jitter, loss, bitrate), never expose jargon/IPs in normal UI.
- [ ] 8. **UX improvements** (spec §22-31). Permission-UX distinctions (denied/not-found/busy/unsupported/insecure), richer pre-join device test (live preview + mic level meter), autoplay-blocked "Click to enable audio", optional setSinkId output selection (feature-detected), meeting duration timer from connect time, subtle participant status messages, fullscreen + PiP (feature-detected), keyboard shortcuts (M/V/C/S, ignored while typing), control bar accommodating new controls with Leave visually distinct.
- [ ] 9. **Accessibility audit** (spec §32). All new controls keyboard-operable, aria-pressed on toggles, accessible device/chat menus, no colour-only status, reduced-motion support, screen-reader status updates that aren't noisy.
- [ ] 10. **Mobile & orientation** (spec §33,34). Verify 360/390/430px, orientation change handling, chat/device menus don't break layout.
- [ ] 11. **Browser compatibility feature-detection pass** (spec §36). Confirm every new API (screen share, setSinkId, PiP, fullscreen) is feature-detected and gracefully hidden when unsupported.
- [ ] 12. **Automated regression coverage expansion** (spec §37,38,39). Playwright: room behaviour, controls, chat, screen share (or documented as manual if automation is unreliable), reconnection if feasible without flakiness. Server tests for every hardening item in Task 1 plus chat validation/rate-limit. Extract pure lifecycle/quality-classification helpers for unit tests where practical.
- [ ] 13. **Error boundary, structured logging, memory-leak audit, performance** (spec §40-43). React error boundary with recoverable screen; categorized dev logging (signalling/media/peer/ice/chat/devices) replacing scattered console.log; audit every listener/track/timer/interval/RTCPeerConnection is cleaned up on leave/departure/unmount/reconnect/refresh; throttle stats-driven rerenders.
- [ ] 14. **Documentation** (spec §48,49,50,54). README architecture + Mermaid diagram + full feature list + browser support + debug mode + limitations; TESTING.md as a real test matrix (browser × device columns, honestly marked); PRODUCTION_GAPS.md; exact Cloudflare Quick Tunnel two-device test instructions.
- [ ] 15. **Final adversarial security review, manual visual review, final verification, final report** (spec §51,52,53,56). Re-run the full verification suite, visually inspect every new state in the browser, write the evidence-based final report (baseline, bugs actually found/fixed with regression tests, features added, security review, test results, browsers/viewports genuinely inspected, two-device test status, remaining PRODUCTION_GAPS summary).

## Verification commands

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser`.

## Explicit stop conditions (spec §44-47,55)

No database, no authentication, no SFU/multi-party video, no recording/transcription/AI notes, no dashboards/scheduling/attendance/payments/homework/accounts/whiteboard. Chat stays ephemeral (memory-only, cleared on room empty).
