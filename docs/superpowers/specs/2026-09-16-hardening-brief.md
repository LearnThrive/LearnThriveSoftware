# LearnThrive meeting prototype — hardening & feature-expansion brief

Verbatim user brief (2026-09-16), preserved for subagents executing docs/superpowers/plans/2026-09-16-hardening.md so they have the exact requirements without re-deriving them from conversation history.

---

Continue development of the existing LearnThrive video meeting prototype located at:
`D:\LearnThriveSoftware`
Do NOT modify:
`D:\LearnThrive`
The current prototype already has a working 1-to-1 WebRTC meeting flow with:

* React + TypeScript + Vite
* Socket.IO signalling
* local/remote video
* pre-join screen
* room creation/joining
* microphone toggle
* camera toggle
* leave flow
* two-participant limit
* branded LearnThrive UI
* automated unit tests
* Playwright browser tests
* passing lint/typecheck/build
* same-browser automated WebRTC verification
* graceful camera/microphone denial handling
* mobile responsive layout

Do not rebuild working functionality.
Your task is to harden the current architecture and maximise the quality of the classroom prototype.
Treat the current implementation as a release candidate.

## 1. FIRST: ESTABLISH THE BASELINE

Before changing anything:

1. Inspect the current git status.
2. Read: existing implementation; `README.md`; `TESTING.md`; existing plans under `docs/`; unit tests; Playwright tests.
3. Run: lint; TypeScript; unit tests; Playwright tests; production build.
4. Confirm the current baseline is green.
5. Commit or otherwise preserve the current known-good state before making significant changes if the repository workflow allows it.

Do not introduce regressions into functionality that is already working.

## 2. PRIORITY ORDER

Work in this order:

1. security and lifecycle correctness
2. reconnection/resilience
3. TURN support
4. screen sharing
5. text chat
6. device switching
7. connection quality monitoring
8. UX improvements
9. accessibility
10. automated regression coverage
11. documentation

Do not prioritise cosmetic work ahead of reliability.

## 3. SECURITY / SIGNALLING HARDENING

Audit the entire signalling path. Specifically verify that:

* users can only signal participants in the room they actually joined
* users cannot spoof another room ID after joining
* arbitrary Socket.IO events cannot be used to broadcast to unrelated rooms
* third participants cannot race into a supposedly full room
* disconnect always clears room membership
* reconnect does not produce duplicate membership
* old socket IDs cannot continue signalling
* stale offers/answers cannot be replayed into a replacement peer connection
* malformed signalling payloads are rejected
* excessively large signalling payloads are rejected
* display names have length limits
* room IDs are validated
* dangerous characters are rejected where appropriate
* server errors are not exposed verbatim to clients

Use schema validation if appropriate. Do not add a heavy dependency unless justified. If validation already exists, strengthen it instead of replacing it.

## 4. ROOM LIFECYCLE

Make room lifecycle deterministic. A room should support: first participant joins; second participant joins; WebRTC connects; either participant leaves; remaining participant is informed; room remains available; another participant can later join; new WebRTC peer connection is created cleanly; old connection is disposed fully.

Ensure: old tracks are removed; old RTCPeerConnections are closed; old event listeners are removed; pending ICE candidates are discarded; stale negotiation state is cleared; stale timeouts are cleared.

No ghost participants. No duplicate streams. No duplicate `track` handlers.

## 5. RECONNECTION

Implement resilient Socket.IO reconnection. Handle: transient Socket.IO disconnect; temporary network loss; browser Wi-Fi switching; peer connection moving to disconnected; peer connection moving to failed.

Use appropriate timers rather than reacting instantly to brief `disconnected` states. Add a clear user-visible state: Connected; Connection interrupted; Reconnecting…; Reconnected; Unable to reconnect.

Where safe, automatically recover. If automatic recovery is not possible, provide a clear Reconnect button. Do not leave the meeting UI frozen.

## 6. WEBRTC ICE RESTART

Implement ICE restart support where appropriate. If `RTCPeerConnection.connectionState === "failed"` or an equivalent persistent ICE failure occurs: attempt an ICE restart. Ensure only one side becomes the restart offerer. Avoid negotiation storms. Use explicit internal state to prevent simultaneous offer generation.

## 7. NEGOTIATION CORRECTNESS

Review the current offer/answer implementation. Either preserve the current deterministic first-participant initiator design, or implement the Perfect Negotiation pattern if that genuinely improves robustness. Do not switch architecture merely because Perfect Negotiation exists.

Whichever approach is used must handle: second participant joining; participant rejoining; screen-sharing track replacement; camera replacement; ICE restart; device switching — without producing `InvalidStateError` or `setRemoteDescription called in wrong state` race conditions. Add regression tests for any race condition discovered.

## 8. TURN SUPPORT

Make TURN support production-compatible. Keep current STUN support. Support environment-based TURN configuration, e.g.:

```env
VITE_TURN_URL=
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
```

Allow multiple ICE servers if useful. Do not commit credentials. Add `.env.example` if not already present. Clearly document: STUN-only development mode; TURN-enabled mode; why TURN is required for reliable real-world calling. Do not deploy a TURN server in this task.

## 9. ADD SCREEN SHARING

Implement screen sharing using `navigator.mediaDevices.getDisplayMedia()`. Add a "Share screen" control. When enabled: replace the outgoing video sender track with the display track; remote participant sees the shared screen; local UI indicates screen sharing; camera track should remain available for restoration; stopping sharing returns to camera automatically.

Handle the browser-native "Stop sharing" action through the display track's `ended` event. Do NOT create a second peer connection. Use `RTCRtpSender.replaceTrack()` where appropriate.

## 10. SCREEN-SHARE UX

When screen sharing: make the shared screen the dominant tile; keep participant identity visible; make it obvious that screen sharing is active; provide Stop sharing.

On mobile: hide/disable the control if the browser does not support display capture; do not show a broken button.

Gracefully handle: user cancels share picker; browser denies screen-sharing permission; screen share ends externally.

## 11. CAMERA DURING SCREEN SHARE

Preserve the user's camera state. If the user was camera on before sharing → restore camera when sharing stops. If camera off before sharing → remain camera off when sharing stops. Do not unexpectedly activate the camera.

## 12. ADD IN-MEETING TEXT CHAT

Add a simple ephemeral text chat over Socket.IO. Do NOT add a database. Messages should exist only while the users are in the room. Support: send message; receive message; sender name; timestamp; local/remote styling; unread indicator if chat panel is closed.

Limit: message length; event size; rate of message sending. Prevent HTML injection. Render messages as plain text.

## 13. CHAT UX

Desktop: collapsible right-hand chat panel. Mobile: full-height sheet/drawer or equivalent responsive panel. Controls: Chat. Show unread count when messages arrive while closed. Do not let the chat panel make video unusable on small screens.

## 14. CHAT SECURITY

Validate chat messages server-side. Reject: empty messages; overly long messages; malformed payloads; messages from sockets not currently in the room; messages targeting unrelated rooms. Add a lightweight anti-spam rate limit. No markdown rendering. No HTML rendering.

## 15. DEVICE SELECTION

Add pre-join device selection for microphone and camera using `navigator.mediaDevices.enumerateDevices()`. After permission is granted, show real device labels. When a device changes: obtain a new media track; stop the old track; update the local stream; replace the WebRTC sender track using `replaceTrack()`. Do not tear down the call.

## 16. IN-CALL DEVICE SWITCHING

Allow changing camera and microphone during a meeting via a small device menu near relevant controls. Changing the device must: keep the existing peer connection; not disconnect the other participant; preserve mute state; preserve camera enabled/disabled state.

Handle devices being unplugged. Listen for `navigator.mediaDevices.devicechange`. Update device lists appropriately.

## 17. CAMERA FLIP SUPPORT

On compatible mobile devices, provide a simple way to switch between front and rear camera. Do not make assumptions about exact device IDs; prefer `facingMode` where appropriate. Only show this control if multiple cameras appear available.

## 18. CONNECTION QUALITY MONITORING

Use `RTCPeerConnection.getStats()` to gather diagnostics: round-trip time; packets lost; jitter; inbound bitrate; outbound bitrate; selected ICE candidate pair; candidate type; relay vs direct connection; frame rate where available; resolution; audio level where available. Poll at a sensible interval such as every 2–3 seconds. Do not poll continuously.

## 19. USER-FACING CONNECTION INDICATOR

Convert metrics into a simple indicator: Excellent; Good; Fair; Poor. Do not pretend this is scientifically exact. Use conservative thresholds. Show "Connection: Good" or similar in the meeting UI. Do not expose detailed networking jargon to normal users.

## 20. DEBUG DIAGNOSTICS

When `?debug=1` is present, show detailed diagnostics including: Socket.IO connected/disconnected; socket ID; room ID; participant count; WebRTC connection state; ICE connection state; signalling state; ICE candidate type; selected candidate pair; RTT; jitter; packet loss; bitrate; local track state; remote track state; active camera/microphone device; screen-share state. Keep this completely out of the normal UI.

## 21. DIRECT VS RELAY INDICATOR

In debug mode only, show whether the active connection is host, srflx, or relay. Useful for confirming TURN behaviour later. Do not expose private IP addresses unnecessarily in the normal interface.

## 22. MEDIA PERMISSION UX

Improve permission handling. Distinguish: permission denied; no device found; device busy; unsupported browser; insecure context; generic media failure. Provide a useful instruction for each. Do not display raw exception messages to users.

## 23. PRE-JOIN DEVICE TEST

Enhance the current "Check camera & microphone" flow. Show: live camera preview; microphone activity meter; selected microphone; selected camera; mic muted state; camera off state. A basic audio level indicator is enough. Do not record audio.

## 24. AUTOPLAY HANDLING

Handle remote media autoplay restrictions gracefully. If remote audio cannot autoplay: show a clear "Click to enable audio" control. Do not leave users wondering why they cannot hear the other participant.

## 25. AUDIO OUTPUT

If supported by the browser, optionally allow output-device selection through `HTMLMediaElement.setSinkId()`. Feature-detect this. Do not require it. Do not break Safari/mobile browsers that do not support it.

## 26. MEETING TIMER

Add a meeting duration timer. Start it when the peer-to-peer call becomes connected, not merely when the page loads. Example: `00:14:37`. Reset appropriately after the call ends.

## 27. PARTICIPANT STATUS

Improve participant presence states, e.g.: Waiting for participant; Alvi joined; Connected; Tahasin muted; Tahasin turned camera off; Participant reconnecting; Participant left. Keep notifications subtle. Do not spam the screen.

## 28. FULLSCREEN

Add optional fullscreen mode for the remote/shared-screen area using the Fullscreen API. Feature-detect. Provide escape behaviour naturally. Do not force fullscreen.

## 29. PICTURE-IN-PICTURE

If straightforward, support Picture-in-Picture for remote video on compatible desktop browsers. Feature-detect. Do not make it a core requirement if browser support complicates the implementation.

## 30. KEYBOARD SHORTCUTS

Add reasonable shortcuts, e.g.: `M` → mute/unmute; `V` → camera on/off; `C` → chat; `S` → screen share. Do NOT trigger shortcuts while the user is typing into input/textarea/contenteditable. Show shortcuts in accessible tooltips if appropriate.

## 31. MEETING CONTROL DESIGN

Keep the current LearnThrive visual style. Do not redesign the page. Improve the control bar to accommodate: microphone; camera; screen share; chat; device options; leave. Keep Leave visually distinct. Do not make every button equally prominent.

## 32. ACCESSIBILITY

Audit all new features. Ensure: keyboard access; accessible labels; `aria-pressed` for toggles; focus management; visible focus; screen-reader status updates; chat announcements are not excessively noisy; accessible device menus; no colour-only status indicators; reduced-motion support. Test with keyboard-only navigation.

## 33. MOBILE UX

Test 360px, 390px, 430px. The meeting must remain usable. Ensure: controls fit; chat does not cover everything permanently; local preview does not block key content; screen-sharing state works; device menus are usable; orientation changes do not break layout.

## 34. ORIENTATION CHANGES

Handle mobile portrait ↔ landscape changes. Do not assume the initial viewport remains constant. Avoid fixed dimensions that cause overflow after rotation.

## 35. NETWORK INTERRUPTION TESTING

Add manual test instructions for: turning Wi-Fi off for 5–10 seconds; restoring Wi-Fi; switching Wi-Fi networks; phone switching between Wi-Fi and mobile data where possible; one participant refreshing; one participant closing browser abruptly. Document expected behaviour.

## 36. BROWSER COMPATIBILITY

Target modern Chrome, Edge, Firefox, Safari. Do not attempt legacy browser support. Use feature detection for: screen sharing; setSinkId; picture-in-picture; advanced media APIs. Gracefully hide unsupported controls.

## 37. PLAYWRIGHT TEST EXPANSION

Expand the Playwright suite. Test at minimum:

Room behaviour: first participant joins; second participant joins; third rejected; leave/rejoin works; remaining participant waits correctly.
Meeting controls: mute; unmute; camera off; camera on.
Chat: message sent; message received; unread badge; XSS-like message stays plain text.
Screen share, where browser automation reasonably supports fake display media: start sharing; remote receives replacement video; stop sharing; camera restores. If reliable screen-share automation is not feasible, document it as a manual test rather than writing flaky automation.
Reconnection: simulate socket disconnect/reconnect if feasible without creating brittle tests. Do not add flaky tests simply to increase test count.

## 38. SERVER TESTS

Add server-side tests for: room validation; room capacity; spoofed room signalling; malformed offers; malformed answers; malformed ICE candidates; chat validation; chat rate limiting; disconnect cleanup; reconnect behaviour; stale socket behaviour. Test real discovered bugs.

## 39. WEBRTC UNIT TESTS

Where practical, extract pure state/lifecycle helpers for testing. Do not attempt to mock the entire browser WebRTC stack unnecessarily. Focus unit tests on: state transitions; queued ICE handling; participant lifecycle; reconnect decisions; quality classification; signalling payload validation.

## 40. ERROR BOUNDARY

Add sensible application-level error handling if none exists. Unexpected UI errors should present a recoverable error screen rather than a blank page. Do not expose stack traces in production UI.

## 41. LOGGING

Create structured development logging. Use categories such as: signalling; media; peer; ICE; chat; devices. Do not scatter uncontrolled `console.log()` calls throughout the application. Verbose logs should primarily appear in development/debug mode.

## 42. MEMORY LEAK AUDIT

Audit: event listeners; Socket.IO listeners; media tracks; timers; intervals; stats polling; RTCPeerConnection objects. Ensure all are cleaned up on: leave; participant departure; room change; unmount; reconnect; refresh. Add tests where possible.

## 43. PERFORMANCE

Avoid unnecessary React rerenders from WebRTC stats. Do not store high-frequency stats in giant global state. Use sensible throttling/polling. Do not rebuild MediaStreams unnecessarily. Do not repeatedly reacquire camera/microphone.

## 44. PRIVACY

Do not implement: recording; transcription; AI note-taking; screenshots; persistent chat storage. The current LearnThrive position is that lessons are not recorded by default. Keep all chat ephemeral.

## 45. NO DATABASE YET

Do not add PostgreSQL, Supabase, Firebase, SQLite, or MongoDB. This remains a real-time classroom prototype. Persistent lesson records come later.

## 46. NO AUTHENTICATION YET

Do not add authentication in this task. Document clearly that room links are not sufficient security for production. Production later requires: authenticated users; server-created rooms; role checks; meeting authorisation; expiring credentials; scheduled lesson association.

## 47. NO MULTI-PARTY VIDEO

Keep the limit at 2 participants. Do not build an SFU. Do not introduce mediasoup, LiveKit, Janus, Jitsi, Twilio, Daily, or Agora. The purpose is to maximise the quality of the current 1-to-1 architecture first.

## 48. UPDATE README

Expand `README.md` with: architecture; WebRTC flow; Socket.IO signalling flow; STUN/TURN explanation; feature list; local test instructions; tunnel test instructions; browser support; debug mode; known limitations; production gaps. Include a simple architecture diagram using Mermaid if appropriate.

## 49. UPDATE TESTING.md

Turn `TESTING.md` into an actual test matrix with columns for: Test; Chrome; Edge; Firefox; Safari; Laptop ↔ Laptop; Laptop ↔ Phone; Same-device browser test; Result; Notes.

Include tests for: camera; microphone; mute; camera disable; screen share; chat; leave; reconnect; refresh; third participant rejection; TURN; mobile portrait; mobile landscape. Do not falsely mark tests passed if they were not actually performed.

## 50. CREATE PRODUCTION_GAPS.md

Document what still prevents this prototype from being used for real tuition. At minimum include: authentication; room authorisation; lesson scheduling; expiring room credentials; production signalling hosting; TURN service; TLS/HTTPS; monitoring; privacy review; safeguarding integration; abuse controls; production rate limits; data protection review; browser compatibility verification. Do not implement those merely because they are documented.

## 51. SECURITY REVIEW

Perform an adversarial review after implementation. Try to break: room isolation; signalling; reconnect; chat; participant capacity; stale sessions; screen sharing; device switching; lifecycle cleanup. Do not report hypothetical issues as fixed. Only report a defect as fixed if you reproduced it, demonstrated it through code, or proved the failure path through a reliable test.

## 52. MANUAL VISUAL REVIEW

Use the browser and inspect: pre-join; waiting state; connected call; camera off; microphone muted; screen sharing; chat open; chat closed; poor connection; reconnect state; participant left; mobile layout. Fix genuine visual problems discovered. Do NOT perform a redesign.

## 53. FINAL VERIFICATION

Run the complete verification suite: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser`. Use the actual scripts defined by the repository. Fix all failures. Do not finish with known first-party console errors.

## 54. REAL TWO-DEVICE TEST DOCUMENTATION

Do not claim an actual laptop ↔ phone call unless one is genuinely performed. Provide exact instructions for the user to test with a Cloudflare Quick Tunnel: start `npm run dev`, then `cloudflared tunnel --url http://localhost:5173`, then: open HTTPS tunnel URL on laptop; create room; copy invite; send invite to phone; join from phone; verify both directions of video; verify both directions of audio; test mute; test camera toggle; test chat; test screen share where supported; disconnect Wi-Fi briefly; verify reconnect behaviour; leave/rejoin; verify no ghost participant remains.

## 55. STOP CONDITIONS

Do not expand into unrelated platform features. Do NOT add: dashboards; scheduling; attendance; invoicing; payments; homework; resources; student records; tutor accounts; parent accounts; admin accounts; whiteboard; persistent chat; recording; AI transcription. Those come later.

## 56. FINAL REPORT

When finished, provide a concise but evidence-based report: Baseline (what passed before changes); Bugs actually found (only defects reproduced or demonstrated, each with symptom/cause/fix/regression test); Features added; Security review (concrete room/signalling/lifecycle findings); Test results (actual lint/typecheck/unit/Playwright/build); Browser review (what browsers/viewports were genuinely inspected); Two-device test (explicitly state "Performed successfully" or "Not performed — instructions provided", never imply untested work was tested); Remaining production gaps (summary of PRODUCTION_GAPS.md). Do not continue into additional features after completing this task.
