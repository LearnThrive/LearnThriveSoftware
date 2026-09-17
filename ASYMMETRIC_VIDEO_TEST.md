# Diagnosing "one side can't see the other" video

Use this if a physical laptop ↔ phone test shows video working in only one direction — one participant sees the other, but not vice versa — or if either side sees no video from the other at all.

## The bug that caused this the first time (now fixed)

A real physical test found exactly this: laptop ↔ phone connected, audio/signalling worked, but the laptop never saw the phone's video (the phone did see the laptop's). This was root-caused and fixed in this codebase — see the commit "Fix the root cause of asymmetric video: the answerer's camera/mic were never actually sent" in `src/peer.ts`.

**The root cause:** whichever participant joins *second* is never the WebRTC offer initiator — they only answer. The old code had both sides pre-create their outgoing audio/video transceivers before any signalling happened. Chrome does not reuse the answering side's pre-created transceivers when it applies the incoming offer; it silently creates a *second*, separate `recvonly` pair instead, and leaves the answerer's own track-carrying transceivers orphaned. The answer therefore always declared `recvonly`, so the joining participant's camera/mic were captured locally (their own preview looked fine) but their media was never actually sent to the other side. This was confirmed in a minimal reproduction using nothing but the browser's own `RTCPeerConnection` API, with none of this project's code involved — it's a genuine WebRTC/Chrome interop behaviour, not a guess.

**The fix:** only the offer initiator pre-creates transceivers. The answering side now attaches its own tracks to the transceivers Chrome creates automatically once it has applied the offer, and upgrades their direction to `sendrecv` before creating the answer (`attachAnswererTracks` in `src/peer.ts`). Verified with `RTCRtpTransceiver.currentDirection` reaching `sendrecv` symmetrically on both sides, and with a Playwright regression test (`tests/meeting.spec.ts`) that asserts the remote tile actually shows video, not just that the connection reports "connected".

**What this means for your retest:** the specific mechanism that caused the original bug is fixed and covered by an automated test. A fresh physical retest (laptop ↔ phone, both directions) is still the way to confirm it on real hardware and real cameras — the fix was verified with Chromium's synthetic test-pattern camera, not a real one. If it's still broken after this fix, it's a different failure mode, and the diagnostics below will show it.

## How to capture the diagnostics

On **both** devices, open the meeting with `?debug=1` appended to the URL (e.g. `https://your-tunnel-or-ts.net-url/meeting?room=xxxx&debug=1`), scroll to **Development diagnostics** at the bottom, and expand it. Wait at least 3 seconds after the call shows "Connected" — the first reading can lag by up to ~2.5s.

Compare these fields side by side. Take a screenshot or write down the exact values from both devices; "it didn't work" alone isn't enough to diagnose from.

### On the side that isn't seeing video (the "receiver" for this check)

| Field | What it tells you |
| --- | --- |
| Remote video track | `none` means no video track has arrived at all — a negotiation problem (see below), not a rendering problem |
| Video transceiver direction | The requested direction — should be `sendrecv` |
| Video transceiver direction (negotiated) | The **actual** negotiated direction after SDP exchange. If this is `recvonly` or `inactive` while the requested direction is `sendrecv`, the other side's answer/offer declared less than full duplex — this is exactly the bug described above if it recurs |
| Frames decoded | `0` or not increasing over a few seconds means frames aren't arriving even if a track exists |

If "Remote video track" shows an id (not `none`) but the tile still shows a placeholder instead of video, check the **other** device's outgoing state instead — the problem is on the sending side, not this one.

### On the side whose video isn't being seen (the "sender" for this check)

| Field | What it tells you |
| --- | --- |
| Local video track | Should show a track id, `enabled`, `unmuted`, `live`. If it shows `disabled` the camera is toggled off in the UI (not a bug — check the camera button). If it shows `muted` the track is live but not currently delivering data (a transient state, not "off") |
| Video transceiver direction (negotiated) | Should be `sendrecv` or `sendonly`. If it's `recvonly` here, this device isn't sending at all — that's the answerer-side bug pattern described above |
| Frames encoded | Should be non-zero and increasing if the camera is genuinely capturing |
| Packets sent | Should be non-zero and increasing |

## Other failure modes this panel distinguishes

The diagnostics panel exists specifically to tell these apart, since "I can't see them" can mean any of:

1. **No remote track at all** — negotiation never carried video for this m-line. Look at "negotiated" direction on the receiving side; `recvonly`/`inactive` there (while local is `sendrecv`) means the *other* side never sent.
2. **Track exists but muted or ended** — "Remote video track" shows an id but `muted` or `readyState: ended`. The tile correctly shows "Video is paused" in this case rather than a frozen frame; if it persists for more than a few seconds while both sides report a healthy connection, that's worth reporting with both devices' full diagnostics.
3. **Direction never negotiated to receive** — the specific bug this document describes above; visible as `negotiated: recvonly` on one side.
4. **CSS-hidden or not actually rendering** — if diagnostics show a live, unmuted remote track but the tile still looks wrong, that's a rendering bug, not a media bug; note the exact visual symptom (black frame? frozen frame? placeholder despite a track?) alongside the diagnostics.
5. **Autoplay blocked** — the tile shows a "Click to enable audio" button. This means the browser blocked `<video>.play()`, usually because the tab was backgrounded when the track arrived; clicking the button retries playback. If it persists after clicking, note that specifically — it's different from all of the above.

## Reporting a result

If everything above looks correct on both sides (`sendrecv` negotiated both ways, tracks live/unmuted, frames encoded and decoded both increasing) but you still don't see video, that's a rendering-layer bug, not a negotiation one — note the exact visual symptom, both devices' full diagnostics panels, browser + OS versions, and whether it's consistent or intermittent.
