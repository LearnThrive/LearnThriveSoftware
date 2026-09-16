
Create a completely separate experimental project at:

`D:\LearnThriveSoftware`

This is a prototype for a future LearnThrive Tuition online-classroom/meeting system.

Do NOT modify:

`D:\LearnThrive`

The existing LearnThrive marketing website may be inspected **read-only** so that this prototype can visually match the brand.

The goal is to build and test a genuine browser-based **1-to-1 video call** between two people without deploying the application.

---

# 1. Objective

Build a basic but polished meeting page where two people can:

1. Open the application.
2. Enter the same meeting room.
3. Allow camera and microphone access.
4. See themselves.
5. See and hear the other participant.
6. Mute/unmute their microphone.
7. Turn their camera on/off.
8. Leave the call.
9. Copy/share the room link.
10. See clear connection and participant status.

This is a technical proof of concept.

Do NOT attempt to build the complete LearnThrive tuition platform.

---

# 2. Project Isolation

Create everything under:

`D:\LearnThriveSoftware`

Do not alter any file in:

`D:\LearnThrive`

You may inspect the existing LearnThrive project to understand:

* colours
* logo
* typography
* spacing
* button styles
* visual identity

If appropriate, COPY required public brand assets into the new project.

Do not create imports that depend directly on files inside `D:\LearnThrive`.

The prototype must run independently.

---

# 3. Recommended Stack

Use:

* React
* TypeScript
* Vite
* Node.js
* Express
* Socket.IO
* Socket.IO Client
* native browser WebRTC APIs

Do not use:

* Daily
* Zoom SDK
* Google Meet
* Microsoft Teams
* Jitsi
* Twilio Video
* Agora
* LiveKit
* Firebase
* Supabase

for the actual meeting functionality.

The point of this prototype is to prove that LearnThrive can establish its own WebRTC calls.

Do not add a database.

---

# 4. Architecture

Use the following architecture:

## Browser

React application responsible for:

* meeting UI
* camera/microphone access
* local video
* remote video
* WebRTC peer connection
* call controls

## Signalling Server

Small Node/Express + Socket.IO server responsible only for:

* joining rooms
* informing participants when another user joins
* exchanging WebRTC offers
* exchanging WebRTC answers
* exchanging ICE candidates
* informing the remaining participant when somebody leaves

The signalling server MUST NOT proxy or process video/audio streams.

Audio/video should flow directly between WebRTC peers.

---

# 5. Development Ports

Use something sensible such as:

Frontend:
`http://localhost:5173`

Signalling server:
`http://localhost:3001`

Configure Vite to proxy Socket.IO traffic to the signalling server so the browser can use the same origin.

For example, proxy:

`/socket.io`

to:

`http://localhost:3001`

with WebSocket support enabled.

The Socket.IO client should therefore connect using the current origin rather than containing a hard-coded localhost signalling URL.

This is important because later we will expose the frontend through a temporary HTTPS tunnel.

---

# 6. Development Script

Create one command that starts everything.

For example:

`npm run dev`

should start:

* Vite
* signalling server

Use `concurrently` or an equivalent lightweight mechanism.

Do not make me manually start five different processes.

Also provide:

`npm run build`

for the frontend.

And sensible lint/type-check commands.

---

# 7. Room System

Create a simple room system.

The landing route can be something like:

`/meeting`

or simply the application root.

Provide:

* display name field
* room code field

Allow:

**Create Meeting**

and:

**Join Meeting**

When creating a meeting, generate a reasonably random room ID using browser cryptographic randomness, not `Math.random()`.

Example URL:

`/meeting?room=3f4a8c72`

Once a meeting is created, provide:

**Copy Invite Link**

The other participant should be able to open that URL and join the same room.

There must be a maximum of:

**2 participants**

for this prototype.

If a third person attempts to join, show:

**This meeting already has two participants.**

Do not attempt multi-party conferencing.

---

# 8. Pre-Join Screen

Do not immediately enter the call.

Create a pre-join screen similar to professional meeting software.

Show:

* camera preview
* display name
* microphone toggle
* camera toggle
* room code
* Join Meeting button

Request camera/microphone permissions here.

If permission is denied, show a helpful message.

The user should still be able to join with:

* microphone disabled
* camera disabled

if desired.

---

# 9. Meeting Interface

Create a polished LearnThrive-branded meeting page.

Desktop layout:

* large remote participant area
* smaller local participant preview
* meeting information
* centred control bar

Mobile layout:

* remote participant fills most of screen
* local participant appears as a smaller overlay/tile
* controls remain reachable

Use the existing LearnThrive brand styling as inspiration.

The interface should feel like part of LearnThrive rather than a developer demo.

Do not over-design it.

---

# 10. Participant Tiles

Each participant tile should support:

* video stream
* participant name
* microphone status
* camera status

When the camera is disabled:

show a professional placeholder containing the participant's initials.

Do not display a black unexplained rectangle.

The local tile should clearly say something like:

`You`

where appropriate.

---

# 11. Meeting Controls

Create controls for:

### Microphone

Toggle the audio track's `enabled` state.

Do NOT reacquire the whole media stream every time mute changes.

### Camera

Toggle the video track's `enabled` state.

### Leave

Stop local tracks.

Close the RTCPeerConnection.

Leave the Socket.IO room.

Return the user to a sensible meeting-ended state.

### Copy Invite

Copy the meeting URL to the clipboard.

Show temporary confirmation such as:

`Invite link copied`

---

# 12. WebRTC Implementation

Use modern native browser APIs:

* `navigator.mediaDevices.getUserMedia`
* `RTCPeerConnection`
* `RTCSessionDescription` only where actually needed by modern APIs
* ICE candidates
* media tracks

Do not use deprecated `navigator.getUserMedia`.

Create one peer connection for the two-person call.

Implement the negotiation correctly.

Avoid both peers simultaneously becoming offer creators.

Use a deterministic initiator strategy.

For example:

* first participant waits
* when second participant joins, first participant creates the offer
* second participant receives offer and creates answer

Exchange ICE candidates through Socket.IO.

Queue ICE candidates if remote description has not yet been set.

Handle negotiation/state carefully rather than assuming everything arrives in a particular order.

---

# 13. ICE Configuration

For this prototype, configure WebRTC with a public STUN server.

Keep ICE configuration centralised.

For example:

```ts
iceServers: [
  {
    urls: "stun:stun.l.google.com:19302"
  }
]
```

Do NOT hard-code usernames/passwords.

Also support optional TURN configuration through environment variables for later testing.

For example:

* `VITE_TURN_URL`
* `VITE_TURN_USERNAME`
* `VITE_TURN_CREDENTIAL`

If these are absent, run STUN-only.

Create `.env.example`.

Do not commit actual credentials.

---

# 14. Important TURN Limitation

Document clearly:

STUN-only calling will work for many test networks but not all.

Some NAT/firewall combinations require a TURN relay.

Do not hide this limitation.

Create:

`README.md`

explaining that production LearnThrive video calling would require a reliable TURN service.

Do NOT attempt to deploy or purchase TURN infrastructure in this task.

---

# 15. Connection States

Display useful meeting states such as:

* Preparing camera…
* Ready to join
* Waiting for another participant…
* Connecting…
* Connected
* Reconnecting…
* Participant left
* Connection failed

Use actual:

`RTCPeerConnection.connectionState`

and/or:

`iceConnectionState`

where appropriate.

Do not show "Connected" merely because Socket.IO connected.

Differentiate:

**signalling connected**

from:

**WebRTC media connected**

internally.

---

# 16. Handle Participant Departure

When one participant leaves:

* remove the remote stream
* update the UI
* keep the remaining user's local preview active
* display something like:

`The other participant has left the meeting.`

Allow the remaining participant to wait for somebody else to join that room again.

Clean up the old peer connection before creating a replacement.

---

# 17. Handle Refreshes

Refreshing the browser should:

* leave the old Socket.IO session
* clean up the WebRTC connection naturally
* allow that participant to rejoin

Do not create duplicate ghost participants.

---

# 18. Camera and Microphone Errors

Handle common errors cleanly:

* permission denied
* no camera
* no microphone
* device already unavailable
* browser does not support WebRTC
* insecure context
* media acquisition failure

Show human-readable messages rather than stack traces.

Do not expose raw internal errors to users.

Log useful technical information to the development console.

---

# 19. Echo Prevention

Local video must be:

* muted
* autoplay
* playsInline

Remote video should play audio normally.

Avoid creating audio feedback during same-room testing.

---

# 20. Basic Device Selection

If straightforward, add simple camera and microphone selectors to the pre-join screen using:

`navigator.mediaDevices.enumerateDevices()`

Only do this if it can be implemented cleanly within this task.

Changing a device should replace the appropriate WebRTC sender track using:

`RTCRtpSender.replaceTrack()`

rather than tearing down the entire call.

If implementing this would materially complicate the prototype, leave it for the next iteration.

Core two-person calling is more important.

---

# 21. Screen Sharing

Do NOT implement screen sharing in this first prototype.

Leave the architecture sufficiently clean that:

`navigator.mediaDevices.getDisplayMedia()`

could be added later.

Do not add a fake disabled screen-share button unless it is clearly labelled as unavailable.

---

# 22. Recording

Do NOT implement:

* recording
* screenshots
* automatic transcription
* AI notes

LearnThrive's current policy is that sessions are not recorded by default.

---

# 23. Authentication

Do NOT implement authentication.

Participants enter a temporary display name.

Room IDs are sufficient for this prototype.

Do not pretend this is secure enough for production.

Document that production will require:

* authenticated users
* authorised room access
* server-issued meeting credentials
* meeting expiry
* stronger access controls

---

# 24. Security Basics

Even though this is a prototype:

* validate room IDs
* validate display-name length
* limit rooms to two sockets
* limit signalling messages to users in the same room
* do not permit arbitrary room broadcasting
* use reasonable Socket.IO message size limits
* clean room state on disconnect
* do not expose stack traces to the browser
* do not use `dangerouslySetInnerHTML`

Do not over-engineer authentication that does not exist yet.

---

# 25. Signalling Events

Use clearly named typed signalling events.

For example:

Client → server:

* `room:join`
* `webrtc:offer`
* `webrtc:answer`
* `webrtc:ice-candidate`
* `room:leave`

Server → client:

* `room:joined`
* `room:participant-joined`
* `room:participant-left`
* `room:full`
* `webrtc:offer`
* `webrtc:answer`
* `webrtc:ice-candidate`

Use TypeScript interfaces for event payloads.

Do not create an untyped collection of random event strings throughout the codebase.

---

# 26. Styling

Inspect:

`D:\LearnThrive`

read-only.

Match the LearnThrive brand approximately:

* navy
* green
* mint
* cream/white
* existing typography style
* restrained shadows
* rounded surfaces
* professional educational appearance

Copy an appropriate logo asset into:

`D:\LearnThriveSoftware`

if needed.

Do not introduce unnecessary UI frameworks.

Use CSS modules, standard CSS, or the simplest approach consistent with the prototype.

Do not copy the entire marketing site's CSS.

---

# 27. Accessibility

Implement:

* labelled controls
* accessible button names
* keyboard-operable controls
* clear focus states
* status announcements where useful
* good colour contrast
* controls that do not rely solely on colour
* touch-friendly buttons

Mute and camera buttons should communicate state to assistive technology.

For example:

`aria-pressed`

where appropriate.

---

# 28. Responsive Design

Test approximately:

* 390px mobile
* 768px tablet
* 1024px laptop
* 1440px desktop

There must be no horizontal overflow.

The meeting controls must remain usable on mobile.

---

# 29. Development Diagnostics

Create a small development-only diagnostics area or console logging that makes troubleshooting easier.

Useful information:

* Socket.IO status
* room ID
* WebRTC connection state
* ICE connection state
* signalling state
* local tracks
* remote tracks

Do not show detailed diagnostics in the normal polished UI unless a development/debug mode is enabled.

A query such as:

`?debug=1`

would be acceptable.

---

# 30. Automated Tests

Add focused tests where practical.

At minimum test signalling-room logic such as:

* first participant joins
* second participant joins
* third participant rejected
* disconnect removes participant
* signalling cannot be sent to unrelated room

Do not attempt to completely automate real webcam hardware.

---

# 31. Manual Two-Participant Test

After implementation, perform as much local testing as possible.

Create:

`TESTING.md`

with exact instructions for testing two participants.

Include two supported approaches:

## Test A — Same computer

Open:

`http://localhost:5173`

in:

* normal Chrome window
* Chrome Incognito or a second browser

Join the same room.

Explain that some computers/drivers may not allow two browser sessions to use the same physical webcam simultaneously.

Audio feedback may occur if both sessions use speakers on the same device.

Headphones are recommended.

## Test B — Two physical devices

Document how to expose the local application using a temporary HTTPS development tunnel.

Do not require a production deployment.

---

# 32. Cloudflare Quick Tunnel Compatibility

Ensure the development setup works when the Vite app is temporarily exposed through Cloudflare Tunnel.

Because Socket.IO is proxied through Vite on the same origin, only one public tunnel should be required.

Expected flow:

Browser
→ temporary HTTPS URL
→ Vite development server
→ `/socket.io`
→ local signalling server

Do not hard-code `localhost` in browser-facing Socket.IO configuration.

This requirement is important.

---

# 33. README

Create a useful:

`README.md`

including:

## Requirements

* Node.js
* npm
* modern browser

## Installation

```powershell
cd D:\LearnThriveSoftware
npm install
```

## Start

```powershell
npm run dev
```

## Local URL

`http://localhost:5173`

## Two-person test

Explain both same-machine and temporary-tunnel approaches.

## Current limitations

Explicitly state:

* 2 participants only
* no authentication
* no scheduling
* no database
* no recording
* no screen sharing
* STUN-only by default
* TURN may be required on restrictive networks
* prototype only, not production-ready

## Future roadmap

Briefly mention logical future additions such as:

* TURN
* authenticated LearnThrive accounts
* scheduled lesson rooms
* parent/student/tutor access
* screen sharing
* whiteboard
* chat
* attendance
* connection-quality monitoring

Do NOT implement those features yet.

---

# 34. Quality Checks

Before finishing:

Run:

* lint
* TypeScript check
* tests
* production frontend build

Fix all errors introduced by this task.

Start the development environment and confirm:

* page loads
* camera preview works
* microphone permission works
* room creation works
* room joining works
* second participant can establish a WebRTC connection if the environment permits it
* mute works
* camera toggle works
* leave works
* participant departure is detected
* third participant is rejected

Do not claim a two-device call was successfully tested unless you actually performed one.

---

# 35. Do Not Expand Scope

Do NOT build:

* the LearnThrive admin dashboard
* tutor dashboard
* parent dashboard
* student dashboard
* scheduling
* payments
* invoicing
* homework
* attendance records
* chat
* file sharing
* whiteboard
* screen sharing
* recordings
* authentication
* a database

This task exists only to prove the basic video-meeting architecture.

---

# 36. Final Report

When complete, report:

## Architecture

Briefly explain how browser WebRTC and Socket.IO signalling work.

## Files created

List the important project files.

## Features completed

List actual working meeting features.

## Testing

Report:

* lint
* TypeScript
* automated tests
* build
* local browser test

Clearly distinguish between:

* same-machine test
* actual two-device test

## Remaining limitations

Mention especially:

* STUN/TURN
* authentication
* room authorisation
* production deployment

## How I can test it now

Repeat the exact commands and test procedure.

Do not modify `D:\LearnThrive`.

Do not deploy anything.
