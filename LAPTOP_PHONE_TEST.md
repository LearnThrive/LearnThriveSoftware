# Laptop to Phone Test

A step-by-step guide for testing a real call between this laptop and a phone. This has **not** been performed as part of this build — it requires you, a second physical device, and (optionally) `cloudflared`. Record your actual results in [TESTING.md](TESTING.md)'s test matrix; don't mark rows as passed until you've genuinely run them.

## What you need

- This laptop, with the project installed (`npm install` already run).
- A phone (or any second physical device) on the same or a different network.
- Optionally, [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) installed, if you want to test across two different networks (e.g. laptop on Wi-Fi, phone on mobile data) rather than the same LAN. This project does not install it for you.

## Terminal 1 — start the app

```powershell
cd D:\LearnThriveSoftware
npm run dev
```

This starts both the Vite frontend (port **5173**) and the signalling server (port **3001**) together. Leave this terminal running for the whole test.

## Terminal 2 — start the tunnel (if using one)

If Cloudflare Tunnel is installed:

```powershell
cloudflared tunnel --url http://localhost:5173
```

Watch the output for a line containing a generated hostname that looks like:

```text
https://some-random-words-1234.trycloudflare.com
```

That `https://....trycloudflare.com` URL is your temporary public HTTPS address. It's normal for it not to serve the app until `npm run dev` (Terminal 1) is already running. A new tunnel session generates a **different** hostname every time — don't reuse an old one.

If your laptop and phone are already on the **same Wi-Fi network**, you can skip the tunnel and instead try `http://<your-laptop's-LAN-IP>:5173` directly from the phone — but note the important caveat in [Localhost and HTTPS behaviour](#localhost-and-https-behaviour) below: this plain-HTTP path will likely **not** be allowed to use the camera/microphone on the phone, because it isn't a secure context. The tunnel (HTTPS) is the reliable path; treat the direct-LAN-IP approach as a fallback only if you understand that limitation.

If you use the tunnel, set the exact hostname before continuing:

1. In `D:\LearnThriveSoftware`, create `.env` from `.env.example` if it doesn't already exist (`Copy-Item .env.example .env`).
2. Edit `.env` and set `TUNNEL_HOST` to your **exact generated hostname**, with no `https://`, no port, no path:

   ```dotenv
   TUNNEL_HOST=some-random-words-1234.trycloudflare.com
   ```

3. Restart `npm run dev` (Terminal 1: `Ctrl+C`, then run it again) so Vite picks up `TUNNEL_HOST`.

## The test

1. Open the tunnel URL (`https://....trycloudflare.com`) on the **laptop**, in a normal browser window (not the one running any previous test session).
2. Create a meeting.
3. Enter a display name for the laptop participant, e.g. **Tutor**.
4. Join the meeting. It should show "Waiting for another participant..." with your own camera preview visible if you enabled it.
5. Choose **Copy Invite Link**.
6. Send that invite URL to the phone (e.g. via a messaging app, email, or AirDrop — whatever's convenient). It must be the **tunnel** URL, not a `localhost` one.
7. Open the invite link on the **phone**, in its normal browser (not an in-app browser embedded inside a messaging app — those often block camera/microphone access).
8. Grant camera/microphone permission when prompted.
9. Enter a display name for the phone participant, e.g. **Student**.
10. Join.
11. **Confirm remote video both ways**: the laptop should see the phone's live camera, and the phone should see the laptop's live camera (or each other's initials placeholder if camera is off — confirm that too).
12. **Confirm remote audio both ways**: speak on the laptop and confirm you can hear it on the phone, then the reverse. Use headphones or enough physical separation to avoid echo.
13. **Test mute**: mute the laptop's microphone and confirm the phone's UI shows it and can no longer hear the laptop; unmute and confirm audio returns.
14. **Test camera toggle**: turn the laptop's camera off and confirm the phone sees an initials placeholder, not a black frame; turn it back on and confirm live video resumes.
15. **Send chat messages both ways**: type a message on the laptop, confirm it appears on the phone (and shows an unread badge if the phone's chat panel is closed); reply from the phone and confirm the laptop receives it.
16. **Test screen sharing from the laptop**: click Share Screen on the laptop and choose a window or the whole screen.
17. **Verify the phone receives the screen share**: the phone's main tile should switch to the laptop's shared screen, letterboxed (not cropped), with a "presenting" indicator. Stop sharing (either the in-app button or the browser's native "Stop sharing" control) and confirm the laptop's camera returns on the phone's screen.
18. **Switch the laptop's camera/microphone** if you have more than one available (via the Devices menu) and confirm the call is not interrupted.
19. **Test the phone's front/rear camera switch** if the control appears (it only shows up when the phone reports more than one camera).
20. **Rotate the phone** between portrait and landscape and confirm the layout adapts without overflow or clipped controls.
21. **Temporarily disable Wi-Fi** on the phone (or laptop) for 5-10 seconds.
22. **Restore Wi-Fi**.
23. **Confirm recovery**: the other participant should show "reconnecting..." during the gap, then recover automatically — not an immediate false "participant left", and not a frozen UI.
24. **Refresh the phone's page** during the active call.
25. **Confirm rejoin works**: the phone should return to the pre-join screen and be able to rejoin the same room; the laptop should detect the phone's departure and then its return without anything getting stuck.
26. **Open a third browser session** (e.g. a third device, or an incognito window on the laptop) and try to join the same room.
27. **Confirm third-participant rejection**: it should see "This meeting already has two participants." and the original two-person call should be undisturbed.
28. **Leave** the call from one side.
29. **Rejoin** using the same invite link/room code.
30. **Confirm no ghost participant remains** — the rejoining side should reach a clean waiting/connected state, not get stuck or see a stale "participant left" about itself.

## Debug mode inspection

Open `?debug=1` appended to the URL on either device (e.g. `https://your-tunnel-url.trycloudflare.com/meeting?room=xxxx&debug=1`) to see a development diagnostics panel. Inspect in particular:

- **Connection state** — WebRTC connection state and ICE connection state, separate from whether Socket.IO itself is connected.
- **ICE state** — should reach `connected` or `completed` for a working call.
- **Candidate type** — whether the active path is `host` (direct, same network), `srflx` (STUN, direct across NAT), or `relay` (TURN). On most home/mobile-data combinations without a configured TURN server, expect `srflx`; if the call fails to connect at all on a restrictive network, that's often because no TURN relay is configured (this project doesn't provision one — see [README.md](README.md#ice-and-optional-turn)).
- **RTT** and **packet loss** — sanity-check these against how the call actually sounded/looked.

Compare the diagnostics panel on both devices side by side, since each side reports its own view of the connection.

## When you're done

Stop the app (`Ctrl+C` in Terminal 1) and the tunnel (`Ctrl+C` in Terminal 2, if used). A future Quick Tunnel session generates a new hostname, so you'll need to update `.env` and restart `npm run dev` again next time.

Record your actual results — including anything that didn't work — in [TESTING.md](TESTING.md)'s test matrix. Don't mark a row as passed unless you actually performed that exact check.
