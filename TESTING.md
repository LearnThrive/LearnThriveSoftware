# Testing LearnThrive Meetings

This document separates automated checks, manual same-computer hardware checks and manual calls between two physical devices. Passing synthetic-media browser tests does not prove a physical webcam/microphone works or that a call crosses real-world NAT/firewalls.

## Verification record

Record only checks actually performed. Automated checks below were run and recorded on 2026-09-16. Physical hardware and two-device checks still require a human tester and are not asserted here.

| Check | Recorded result |
| --- | --- |
| ESLint | Pass — `npm run lint`, 2026-09-16 |
| TypeScript | Pass — `npm run typecheck`, 2026-09-16 |
| Focused automated tests | Pass — 16/16, `npm test`, 2026-09-16 |
| Production frontend build | Pass — `npm run build`, 2026-09-16 |
| Same-machine synthetic-media browser checks | Pass — 2/2, `npm run test:browser` (Chromium, fake camera/mic), 2026-09-16. Covers real WebRTC negotiation and connection, mute/camera state relay to the peer, third-participant rejection, the leave/waiting lifecycle, and a real network-drop reconnection (`context.setOffline`) recovering without a false departure. |
| Physical camera preview and microphone permission | Not yet manually verified |
| Two physical devices, including audible two-way speech | Not yet manually verified |
| Temporary HTTPS tunnel | Instructions provided; no tunnel started |
| Restrictive network / TURN relay | Not yet manually verified |

For a manual run, record the date, both devices/operating systems/browsers, network arrangement, STUN/TURN mode, outcome and any symptoms. Keep room links and credentials out of shared test reports.

## Automated checks

From PowerShell in the project directory:

```powershell
cd D:\LearnThriveSoftware
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

Focused signalling tests exercise first/second joins, third-participant rejection, disconnect cleanup and isolation between unrelated rooms. Inspect the test output for the actual cases and counts.

For browser checks, install the matching Playwright Chromium if it is not already available, then run:

```powershell
npx playwright install chromium
npm run test:browser
```

These tests use browser-generated camera/audio tracks on one machine. They can verify negotiation, browser UI behaviour and media transport in that environment. They do not use or verify a human's webcam, microphone, hearing, device permissions, or two-device connectivity. Never describe their success as a physical two-device call.

## Test A — Same computer

1. Start the application with `npm run dev`; this starts both Vite and the signalling server. Open `http://localhost:5173` in normal Chrome. Use `http://127.0.0.1:5173` if localhost does not resolve to the IPv4 listener, and keep the same origin in both windows.
2. Use headphones. Start with the second participant's microphone disabled if testing alone. Two browser sessions playing through the same speakers can produce feedback.
3. Create a meeting. Enter a temporary display name such as **Tutor**. In pre-join, allow camera/microphone access when prompted and confirm your own preview appears before joining. Check the microphone and camera controls here.
4. Join the meeting. The page should wait for another participant, with your local preview still visible.
5. Choose **Copy Invite Link** and confirm temporary copy feedback. Paste the link into a new Chrome Incognito window or a second browser. An Incognito window is a separate participant; it may need fresh device permission.
6. Enter a different display name such as **Student**, prepare media and join. Confirm both names appear and the meeting progresses through connecting to a WebRTC-connected state. Both participants should see the other person's live video where enabled.
7. Perform the control/lifecycle checklist below.

Some computers and drivers will not allow two browser sessions to use the same physical webcam. Close other camera applications, let one session join with camera disabled or use two devices. A device-in-use error should be explained in the UI and should not prevent joining with devices off. Same-computer testing alone is poor evidence for two-way audible speech because of shared audio routing; complete Test B with two people for that check.

## Test B — Two physical devices with temporary HTTPS

This is a manual, temporary development exposure. The application remains on the Windows computer. No production deployment is needed. Cloudflare Quick Tunnels generate a public `trycloudflare.com` hostname for a local server and are intended for development/testing; they have no uptime guarantee. See [Cloudflare's official Quick Tunnel instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

1. Install `cloudflared` separately if you choose to run this test, using [Cloudflare's official download instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/). This project does not install it. Confirm `cloudflared --version` works in PowerShell.
2. In a first PowerShell window, start the tunnel and leave it running:

   ```powershell
   cloudflared tunnel --url http://127.0.0.1:5173
   ```

   Copy the generated HTTPS hostname printed by the command. It is normal for the URL not to serve the app until `npm run dev` is running. The hostname will be different for another tunnel session.

3. In `D:\LearnThriveSoftware`, create `.env` from `.env.example` only if it does not exist. Edit it to include your **exact generated hostname**, without `https://`, a port or a path:

   ```dotenv
   TUNNEL_HOST=your-actual-random-name.trycloudflare.com
   ```

   Replace the example with the hostname from your own terminal. Preserve any existing TURN values. Do not use `*`, `.trycloudflare.com` or `allowedHosts: true`; only this hostname should be allowed.

4. In a second PowerShell window, start both application processes with the usual single command:

   ```powershell
   cd D:\LearnThriveSoftware
   npm run dev
   ```

   If the app was already running, stop it with `Ctrl+C` and restart after editing `.env` so Vite reads `TUNNEL_HOST`.

5. Open the generated **HTTPS** URL in a normal browser on the host computer. Create a meeting and join as participant A. Camera/microphone permissions for this HTTPS origin are separate from localhost permissions.
6. While on that HTTPS page, choose **Copy Invite Link**. Check that the copied link starts with the generated HTTPS hostname and contains the room code. A link copied from localhost points to each recipient's own device and cannot be used for this test.
7. Open the HTTPS invite on the second physical device. Enter another name, allow camera/microphone access in pre-join and join. Use the browser directly, rather than an embedded browser inside a messaging application.
8. With headphones or sufficient physical separation, speak in both directions and confirm each person hears the other. Move in front of each camera and confirm both remote video feeds update. Run the checklist below. If the browser presents an audio playback action, activate it and repeat the hearing check.
9. First try both devices on the same Wi-Fi, then optionally use a different network (for example, mobile data). Record those as separate outcomes. STUN-only may work in one arrangement and fail in another. A page and signalling socket loading over HTTPS does not prove media connectivity.
10. Leave both calls. Stop the application and tunnel with `Ctrl+C` in their respective terminals when finished. A later Quick Tunnel session needs its new hostname copied into `.env`, followed by an application restart.

Only **one** public tunnel is required:

```text
Browser -> HTTPS Quick Tunnel -> Vite 127.0.0.1:5173
                               -> /socket.io -> 127.0.0.1:3001
```

Camera/microphone access on a remote device needs a secure context. Use HTTPS; do not substitute a plain HTTP LAN address. Localhost is a special development exception. See [MDN getUserMedia security requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security).

The tunnel carries application and signalling traffic. WebRTC media still needs a usable peer route or TURN relay. Anyone with the public URL can access the prototype, and anyone with a room code can take an available seat; there is no authentication.

## Controls and lifecycle checklist

Run these checks from both participant positions where relevant. The observations below are acceptance criteria, not claimed test results.

| Action | Expected observation |
| --- | --- |
| Load an invite | The room code is filled in; pre-join is shown before entering the room |
| Allow devices in pre-join | Local camera preview works; microphone permission succeeds; no room joined yet |
| Join with camera and microphone disabled | The room remains usable; initials and disabled-media status explain the tile |
| Join participant B | Both see appropriate names; connecting state changes only when WebRTC connects |
| Mute A's microphone | A's control and B's participant status update; B cannot hear A |
| Unmute A | B can hear A again; no repeated full camera/microphone request for normal toggles |
| Turn A's camera off | B sees A's initials/placeholder rather than an unexplained black frame |
| Turn A's camera on | B sees live video again; microphone state is preserved |
| Copy invite | Temporary confirmation appears; pasted link has correct origin and room |
| Join a third browser session | It sees **This meeting already has two participants.**; existing call continues |
| B leaves | B reaches an ended state; B's tracks stop; A sees participant departure and retains local preview |
| Replacement B joins the same room | A and replacement B connect with fresh peer state; stale old media disappears |
| Refresh B during an active call | A detects departure; B returns through pre-join and can rejoin without a ghost participant |
| Close B's tab | A eventually detects disconnect; a new participant can occupy the freed seat |
| Briefly interrupt B's network | Status reflects disruption/reconnection; it does not falsely retain an active media-connected label |
| A leaves last | A's tracks stop and room membership is cleaned up; no old remote stream remains |
| Repeat create/join/leave | No accumulating remote tiles, duplicate audio, stale peer connection or camera use after leave |

For a network loss, disconnect detection can take the Socket.IO heartbeat timeout; an abruptly vanished participant need not disappear instantaneously. Refresh/disconnect recovery may briefly require waiting for the old socket to be removed.

## Permission and error checks

1. In a fresh browser profile or after resetting site permissions, deny both devices. Confirm a readable explanation appears and joining with both off remains available.
2. Deny only camera, then only microphone if the browser's permission UI allows this. Confirm the other permitted device can still be used and status labels describe what is available.
3. Re-enable site permissions through the browser and retry media. Confirm the call can use the newly available device without breaking room membership.
4. Close other applications using the webcam, or deliberately open a conflicting application to check the unavailable-device explanation where supported.
5. Test without a connected camera/microphone if practical. Confirm the UI explains the unavailable device and allows joining without it.
6. Verify denied/insecure/unsupported contexts show user-facing guidance rather than raw stack traces. Do not bypass browser security flags to make a remote HTTP origin appear secure.

Leaving should stop this app's media tracks. Browser camera indicators can remain active if another page/application is using the same hardware.

## Layout and accessibility checks

Inspect pre-join, waiting, connected and ended states at approximately **390, 768, 1024 and 1440 CSS pixels** wide.

- No horizontal page overflow or clipped participant names/control labels.
- Remote participant has the main area; the local tile stays usable on mobile.
- All call controls remain reachable without covering essential content.
- Tab reaches labelled inputs and buttons in a sensible order; focus is visible.
- Microphone/camera state is conveyed in accessible names/state and text/icons, not colour alone.
- Status announcements explain connection changes without interrupting every small update.
- Long but valid participant names and room codes do not break layout.

## Troubleshooting and diagnostics

Enable development diagnostics by opening `http://localhost:5173/?debug=1` or appending `&debug=1` after an existing room query. Open the browser developer console. Inspect Socket.IO status, room, peer connection/ICE/signalling states and local/remote tracks. Compare both participants' diagnostics; distinguish signalling connectivity from media connectivity.

| Symptom | Check |
| --- | --- |
| Cannot open local page | `npm run dev` is still running; ports 5173 and 3001 are free; try `127.0.0.1` for local IPv4 |
| Vite blocks tunnel hostname | Exact `TUNNEL_HOST` has no scheme/path; restart `npm run dev`; tunnel hostname has not changed |
| Tunnel origin error | Vite is listening on `127.0.0.1:5173`; cloudflared command targets that exact address |
| Quick Tunnel will not start | Follow the official Cloudflare troubleshooting notes; an existing `.cloudflared/config.yaml` can prevent Quick Tunnel mode |
| Permission request unavailable | HTTPS/localhost secure context, browser site permission and operating-system camera/microphone privacy settings |
| Webcam works in only one window | Hardware/driver exclusivity; close other camera apps or use a second device |
| Both participants present but no call | Inspect WebRTC/ICE states; room membership alone is insufficient; try TURN for restrictive networks |
| One-way or silent audio | Remote autoplay action, mute state, browser output volume, OS input/output selection and headphones |
| Echo | Local video must remain muted; use headphones and avoid two speakers feeding nearby microphones |
| Old session briefly occupies a seat | Wait for disconnect detection, then retry joining; inspect server terminal for disconnect cleanup |

Cloudflare notes that an existing `.cloudflared/config.yaml` may need to be temporarily renamed for Quick Tunnels. Review that file's purpose before altering an existing setup and restore it afterwards; this project does not change it. See the [official Quick Tunnel caveat](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/#use-trycloudflare).

For TURN testing, use the optional variables in [README.md](README.md#ice-and-optional-turn), restart the app and repeat the exact failed network arrangement. Credentials are exposed to the browser, so use temporary credentials. A successful relay test must be recorded separately from STUN-only results. No TURN service is provisioned by this project.
