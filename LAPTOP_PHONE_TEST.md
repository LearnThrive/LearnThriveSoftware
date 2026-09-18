# Laptop to Phone Test

A step-by-step guide for testing a real call between this laptop and a phone.

**This has been performed once already.** It found two real defects: video only worked in one direction (laptop couldn't see the phone), and an audible feedback/screech, most noticeable on the phone. Both have been investigated and addressed since:

- The video defect was root-caused and fixed (a WebRTC negotiation bug affecting whichever side joins second) — see [ASYMMETRIC_VIDEO_TEST.md](ASYMMETRIC_VIDEO_TEST.md) for the full explanation and how to check for it if it recurs.
- The feedback risk has been hardened against: local video is now always rendered muted everywhere in the app (pre-join preview, meeting tile, screen-share preview, device-test preview), so this app's own UI can never loop your own microphone audio back through your own speakers. **Use headphones on at least one device anyway** — see [Audio feedback](#audio-feedback-use-headphones) below; this is a physical-acoustics risk (two nearby speakers/microphones), not something any app-level fix alone can fully prevent.

Record your actual results in [TESTING.md](TESTING.md)'s test matrix; don't mark rows as passed until you've genuinely run them again.

## Audio feedback — use headphones

If both devices are physically near each other with their speakers on, you can get a real audio feedback loop (a screech/echo) **regardless of this or any app** — device A's microphone picks up device B's speaker output, sends it back to device B, which plays it out its speaker, which A's microphone picks up again. This is ordinary room acoustics with two open mic+speaker pairs nearby, the same as with a phone call on speakerphone next to another phone on speakerphone.

**Use headphones on at least one of the two devices** (ideally both) whenever they're in the same room. If you must test without headphones, keep the devices in separate rooms, or mute one side's microphone while the other is talking.

## What you need

- This laptop, with the project installed (`npm install` already run).
- A phone (or any second physical device) on the same or a different network.
- **Recommended:** [Tailscale](https://tailscale.com/) installed on both devices — see [TAILSCALE_TESTING.md](TAILSCALE_TESTING.md) for the full walkthrough. It gives a stable URL that doesn't change between test sessions.
- **Fallback:** [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) for a one-off Cloudflare Quick Tunnel, covered below. Neither tool is installed or started by this project.

## No `.env` editing is required for either option

Invite links are generated from the page's own current URL (`window.location.origin`), never a hardcoded address, and both `.trycloudflare.com` (Quick Tunnel) and `.ts.net` (Tailscale) hostnames are automatically allowed by both Vite and the signalling server. You do **not** need to create or edit `.env`, and you do **not** need to restart the dev server after starting a tunnel. `.env` is still used for genuinely optional configuration — TURN credentials, or a fixed custom domain — see [README.md's environment variables](README.md#environment-variables).

## Terminal 1 — start the app

```powershell
cd D:\LearnThriveSoftware
npm run dev
```

This starts both the Vite frontend (port **5173**) and the signalling server (port **3001**) together. Leave this terminal running for the whole test.

## Terminal 2 — expose it (choose one)

### Option A — Tailscale (recommended)

```powershell
tailscale serve 5173
```

Gives a stable `https://your-laptop-name.your-tailnet.ts.net` address. See [TAILSCALE_TESTING.md](TAILSCALE_TESTING.md) for the full setup and why it's preferred.

### Option B — Cloudflare Quick Tunnel (fallback)

```powershell
cloudflared tunnel --url http://localhost:5173
```

Watch the output for a line containing a generated hostname:

```text
https://some-random-words-1234.trycloudflare.com
```

That's your temporary public HTTPS address — it's normal for it not to serve the app until `npm run dev` (Terminal 1) is already running. A new tunnel session generates a **different** hostname every time; just open whatever it prints, no configuration needed.

Unlike Tailscale, this URL is reachable by **anyone** who has it, not just your own devices — treat it as a deliberate, temporary test and stop the tunnel (`Ctrl+C`) when you're done.

### Same-Wi-Fi fallback (no tunnel at all)

If the laptop and phone are already on the same Wi-Fi network, you can try `http://<laptop's-LAN-IP>:5173` directly from the phone instead of a tunnel — but this plain-HTTP path will likely **not** be allowed to use the camera/microphone on the phone, because it isn't a secure context. Treat this as a fallback only if you understand that limitation; the tunnel (HTTPS) is the reliable path.

## The test

1. Open your chosen URL (the `.ts.net` address, or the `.trycloudflare.com` address) on the **laptop**, in a normal browser window.
2. Enter a display name for the laptop participant, e.g. **Tutor**, then choose **Create meeting** — this makes the laptop the tutor for a freshly-generated room code.
3. Start the class. It should show "Waiting for other participants..." with your own camera preview visible if you enabled it.
4. Choose **Copy Invite Link**.
5. Send that invite URL to the phone (messaging app, email, AirDrop — whatever's convenient). It must be the same tunnel/Tailscale URL, not a `localhost` one.
6. Open the invite link on the **phone**, in its normal browser (not an in-app browser embedded inside a messaging app — those often block camera/microphone access).
7. Grant camera/microphone permission when prompted.
8. Enter a display name for the phone participant, e.g. **Student**, then **Join meeting** — this places the phone in the waiting room, not the call itself.
9. On the **laptop**, open the **Waiting room** control and **Admit** the phone. (This step is real and required — it's not a bug that the phone doesn't appear immediately.)
11. **Confirm remote video both ways**: the laptop should see the phone's live camera, and the phone should see the laptop's live camera (or each other's initials placeholder if camera is off — confirm that too). If either direction fails, go straight to [ASYMMETRIC_VIDEO_TEST.md](ASYMMETRIC_VIDEO_TEST.md).
12. **Confirm remote audio both ways**: speak on the laptop and confirm you can hear it on the phone, then the reverse. **Use headphones** (see above) to avoid feedback while doing this.
13. **Test mute**: mute the laptop's microphone and confirm the phone's UI shows it and can no longer hear the laptop; unmute and confirm audio returns.
14. **Test camera toggle**: turn the laptop's camera off and confirm the phone sees an initials placeholder, not a black frame; turn it back on and confirm live video resumes.
15. **Send chat messages both ways.**
16. **Test the People panel, raise hand, and reactions**: open the People panel on one side and confirm it shows both participants' live mic/camera/hand state; raise a hand and confirm the other side sees a notice and the panel updates; send a reaction and confirm it animates briefly on both sides.
17. **Test Focus and Side-by-side layouts**: click either tile to make it the main view on one device, and switch to Side-by-side from Settings; confirm the other participant's own view is unaffected (layout choice is local/per-device, not synced).
18. **Test screen sharing from the laptop.**
19. **Verify the phone receives the screen share**, letterboxed, with the shared tile automatically becoming the main view; confirm it restores your prior focus/layout choice when sharing stops.
20. **Switch the laptop's camera/microphone** if you have more than one available, and confirm the call is not interrupted.
21. **Test the phone's front/rear camera switch** if the control appears.
22. **Rotate the phone** between portrait and landscape and confirm the layout adapts without overflow or clipped controls, and the local preview never covers the controls, the remote participant's face, or a screen share.
23. **Temporarily disable Wi-Fi** on the phone (or laptop) for 5-10 seconds, then restore it — confirm "reconnecting..." then automatic recovery, not a false "participant left".
24. **Refresh the phone's page** during the active call and confirm it can rejoin cleanly, no ghost participant.
25. **Open a third browser session as another student** (join with the same room code — don't use "Create meeting", which would start a separate class) and confirm it lands in the waiting room, the tutor sees a live waiting-room badge and can admit it from the Waiting room panel, and the existing call is undisturbed until then.
26. **Test room lock**: on the laptop, open **Class controls** and lock the room; from a third device (or a third browser session), try to join with the same room code and confirm it's rejected with a "currently locked" message; unlock it and confirm a new joiner can get in again.
27. **Test force-mute**: from the laptop's People panel, mute the phone's microphone; confirm the phone's mic turns off, its mute button now reads "Muted by tutor", and clicking it shows an explanation rather than turning the mic back on. Allow it to unmute again from the People panel and confirm the phone can now turn its own mic back on.
28. **Test a quick poll**: create a two-option poll from the laptop's Class controls; confirm the phone sees it immediately as a banner (not tucked in a menu), can vote, and the laptop sees the tally update live; close the poll and confirm both sides show it as closed with frozen results.
29. **Test the Understanding Check**: start one from the laptop; confirm the phone can respond (Got it / Confused / Lost) and sees only its own status, while the laptop sees a live per-student breakdown and aggregate; end the check and confirm the banner disappears on both sides.
30. **Test the class timer**: start a stopwatch from the laptop; confirm the phone sees the same running time next to the meeting duration clock; pause, resume, and stop from the laptop and confirm the phone reflects each change with no controls of its own.
31. **Test a tutor announcement**: send one from the laptop's Class controls (e.g. "5 minutes remaining"); confirm the phone sees a distinct, prominent banner — not a chat message — and it disappears on its own after a few seconds.
32. **Test the Help Queue**: raise the phone's hand; confirm the laptop sees a Help Queue banner naming the student with a live elapsed time; mark it helped from the laptop and confirm the phone's own hand-raise button reflects it as lowered (not just the laptop's view of it).
33. **Test the whiteboard (Board mode)**: switch both devices to Board (the tab in the header, or `W` on the laptop). Draw a shape on the laptop and confirm it appears on the phone within about a second. Draw on the phone (touch) if the tutor allows student drawing, and confirm the laptop sees it. Turn off "Students can draw" from the laptop and confirm the phone's board becomes view-only with an explanatory badge, but can still pan/zoom. Create a second page from the laptop and confirm both devices see the new tab; switch pages and confirm the phone (if following) follows automatically, and can stop following to browse independently. Try the laser pointer and confirm the other device sees it moving. Export a PNG from the laptop and confirm a file downloads.
34. **Test Present mode**: start a screen share from the laptop; confirm both devices automatically switch to Present, and confirm switching back to Call/Board manually still works while the share continues.
35. **Leave the call** from one side using the Leave button, confirm the in-app confirmation prompt (not a native browser popup), and confirm the ended screen offers Rejoin / Return to meeting setup / Copy meeting link.
36. **Rejoin** using the same invite link/room code and confirm no ghost participant remains.
37. **Test "End class"**: with both devices back in a call, end the class from the laptop (tutor) side; confirm the laptop's own confirmation prompt reads "End class for everyone?" (not the ordinary "Leave the meeting?"), and confirm the phone lands on a distinct "The tutor ended the class" screen with no Rejoin option, not the ordinary "you've left" screen.

## TURN relay test (if a Cloudflare TURN key is configured)

See **[TURN_TESTING.md](TURN_TESTING.md)** for the full procedure. In short: append `?forceTurn=1&debug=1` to both devices' URLs before joining, confirm the call still connects (proving the relay actually works, not just that it's configured), and check the diagnostics panel shows "Relay (TURN)" as the candidate path with real RTT/packet numbers. This step needs a configured `CLOUDFLARE_TURN_KEY_ID`/`CLOUDFLARE_TURN_API_TOKEN` pair — skip it (and note that it was skipped, not passed) if none is configured.

## Per-browser results

Fill these in as you actually run them — don't check a box you haven't tested.

**Phone browsers:**

- [ ] Android Chrome
- [ ] Samsung Internet (if the phone has it)
- [ ] iPhone Safari (if a second device is available)

**Laptop browser used for this test:** ____________________

## Debug mode inspection

Open `?debug=1` appended to the URL on either device to see the development diagnostics panel. See [ASYMMETRIC_VIDEO_TEST.md](ASYMMETRIC_VIDEO_TEST.md) for exactly which fields to compare if video is asymmetric; otherwise, sanity-check connection state, ICE candidate type (`host`/`srflx`/`relay`), RTT, and packet loss against how the call actually sounded/looked.

## When you're done

Stop the app (`Ctrl+C` in Terminal 1) and the tunnel (`Ctrl+C` in Terminal 2, if used). A Quick Tunnel session generates a new hostname next time; a Tailscale Serve address stays the same.

Record your actual results — including anything that didn't work — in [TESTING.md](TESTING.md)'s test matrix. Don't mark a row as passed unless you actually performed that exact check.
