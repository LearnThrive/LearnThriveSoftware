# LearnThrive Meeting Prototype

A separate, experimental one-to-one browser classroom for LearnThrive Tuition. React and native WebRTC provide camera, microphone and peer media; a small Express/Socket.IO server coordinates the two participants. This is a technical proof of concept, not a production tuition platform.

Everything lives in `D:\LearnThriveSoftware`. The marketing project at `D:\LearnThrive` is a read-only brand reference. Public logo assets were copied from its `public\brand` directory and its favicon into this project's `public\brand`; there are no runtime imports from the marketing project.

## Requirements

- Node.js **22.12 or later**, with npm. **Node 24 LTS** is recommended; see the [official Node release schedule](https://nodejs.org/en/about/previous-releases).
- A modern browser with WebRTC support, such as current Chrome, Edge, Firefox or Safari. Browser and hardware combinations still need manual verification.
- Camera/microphone permissions for participants who want to send media. Joining with both disabled is supported.
- Headphones for local testing.
- Optional `cloudflared` for a temporary HTTPS test on two physical devices. It is not needed for local testing and is not installed or started by this project.

## Install and start

In PowerShell:

```powershell
cd D:\LearnThriveSoftware
npm install
npm run dev
```

Open **http://localhost:5173**. If your system resolves localhost to an unavailable IPv6 address, use **http://127.0.0.1:5173** consistently in both browser sessions.

One `npm run dev` command starts Vite on loopback port **5173** and the signalling server on loopback port **3001**. Keep that terminal open. Press `Ctrl+C` to stop both. Ports are fixed so another application on either port should be stopped or reconfigured before starting this project.

Create a meeting, enter a display name, prepare your camera/microphone in the pre-join screen and join. Copy the invite link for the second participant, who can also enter the same room code. Opening an invite does not automatically enter the meeting.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend and signalling server together |
| `npm run lint` | Check TypeScript/React source with ESLint |
| `npm run typecheck` | Type-check without emitting files |
| `npm test` | Run focused automated tests |
| `npm run test:browser` | Run browser checks with synthetic media |
| `npm run build` | Type-check and build the production frontend into `dist` |

The frontend build does not start or package a production signalling service. Use `npm run dev` for the documented local experiments. See [TESTING.md](TESTING.md) for browser-test prerequisites, repeatable manual checks and the verification record.

## Architecture

```text
Browser A ---- offers / answers / ICE ---- Socket.IO ---- Browser B
    |                                  (signalling)          |
    +=============== WebRTC media ==========================+

Local HTTP / optional temporary HTTPS entry point
    -> Vite :5173
       -> /socket.io HTTP + WebSocket proxy -> Express/Socket.IO :3001
```

The browser Socket.IO client uses the current origin (`io()`), so the same room works locally and through one HTTPS tunnel. Browser-facing signalling configuration contains no hard-coded localhost URL.

The first participant waits. When the second joins, the first creates the offer and the second answers. ICE candidates received before a remote description are queued. A pair/session identifier prevents late messages from an old pairing being applied to a replacement participant. Audio and video transceivers allow a participant to join without devices and enable media later.

The server holds room membership in memory, limits each room to two sockets, validates input and forwards signalling only between participants in the same room. It cleans membership on leave/disconnect. It does **not** proxy, process or store audio/video. Media travels between the WebRTC peers, or through an optional TURN relay when a direct route cannot be established. WebRTC connection state and Socket.IO signalling state are separate; a connected socket alone does not mean a call is connected.

Normal mute/camera controls toggle the existing track's `enabled` state. Leaving stops local tracks, closes the peer connection and leaves the room. When only the other participant leaves, the local preview remains active and the room can accept a replacement.

## ICE and optional TURN

ICE configuration is centralised in the browser source. The default is Google's public STUN endpoint, `stun:stun.l.google.com:19302`.

**STUN-only calling works on many networks, but not all.** Some NAT/firewall combinations require a TURN relay. A working HTTPS tunnel provides application/signalling access; it does not solve WebRTC media traversal. Production LearnThrive calling needs a reliable TURN service. See the [WebRTC project's TURN guide](https://webrtc.org/getting-started/turn-server).

To test an existing TURN service, create `.env` from `.env.example` if you do not already have one:

```powershell
Copy-Item .env.example .env
```

Fill in the optional values locally, then restart `npm run dev`:

```dotenv
VITE_TURN_URL=turn:relay.example.com:3478,turns:relay.example.com:5349
VITE_TURN_USERNAME=temporary-test-username
VITE_TURN_CREDENTIAL=temporary-test-credential
```

These are placeholders, not an operational relay. Leave all three blank for STUN-only operation. `VITE_` values are exposed to browsers and included in frontend builds: they are **not server secrets**. Use short-lived, limited TURN credentials, keep actual credentials out of source control and do not place them in public assets. A production service should issue temporary credentials to authorised participants. This project does not provision, purchase or deploy TURN infrastructure.

## Two-person testing

**Same computer:** open the local URL in a normal Chrome window and Incognito, or a second browser. Join the same room with two different display names. Some camera drivers cannot share one physical webcam between sessions; one participant can join with camera disabled. Use headphones to avoid speaker/microphone feedback. This checks a local call, not a call across two networks.

**Two physical devices:** follow [Test B in TESTING.md](TESTING.md#test-b--two-physical-devices-with-temporary-https). It documents one optional Cloudflare Quick Tunnel forwarding to Vite, with its exact generated hostname in `.env` as `TUNNEL_HOST`. Open the HTTPS page on both devices and copy the invite from that page so it contains the public HTTPS origin. No production deployment is required.

Camera/microphone access requires a secure context. Localhost is accepted for local development; an ordinary `http://192.168...` LAN URL is not the supported mobile test path. See [MDN's getUserMedia requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security).

The project binds to loopback and allows only the explicitly configured tunnel hostname in addition to Vite's local defaults. Do not replace this with `allowedHosts: true` or a blanket `.trycloudflare.com` entry. Vite recommends an explicit host list; see [Vite server options](https://vite.dev/config/server-options#server-allowedhosts).

## Access and current limitations

- Exactly two participants; no group conferencing.
- No authentication, identity verification, authorised invitations or meeting expiry. Possession of a room link/code is effectively bearer access to a free seat; display names are self-declared.
- A public development tunnel exposes this prototype to anyone who has its URL. Share only for a deliberate test and stop the tunnel afterwards. The random URL is not authentication.
- In-memory rooms only. Restarting the signalling process loses membership; there is no database or saved attendance.
- STUN-only by default; restrictive networks may require TURN.
- No scheduling, dashboards, payments, homework or platform integration.
- No screen sharing, chat, file sharing or whiteboard.
- No recording, screenshots, automatic transcription or AI notes. Sessions are not recorded by this application.
- Camera/microphone device selectors are deferred. The browser/operating system default devices are used; dedicated selectors and sender `replaceTrack()` switching can be added next.
- Hardware, permission prompts, mobile autoplay and network traversal require manual testing; synthetic browser media cannot establish those facts.
- Prototype only; not production-ready. Validation and room isolation do not replace authentication or access control.

Production work would require authenticated LearnThrive accounts, authorised room access, server-issued meeting credentials, meeting expiry and stronger access controls, alongside reliable TURN infrastructure and operational monitoring.

## Future roadmap

Possible later iterations include temporary TURN credentials; authenticated parent/student/tutor access; scheduled lesson rooms; device selection; screen sharing; whiteboard; chat; attendance; and connection-quality monitoring. These features are intentionally outside this prototype. Any future recording capability would need an explicit product/policy decision; recording is not enabled here.

## Diagnostics and verification

Append `?debug=1` to the landing URL, or `&debug=1` to a URL that already contains `?room=...`, and open the browser developer console. Development diagnostics distinguish signalling, peer connection, ICE and track state. Keep diagnostics off in the ordinary meeting flow, and avoid sharing logs containing participant or network details publicly.

Follow the checklists and record actual outcomes in [TESTING.md](TESTING.md). Automated same-machine synthetic-media results, physical camera/microphone checks and two-device calls must be reported separately.
