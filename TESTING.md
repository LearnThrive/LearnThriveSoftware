# Testing LearnThrive Meetings

This document separates what has actually been run (automated, on this machine) from what still needs a human with real hardware. **Never mark a physical-device row as passed without actually performing it.** Passing synthetic-media browser tests does not prove a physical webcam/microphone works, that two browsers hear each other, or that a call crosses a real NAT/firewall.

For the exact laptop ↔ phone procedure, see [LAPTOP_PHONE_TEST.md](LAPTOP_PHONE_TEST.md).

## Automated verification record

Run from PowerShell in the project directory:

```powershell
cd D:\LearnThriveSoftware
npm install
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium firefox   # once, if not already installed
npm run test:browser
```

| Check | Result |
| --- | --- |
| ESLint | Pass |
| TypeScript | Pass |
| Unit/integration tests (Vitest) | Pass — 62/62 (server room/session/chat/screen-share/hand-raise/reaction/roles/waiting-room/mesh-edge/room-lock/moderation/poll/understanding-check/timer logic and dev-tunnel origin handling; client media-device races, connection-status/quality classifiers including the multi-peer aggregator, ICE config, media error messages, stats parsing) |
| Production frontend build | Pass |
| Browser tests (Playwright, Chromium) | Pass — 17/17 |
| Browser tests (Playwright, Firefox) | Pass — 17/17 |
| Browser tests (Playwright, WebKit/Safari) | Not run — no WebKit automation available on this Windows machine; see [Safari row](#test-matrix) below |

The 17 Playwright scenarios (run against both Chromium and Firefox, using each browser's fake-camera/microphone support so no physical hardware is involved): the original 8 — a tutor and one student connecting over WebRTC — including a direct assertion that remote video actually renders on both sides, not just that the connection reports "connected" — with mute/camera-off relayed live and a third joiner correctly landing in the waiting room undisturbed; a second student waiting and Admit All admitting everyone who fits; chat send/receive with an unread badge and a proof that `<img src=x onerror=alert(1)>` renders as inert plain text, never as markup; the tutor leaving and cleanly rejoining the same room as the tutor with no ghost participant; a real network drop (`context.setOffline`) recovering without a false departure notice, and chat still working afterwards; click-to-focus swapping the main tile, side-by-side layout, and the People panel showing both participants' roles and live state including a relayed hand-raise; emoji reactions relaying to the peer and expiring on their own; and the copied invite link using the page's actual current origin rather than any build-time value — plus 9 new classroom-moderation scenarios: waiting-room Deny and room lock rejecting a new joiner without disturbing existing participants; force-mute blocking a student's own unmute attempt until the tutor allows it again; remove-participant immediately disconnecting a student with no Rejoin option; chat message delete and clear-all propagating to both sides; a poll running end to end (create, vote, change vote, close, frozen results); an understanding check with live per-student responses visible only to the tutor; a class timer's start/pause/resume/stop reaching both sides; the `H` raise-hand shortcut; and a role badge appearing on a camera-off avatar tile. See [CLASSROOM_FEATURES.md](CLASSROOM_FEATURES.md) for what each feature does and who can do it. A 2nd-tutor-rejected scenario and the full 4-participant/6-edge mesh are deliberately covered server-side instead (`server/signalling.test.ts`) — the former isn't reachable through the real UI (there's no browser flow that ever declares role:'tutor' for an existing room), and the latter is cheaper and just as conclusive to prove without 4 real browser contexts. Real screen sharing (the happy path of actually capturing and displaying a screen) has no automated test for the same reason noted below — this also means the tutor's force-stop-share control and the screen-share-ownership rejection are proven server-side only, not through a real capture in Playwright.

**This pass added room lock, waiting-room Deny, tutor moderation (force-mute, mute-all, remove, lower-hand, screen-share/chat policy, screen-share ownership arbitration), chat moderation, quick polls, an Understanding Check, a class timer, and a distinct tutor-departure `room:ended` cascade**, while keeping capacity at 1 tutor + up to 3 students (4 max) — a Cloudflare Realtime SFU migration was considered and explicitly not attempted, since its justification doesn't hold at this size (see [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md#classroom-v2--deferred-to-future-initiatives)). A dedicated server-side reconnect-resync test proves a participant recovering a brief disconnect is resent any force-mute/settings/poll/understanding-check/timer state they missed while offline, not just told "reconnected."

**A real WebRTC negotiation bug was found and fixed in an earlier pass** — whichever participant joined second could never be seen by the other side, because Chrome doesn't reuse an answerer's pre-added transceivers when applying an offer. See [ASYMMETRIC_VIDEO_TEST.md](ASYMMETRIC_VIDEO_TEST.md) for the full explanation. It's covered by the automated remote-video assertion above; a fresh physical laptop ↔ phone retest (see [LAPTOP_PHONE_TEST.md](LAPTOP_PHONE_TEST.md)) is still needed to confirm it on real cameras and real hardware, since the automated test uses synthetic media.

**This pass raised capacity from a hard 2-participant cap to 1 tutor + up to 3 students (4 max)**, replacing the old one-session-per-room signalling model with a per-edge mesh (see [README.md's Architecture section](README.md#architecture)). A dedicated server-side test proves a 3-participant/3-edge mesh negotiates every edge independently and that a signal on one edge never reaches the third participant.

**Screen sharing has no automated browser test.** Headless Chromium has no real desktop to capture via `getDisplayMedia()`, so automating it would either not work or be flaky depending on the CI/dev machine — it's a manual test below instead (see [Test matrix](#test-matrix)). The underlying track-replacement mechanism (`RTCRtpSender.replaceTrack()`) is the same code path already exercised indirectly by the mute/camera-off Playwright assertions.

## Test matrix

Columns record what was **genuinely run**, not what should theoretically work. `✅` = passed, `❌` = failed (see Notes), `⬜ Not yet tested` = no human has run this yet, `N/A` = not applicable to that row.

| Test | Chrome (Win) | Edge (Win) | Firefox (Win) | Safari | Same-device (2 tabs) | Laptop ↔ Laptop | Laptop ↔ Phone | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create room + join | ✅ automated | ⬜ Not yet tested¹ | ✅ automated | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Playwright: room code generated via `crypto.getRandomValues`, joins reach `room:joined` |
| Two-way video | ✅ automated (synthetic) | ⬜ | ✅ automated (synthetic) | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Synthetic tracks only prove negotiation, not a real camera image |
| Two-way audio | ⬜ Not yet tested² | ⬜ | ⬜ Not yet tested² | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Requires a human to actually hear the other side |
| Mute / unmute | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Playwright asserts the peer's UI updates live |
| Camera on/off | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Peer sees initials placeholder, not a black frame |
| Device switching (camera/mic) | ⬜ Not yet tested³ | ⬜ | ⬜ | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Needs 2+ real devices; race-condition logic unit-tested (see below) |
| Front/rear camera flip | N/A (desktop) | N/A | N/A | N/A | N/A | N/A | ⬜ Not yet tested | Only offered when `enumerateDevices()` reports 2+ cameras |
| Screen share (start/stop, peer sees it, native "Stop sharing") | ⬜ Not yet tested⁴ | ⬜ | ⬜ | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | N/A (mobile can't share OS screen) | Manual only — see note above |
| Chat send/receive + unread badge | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Includes the XSS-safe-render assertion |
| Leave / rejoin same room (as tutor) | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Regression test for a real ghost-participant bug found in an earlier pass |
| Student waits until tutor admits | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Every student waits, even if a seat is free — not just an overflow case |
| Admit / Admit all (partial capacity) | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Admits as many as fit and reports the remainder; also covered server-side for the exact 3-vs-4th-student boundary |
| Second tutor rejected | ✅ automated (server-side only) | ⬜ | ✅ automated (server-side only) | ⬜ | N/A | N/A | N/A | Not reachable through the real UI — see note above the matrix |
| 3-4 participant mesh (all edges negotiate, no cross-talk) | ✅ automated (server-side) | ⬜ | ✅ automated (server-side) | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Up to 6 simultaneous `RTCPeerConnection`s; server test proves edge isolation, browser tests exercise 2-3 participants live |
| Network drop / reconnect | ✅ automated | ⬜ | ✅ automated | ⬜ | N/A | ⬜ Not yet tested | ⬜ Not yet tested⁵ | `context.setOffline` in Playwright; real Wi-Fi toggle still needs a human |
| Refresh mid-call | ⬜ Not yet tested | ⬜ | ⬜ | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Should behave like the tested leave/rejoin path, not yet run via an actual page reload |
| TURN relay (vs. direct/STUN) | ⬜ Not yet tested⁶ | ⬜ | ⬜ | ⬜ | N/A | ⬜ Not yet tested | ⬜ Not yet tested | No TURN service is provisioned by this project; needs an external one to test against |
| Mobile portrait layout | N/A | N/A | N/A | ⬜ Not yet tested | N/A | N/A | ⬜ Not yet tested | Emulated 375x812/390x844 viewports visually inspected in-session (see Manual browser review below); real Android/iPhone not yet tested |
| Mobile landscape layout | N/A | N/A | N/A | ⬜ Not yet tested | N/A | N/A | ⬜ Not yet tested | Emulated 844x390 inspected and a real layout bug (controls below the fold at short heights) found and fixed this pass; real device not yet tested |
| Click-to-focus / Side-by-side layout | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Playwright asserts the main tile swaps and side-by-side renders both tiles as equal stage children |
| People panel (live mic/camera/hand state) | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | |
| Raise hand | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Relay + toast notice + panel state all asserted |
| Emoji reactions | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Rate-limiting covered server-side (`server/signalling.test.ts`), not re-tested at the UI layer |
| Invite link uses current origin (no `.env` edit) | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Asserts the copied link's origin matches `window.location.origin` |
| Asymmetric video (one side can't see the other) | ✅ automated (regression test) | ⬜ | ✅ automated (regression test) | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested — **was reproduced, then fixed, needs physical retest** | See [ASYMMETRIC_VIDEO_TEST.md](ASYMMETRIC_VIDEO_TEST.md) |
| Room lock + waiting-room Deny | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Locked room rejects a new joiner without disturbing existing participants |
| Force-mute / allow-unmute | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | A client-directive control — see [CLASSROOM_FEATURES.md](CLASSROOM_FEATURES.md) for the trust boundary |
| Remove participant | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Bypasses the disconnect grace period; no Rejoin option shown |
| Screen-share ownership + tutor force-stop | ✅ automated (server-side only) | ⬜ | ✅ automated (server-side only) | ⬜ | N/A | N/A | N/A | No automated real screen capture (see note above); ownership arbitration and the stop directive are proven server-side |
| Chat delete / clear (tutor) | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Pure relay — chat was never stored server-side |
| Quick poll (create, vote, change vote, close) | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Anonymous-voter visibility also covered server-side |
| Understanding Check | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Per-student privacy (no peer visibility) covered server-side |
| Class timer (start/pause/resume/stop) | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | No per-second network chatter — state transitions only |
| Tutor departure ends class for everyone (`room:ended`) | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | Reaches admitted participants and still-waiting students alike; server test also covers the lone-tutor case unchanged |
| Reconnect resync (missed moderation/poll/settings state) | ✅ automated (server-side only) | ⬜ | ✅ automated (server-side only) | ⬜ | N/A | N/A | N/A | A participant recovering a brief disconnect is resent full current state, not just told "reconnected" |
| Raise-hand `H` shortcut | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | |
| Role badge on camera-off tile | ✅ automated | ⬜ | ✅ automated | ⬜ | ⬜ Not yet tested | ⬜ Not yet tested | ⬜ Not yet tested | |

¹ Edge is Chromium-based and shares the rendering/WebRTC engine exercised by the Chrome results, but was not separately launched or verified.
² Playwright's fake audio devices produce synthetic tones, not real speech — this can only be confirmed by a human listening.
³ Device-switching's core race condition (a mute click landing while a switch is in flight) has a dedicated Vitest regression test (`src/media.test.ts`) using a fake `getUserMedia`/`MediaStream` harness; that proves the *logic* is correct, not that a real second physical camera/microphone works.
⁴ Manually verified in this session that the error path works (screen share correctly shows "Screen sharing was cancelled or blocked by your browser." when the capture API is unavailable, with no crash and no raw exception) — the *happy path* of actually sharing and the peer seeing it has not been performed with real hardware.
⁵ The reconnection *mechanism* (Socket.IO `connectionStateRecovery` + grace period) is proven by the automated network-drop test; a real phone switching Wi-Fi networks is a different, unverified scenario documented in [LAPTOP_PHONE_TEST.md](LAPTOP_PHONE_TEST.md).
⁶ See [README.md's TURN section](README.md#ice-and-optional-turn) for how to configure a TURN service to test against; none is provisioned here.

## Manual browser review performed this pass

Using the project's built-in browser tooling (not a substitute for real-device testing, but real Chromium rendering, not just automated assertions):

- Pre-join screen, device menu (including the graceful "No cameras found"/"No microphones found" empty state), and camera-preview placeholder — visually correct, on-brand.
- A live two-participant call: connection quality pill ("Connection: Excellent"), meeting timer counting up, chat panel opening/closing with correct focus behaviour, unread badge, and the screen-share permission-denial message — all confirmed rendering and behaving correctly.
- Mobile emulated viewports, portrait: 360x800 and 375x812. Pre-join, connected call (controls wrap to a second row without stray dividers — a real layout bug found and fixed in this pass), and the chat panel as a full-screen sheet takeover.
- A genuine `<img src=x onerror=alert(1)>` message typed into chat and sent between two real page instances: rendered as literal visible text, no image element created, no `alert()` fired (verified via a JS dialog listener in the equivalent Playwright test).

Also checked, landscape: 812×375 and 667×375, both single-row controls with no overflow.

Not yet inspected in this pass: 390px and 430px portrait specifically, and an actual rotation of a live viewport (portrait to landscape to portrait on the same page) rather than separate fixed-size loads.

## Test A — Same computer (two browser windows)

1. Start the application with `npm run dev`; this starts both Vite and the signalling server. Open `http://localhost:5173` in normal Chrome. Use `http://127.0.0.1:5173` if localhost does not resolve to the IPv4 listener, and keep the same origin in both windows.
2. Use headphones. Start with the second participant's microphone disabled if testing alone. Two browser sessions playing through the same speakers can produce feedback.
3. Create a meeting. Enter a temporary display name such as **Tutor**. In pre-join, allow camera/microphone access when prompted and confirm your own preview appears before joining. Try the device menu here if you have more than one camera/microphone.
4. Join the meeting. The page should wait for another participant, with your local preview still visible.
5. Choose **Copy Invite Link** and confirm temporary copy feedback. Paste the link into a new Chrome Incognito window or a second browser. An Incognito window is a separate participant; it may need fresh device permission.
6. Enter a different display name such as **Student**, prepare media and join. Confirm both names appear and the meeting progresses through connecting to a WebRTC-connected state.
7. Run the full [Controls and lifecycle checklist](#controls-and-lifecycle-checklist) below, including chat and screen sharing.

Some computers and drivers will not allow two browser sessions to use the same physical webcam. Close other camera applications, let one session join with camera disabled, or use two devices. Same-computer testing alone is poor evidence for two-way audible speech because of shared audio routing; complete Test B with two people and two devices for that check.

## Test B — Two physical devices with temporary HTTPS

See [LAPTOP_PHONE_TEST.md](LAPTOP_PHONE_TEST.md) for the exact step-by-step procedure. [Tailscale](https://tailscale.com/) (see [TAILSCALE_TESTING.md](TAILSCALE_TESTING.md)) is the recommended, repeatable option — a stable URL, no `.env` editing, and private to your own devices; Cloudflare Quick Tunnel remains documented as a fallback. In short:

```text
Browser -> HTTPS Quick Tunnel -> Vite 127.0.0.1:5173
                               -> /socket.io -> 127.0.0.1:3001
```

Only **one** public tunnel is required, because Socket.IO is proxied through Vite on the same origin. Camera/microphone access on a remote device needs a secure context (HTTPS); do not substitute a plain HTTP LAN address. There is no authentication: anyone with the tunnel URL and a room code can take an available seat, so treat it as a deliberate, temporary test, not something to leave running.

## Controls and lifecycle checklist

Run these checks from both participant positions where relevant. These are acceptance criteria, not claimed results — record actual outcomes in the matrix above.

| Action | Expected observation |
| --- | --- |
| Load an invite | The room code is filled in; pre-join is shown before entering the room |
| Allow devices in pre-join | Local camera preview works; mic level meter reacts to sound; microphone permission succeeds; no room joined yet |
| Join with camera and microphone disabled | The room remains usable; initials and disabled-media status explain the tile |
| Join participant B | Both see appropriate names; a "B joined" toast appears; connecting state changes only when WebRTC connects; the meeting timer starts only once actually connected |
| Mute A's microphone | A's control and B's participant status update; a "muted" toast appears for B; B cannot hear A |
| Unmute A | B can hear A again; no repeated full camera/microphone request for normal toggles |
| Turn A's camera off | B sees A's initials/placeholder rather than an unexplained black frame; a toast appears for B |
| Turn A's camera on | B sees live video again; microphone state is preserved |
| Switch A's camera/microphone mid-call | The call is not interrupted; mute/camera-enabled state is preserved across the switch |
| A shares their screen | B's main tile becomes A's screen (not cropped — letterboxed, not cover-cropped like a camera); a "presenting" badge is visible; a "started sharing" toast appears for B |
| A stops sharing (via in-app button) | B's tile returns to A's camera (or placeholder if it was off); a "stopped sharing" toast appears |
| A stops sharing via the browser's native "Stop sharing" bar | Same clean return to camera as the in-app button |
| A sends a chat message | B receives it live; an unread badge appears if B's chat panel is closed; opening it clears the badge |
| Copy invite | Temporary confirmation appears; pasted link has correct origin and room |
| A third participant joins | Lands in the waiting room, not the call; tutor sees a live waiting-room badge and can Admit them; existing call continues undisturbed until admitted |
| A second tutor attempts to join | Not reachable through the normal UI (see note above the test matrix); covered server-side instead |
| B leaves | B reaches an ended state; B's tracks and any screen share stop; A sees participant departure and retains local preview |
| Replacement B joins the same room | A and replacement B connect with fresh peer state; stale old media disappears |
| Refresh B during an active call | A detects departure; B returns through pre-join and can rejoin without a ghost participant |
| Close B's tab | A eventually detects disconnect; a new participant can occupy the freed seat |
| Briefly interrupt B's network (a few seconds) | A sees "B is reconnecting...", not an immediate false "left"; recovers automatically when B's network returns |
| A leaves last | A's tracks stop and room membership is cleaned up; no old remote stream remains |
| Repeat create/join/leave a few times | No accumulating remote tiles, duplicate audio, stale peer connection, or camera use after leave |
| Fullscreen toggle | Enters/exits fullscreen on the meeting stage; feature-detected, hidden if unsupported |
| Keyboard shortcuts (M/V/C/S) while not typing in a field | Toggle mute/camera/chat/screen-share respectively; do nothing while focus is in the name/room/chat input |
| `?debug=1` diagnostics | Shows room/socket/connection/ICE/candidate-type/RTT/jitter/loss/bitrate/device/screen-share state; never visible without the query flag |

For a network loss, disconnect detection can take the Socket.IO heartbeat timeout (or the configured grace period); an abruptly vanished participant need not disappear instantaneously.

## Permission and error checks

1. In a fresh browser profile or after resetting site permissions, deny both devices. Confirm a readable explanation appears and joining with both off remains available.
2. Deny only camera, then only microphone if the browser's permission UI allows this. Confirm the other permitted device can still be used.
3. Re-enable site permissions through the browser and retry media. Confirm the call can use the newly available device without breaking room membership.
4. Close other applications using the webcam, or deliberately open a conflicting application, to check the unavailable-device explanation where supported.
5. Test without a connected camera/microphone if practical. Confirm the UI explains the unavailable device and allows joining without it.
6. Unplug the selected camera/microphone mid-call (if you have a USB one) and confirm the app falls back to the default device with a message, rather than crashing.
7. Cancel the screen-share picker (click Cancel instead of choosing a source). Confirm a calm message appears, not a raw error.
8. Verify denied/insecure/unsupported contexts show user-facing guidance rather than raw stack traces.

Leaving should stop this app's media tracks, including any active screen share. Browser camera indicators can remain active if another page/application is using the same hardware.

## Layout and accessibility checks

Inspect pre-join, waiting, connected, chat-open, screen-sharing, and ended states at approximately **360, 390, 430, 768, 1024 and 1440 CSS pixels** wide, in both portrait and landscape where applicable.

- No horizontal page overflow or clipped participant names/control labels.
- Remote participant (or screen share) has the main area; the local tile stays usable on mobile.
- All call controls remain reachable without covering essential content; on narrow screens controls wrap to a second row rather than shrinking below a usable touch-target size.
- The chat panel does not make the video permanently unusable on a phone (it's a dismissible full-screen sheet there, not a fixed side panel).
- Tab reaches labelled inputs and buttons in a sensible order; focus is visible; closing the chat panel or device menu with Escape returns focus to the button that opened it.
- Microphone/camera/screen-share state is conveyed in accessible names/state (`aria-pressed`) and text/icons, not colour alone.
- Status announcements and chat messages use polite live regions and don't interrupt or spam.
- Long but valid participant names, room codes, and chat messages do not break layout.
- `prefers-reduced-motion` is respected (no transitions/animations forced on users who've disabled them at the OS level).

## Troubleshooting and diagnostics

Enable development diagnostics by opening `http://localhost:5173/?debug=1` or appending `&debug=1` after an existing room query. Inspect Socket.IO status, room, participant count, WebRTC/ICE/signalling state, candidate type (host/srflx/relay), RTT, jitter, packet loss, bitrate, frame rate/resolution, active camera/microphone, screen-share state, and reconnect state. Compare both participants' diagnostics; distinguish signalling connectivity from media connectivity.

| Symptom | Check |
| --- | --- |
| Cannot open local page | `npm run dev` is still running; ports 5173 and 3001 are free; try `127.0.0.1` for local IPv4 |
| Vite blocks tunnel hostname | Shouldn't happen for Quick Tunnel (`.trycloudflare.com`) or Tailscale (`.ts.net`) — both are auto-allowed, no `.env` edit needed. For a custom/named domain, set `TUNNEL_HOST` to the exact hostname (no scheme/path) and restart `npm run dev` |
| Tunnel origin error | Vite is listening on `127.0.0.1:5173`; cloudflared command targets that exact address |
| Quick Tunnel will not start | Follow the official Cloudflare troubleshooting notes; an existing `.cloudflared/config.yaml` can prevent Quick Tunnel mode |
| Permission request unavailable | HTTPS/localhost secure context, browser site permission, and OS camera/microphone privacy settings |
| Webcam works in only one window | Hardware/driver exclusivity; close other camera apps or use a second device |
| Both participants present but no call | Inspect WebRTC/ICE states in `?debug=1`; room membership alone is insufficient; try TURN for restrictive networks |
| One-way or silent audio | Remote autoplay action (an "Enable audio" button appears if autoplay was blocked), mute state, OS input/output selection, and headphones |
| Echo | Local video must remain muted; use headphones and avoid two speakers feeding nearby microphones |
| Screen share looks stretched/cropped | Shouldn't happen — the tile uses `object-fit: contain` while sharing; if it does, that's a bug |
| Old session briefly occupies a seat | Wait for disconnect detection, then retry joining; inspect server terminal for disconnect cleanup |

For TURN testing, use the optional variables in [README.md](README.md#ice-and-optional-turn), restart the app and repeat the exact failed network arrangement. A successful relay test must be recorded separately from STUN-only results. No TURN service is provisioned by this project.
