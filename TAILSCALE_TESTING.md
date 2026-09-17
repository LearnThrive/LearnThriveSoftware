# Tailscale Testing (recommended)

The recommended, repeatable way to test a real call between this laptop and a phone. Unlike a Cloudflare Quick Tunnel, a Tailscale hostname is **stable across restarts** (tied to your device, not regenerated every session), so you don't have to re-copy a URL every time you restart the dev server. Both the laptop and the phone need to be on the same [Tailscale](https://tailscale.com/) network (tailnet) — install the app on both and sign in with the same account.

No `.env` edit is required for this. `shared/allowedHosts.ts` already allows any hostname ending in `.ts.net` (Tailscale's MagicDNS/Serve suffix), so Vite and the signalling server accept it automatically.

## Prerequisites

- Tailscale installed and signed in on **this laptop**: [tailscale.com/download](https://tailscale.com/download).
- Tailscale installed and signed in on **the phone**, using the **same Tailscale account/tailnet**.
- MagicDNS enabled for the tailnet (it's on by default for new tailnets) — check the [Tailscale admin console](https://login.tailscale.com/admin/dns) if you're not sure.

## Terminal 1 — start the app

```powershell
cd D:\LearnThriveSoftware
npm run dev
```

Leave this running for the whole test. This starts Vite (port 5173) and the signalling server (port 3001) together.

## Terminal 2 — serve it over Tailscale

```powershell
tailscale serve 5173
```

This serves the local Vite dev server over HTTPS to devices on your tailnet, at a stable address like:

```text
https://your-laptop-name.your-tailnet.ts.net
```

Tailscale prints the exact URL when you run the command above; you can also check it any time with:

```powershell
tailscale serve status
```

To run it in the background instead of keeping the terminal open, use `tailscale serve --bg 5173`. To stop serving, use `tailscale serve reset`. Flag names have changed slightly across Tailscale CLI versions — if the command above doesn't match what you see, run `tailscale serve --help` for the exact syntax on your installed version.

**This exposes the dev server to your tailnet only** (devices signed into the same Tailscale account/network), not the public internet — unlike a Cloudflare Quick Tunnel, there's no world-open URL to worry about leaving running.

## The test

1. On the **laptop**, open `https://your-laptop-name.your-tailnet.ts.net` (the exact URL from `tailscale serve status`).
2. Create a meeting, enter a display name (e.g. **Tutor**), prepare your camera/microphone, and join.
3. Choose **Copy Invite Link**. It will automatically use the current page's origin — the `.ts.net` URL — with no manual editing needed.
4. Send that link to the phone (message, email, whatever's convenient) and open it there, in the phone's normal browser (not an in-app browser embedded inside a messaging app).
5. Grant camera/microphone permission, enter a display name (e.g. **Student**), and join.
6. Follow the full checklist in [LAPTOP_PHONE_TEST.md](LAPTOP_PHONE_TEST.md#the-test) from step 11 onward (video both ways, audio both ways, mute, camera toggle, chat, screen share, device switching, rotation, network drop, refresh/rejoin, third participant, leave/rejoin).
7. If either side can't see the other's video, follow [ASYMMETRIC_VIDEO_TEST.md](ASYMMETRIC_VIDEO_TEST.md) to capture the exact `?debug=1` diagnostics from both devices.

## Why this over a Quick Tunnel

- **Stable URL.** A Cloudflare Quick Tunnel generates a brand-new random hostname every time it restarts; a Tailscale Serve URL stays the same across restarts (it's tied to your device name and tailnet), so you don't need to re-copy it or touch any configuration between test sessions.
- **Private by construction.** Only devices signed into your tailnet can reach it — there's no publicly guessable URL, unlike a Quick Tunnel which anyone with the link can open.
- **No `.env` editing**, same as the Quick Tunnel path now (see [LAPTOP_PHONE_TEST.md](LAPTOP_PHONE_TEST.md)) — both are handled by the same `.ts.net` / `.trycloudflare.com` suffix allowlist in `shared/allowedHosts.ts`.

Cloudflare Quick Tunnel remains documented as a fallback in [LAPTOP_PHONE_TEST.md](LAPTOP_PHONE_TEST.md) for a quick one-off test on a device that isn't on your tailnet, or if Tailscale isn't installed.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Phone can't open the `.ts.net` URL | Confirm the phone's Tailscale app is running and signed into the **same account/tailnet** as the laptop; confirm MagicDNS is enabled |
| `tailscale serve` command not found | Tailscale isn't installed, or an older version doesn't have `serve` yet — update to a current release |
| Vite blocks the `.ts.net` host | Shouldn't happen — `shared/allowedHosts.ts` allows any `.ts.net` suffix. If it does, confirm `npm run dev` was restarted after pulling the latest code |
| Works on the laptop but the phone gets a certificate warning | Tailscale issues real HTTPS certificates for `.ts.net` addresses automatically the first time `serve` runs; wait a few seconds and retry, or check `tailscale cert` status |

## Optional future direction — a named domain

For longer-term or non-Tailscale-network testing, a small **named** Cloudflare Tunnel (e.g. something like `video-test.learnthrivetuition.co.uk`, pointed only at this dev server) is a possible future addition — that would use the existing `TUNNEL_HOST` environment variable (see [README.md](README.md#environment-variables)) instead of the suffix allowlist, since a named domain isn't one of the auto-allowed dev-tunnel suffixes. This has **not** been set up: it would require creating a Cloudflare Tunnel and DNS record for that subdomain, which is a deliberate infrastructure change outside this prototype's scope and has not been made against the live LearnThrive domain.
