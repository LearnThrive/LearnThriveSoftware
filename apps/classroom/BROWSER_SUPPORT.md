# Browser Support

What has actually been tested, on what, and what hasn't. See [TESTING.md](TESTING.md) for the full automated verification record and manual test matrix — this document is specifically about *browser/device coverage*, consolidated in one place per the plan's request rather than scattered across other docs.

**Do not read a blank cell here as "works" — it means untested.** Only rows marked ✅ have actually been run.

## Desktop browsers

| Browser | Core call (join/mute/camera/chat/reactions) | Screen sharing | Screen-share audio | Whiteboard | TURN (`?forceTurn=1`) |
| --- | --- | --- | --- | --- | --- |
| Chrome / Chromium (Windows) | ✅ Automated (Playwright, synthetic media) | ⬜ Manual only — no automated harness for real screen capture (see [TESTING.md](TESTING.md)) | ⬜ Not tested — needs a real screen/tab with audio and a human to confirm it's actually audible | ✅ Automated (Playwright — draws a real shape via the toolbar, confirms sync to a second browser) | ⬜ Not tested — this build has no Cloudflare TURN key (see [TURN_TESTING.md](TURN_TESTING.md)) |
| Edge (Windows) | ⬜ Not separately tested — Chromium-based, shares Chrome's rendering/WebRTC engine, so the Chrome results should transfer, but Edge itself has not been launched | ⬜ | ⬜ | ⬜ | ⬜ |
| Firefox (Windows) | ✅ Automated (Playwright, synthetic media via `firefoxUserPrefs`) | ⬜ Manual only | ⬜ Not tested | ⬜ Not automated for Firefox specifically (whiteboard test runs on Chromium only — Excalidraw itself is cross-browser, but this project's own integration hasn't been separately verified on Firefox) | ⬜ Not tested |
| Safari (macOS) | ⬜ Not tested at all — no macOS machine available during this build | ⬜ | ⬜ | ⬜ | ⬜ |

## Mobile browsers

| Browser | Core call | Notes |
| --- | --- | --- |
| Android Chrome | ⬜ Not tested on a real device — emulated 375×812/390×844 viewports inspected in-session (a real layout bug at short landscape heights was found and fixed in an earlier pass) | Screen sharing is not offered on mobile at all (feature-detected via `getDisplayMedia` absence) — this is expected, not a gap |
| iOS Safari | ⬜ Not tested at all | Same expected screen-share limitation; iOS Safari's WebRTC implementation has its own historical quirks (autoplay policy, `getUserMedia` constraints) not yet verified here |

## Feature-detected capabilities

These are explicitly feature-detected and hidden (not shown broken) when unsupported, per the existing pattern established in `src/screenShare.ts`/`canShareScreen()`:

| Feature | Detection | Verified working | Verified *hidden* when absent |
| --- | --- | --- | --- |
| `getDisplayMedia` (screen sharing) | `typeof navigator.mediaDevices?.getDisplayMedia === 'function'` | ✅ Chromium, automated | ✅ (mobile browsers lack it; control hidden) |
| Screen-capture audio (`systemAudio`/tab-audio checkbox) | Presence of an audio track on the returned `MediaStream` | ⬜ Not verified with real hardware | N/A — silently absent if the browser/OS doesn't offer it, no broken UI either way |
| Fullscreen API | `document.fullscreenEnabled` | ✅ Chromium (button appears, toggles) | ⬜ Not explicitly tested on a browser lacking it |
| Picture-in-Picture | Not implemented in this prototype | N/A | N/A |
| `setSinkId` (speaker selection) | Not implemented in this prototype | N/A | N/A |

## What this means in practice

- **Safe to demo/test today:** Chrome/Chromium and Firefox on desktop, for the core call and whiteboard.
- **Needs a physical pass before any real trial:** everything in the "Mobile browsers" table, Safari on any platform, real screen-share audio, and TURN against a real Cloudflare account (`?forceTurn=1`) — see [LAPTOP_PHONE_TEST.md](LAPTOP_PHONE_TEST.md) and [TURN_TESTING.md](TURN_TESTING.md) for the exact procedures, none of which have been run yet in this pass.
- **Edge** is very likely fine given its shared Chromium engine, but "very likely" is not "tested" — don't claim it as verified.
