# Classroom Features

A feature-by-feature reference for the moderation, room-lock, polls, understanding-check, and class-timer capabilities added on top of the base 1-tutor/3-student meeting. See [README.md](README.md#classroom-moderation-polls-understanding-checks-and-the-class-timer) for a narrative overview and [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md) for what this does *not* cover.

"Server-enforced" means the server itself checks and rejects a bad request regardless of what the client does. "Client directive" means the server tells a client what to do and trusts it to comply — a modified client could ignore it. See [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md#abuse-and-safety) for why force-mute and stop-share can only ever be directives in this pure P2P (non-SFU) architecture.

| Feature | Tutor | Student | Enforcement | Tested |
| --- | --- | --- | --- | --- |
| Room lock | Toggle on/off (Class controls) | Blocked from joining while locked; already-admitted participants unaffected | Server-enforced (rejects `room:join` while `settings.locked`) | Server + Playwright |
| Waiting-room Deny | Deny a specific waiting student | Sent back to pre-join with an explanation | Server-enforced | Server + Playwright |
| Force-mute (one) | Mute / allow-unmute a specific student | Mic disabled; cannot self-unmute while muted | Client directive (target's own client calls its existing mute path) | Server + Playwright |
| Mute all | Force-mutes every current student at once (never the tutor) | Same as force-mute, applied to all | Client directive | Server + Playwright |
| Remove participant | Immediately disconnects a student, bypassing the reconnect grace period, and bans their display name from rejoining this room until the tutor allows it again (Class controls → Removed students) | Sees a "removed from class" screen, no Rejoin option; a rejoin attempt under the same name is rejected with a clear message | Server-enforced (participant deleted from the room; ban is by name, not identity — this app has no accounts, so it's bypassed by a different name, same honest limit as every other role check here) | Server |
| Screen-share: allow/disallow for students | Toggle (Class controls) | Blocked from starting a share while disallowed (already-sharing unaffected) | Server-enforced | Server + Playwright |
| Screen-share ownership | Can stop any student's active share | Blocked from sharing while someone else is; own share can be force-stopped | Server-enforced (`activeScreenShareId` arbitration — a new resource, not a pre-existing trust boundary) | Server + Playwright |
| Chat: allow/disallow for students | Toggle (Class controls) | Input disabled with an explanatory placeholder while disallowed | Server-enforced | Server + Playwright |
| Chat: delete a message | Delete any message | Message disappears on both sides | Pure relay — chat was never stored server-side, so this is a broadcast filter-by-id, not a database operation | Server + Playwright |
| Chat: clear all | Clears the whole chat for everyone | Chat empties | Pure relay | Server + Playwright |
| Lower a raised hand | Lower any student's hand | Hand lowers on both sides | Server-enforced (broadcasts to the target too, unlike the self-report raise) | Server |
| Quick polls | Create (2–6 options, optional anonymity, results-visibility choice), see live results, close, clear | Vote (can change vote until closed), see own vote always, see results per the tutor's visibility choice | Personalized per-recipient broadcast — anonymous voters are hidden even from the tutor; a non-anonymous poll's voter list is tutor-only | Server + Playwright |
| Understanding Check | Start, see live per-student status and an aggregate, end | Respond (Got it / Confused / Lost), see only their own status, never anyone else's or the aggregate | Personalized per-recipient broadcast, deliberately asymmetric to avoid peer-pressure/comparison dynamics on what's meant to be a private signal | Server + Playwright |
| Class timer | Start (stopwatch or countdown), pause, resume, stop | Sees the same running display, no controls | Server broadcasts only state transitions (start/pause/resume/stop); each client ticks its own local display between them, never a per-second network message | Server + Playwright |
| Tutor departure ("End class") | Their own Leave always ends the class (copy-only distinction — there's exactly one tutor) | Every admitted participant *and* every still-waiting student gets a distinct `room:ended` signal (not the ordinary "left" notice), with no Rejoin option | Server-enforced (`leaveNow`'s tutor branch tears the room down and notifies both groups) | Server + Playwright |
| Reconnect resync | — | A participant recovering a brief disconnect is resent their full current state (force-mute, settings, poll, understanding check, timer, or a room that was deleted while they were offline), not just told "reconnected" | Server-enforced (`resendJoinedState` reused for both a duplicate join and the `socket.recovered` path) | Server |
| Role badge | Shown on every camera-off avatar tile and every People-panel row | Same | Display only | Server (role) + Playwright (badge) |
| ❓ reaction | Available to everyone (6th emoji, alongside 👍❤️😂🎉👏) | Same | Same as existing reactions (rate-limited, ephemeral) | Server |
| Raise-hand `H` shortcut | Same as clicking Raise/Lower hand | Same | Client-side keybinding | Playwright |
| Workspace modes (Call / Board / Present) | Switches freely (also `W` to toggle Board); a share auto-surfaces Present for everyone, restoring the prior mode when it ends | Same | Client-side only — media, chat, polls, and board state all live outside the switched view, so nothing is torn down on a mode change | Playwright |
| Collaborative whiteboard | Full control: pages, backgrounds, drawing permission, clear, import; can draw always regardless of the permission toggle | Draws when permitted; always can pan/zoom/view and follow the tutor's page | See the **Whiteboard** section below and [WHITEBOARD_ARCHITECTURE.md](WHITEBOARD_ARCHITECTURE.md) | Server + Playwright |
| Screen-share audio | Tab/system audio (where the browser offers it) is mixed with the mic, not swapped for it | Same capability, subject to the screen-share policy above | Client-side (Web Audio mixing); the browser's own picker remains authoritative over source/audio choice | Manual only — no automated harness for real screen capture |
| Cloudflare Realtime TURN | Not tutor-specific — configured once per deployment via server-only credentials | Same | Server-generated temporary credentials (`GET /api/turn-credentials`); see [TURN_TESTING.md](TURN_TESTING.md) | Server (fallback path only — no live Cloudflare account in this build) |
| Tutor announcement | Send a short prominent message to everyone; a new one replaces the last | Sees it as a distinct banner, never mixed into chat | Server-enforced (tutor-only), auto-expires server-side after 15s so it disappears in sync for everyone | Server + Playwright |
| Help Queue | Sees every raised hand ordered by time raised, with live elapsed time, and can mark one helped (lowers it) | Not shown (tutor-only view) | Builds on the existing raise-hand signal; ordering key (`handRaisedAt`) is a real server timestamp on join/resync, client-approximated for live updates (fine for a UI-only elapsed-time display) | Server + Playwright |

## Capacity

Still exactly 1 tutor + up to 3 students (4 participants max) — an explicit correction to an earlier draft spec that assumed 10 students behind a Cloudflare Realtime SFU. The SFU migration is not attempted in this pass because its stated justification ("a full mesh is unacceptable at 11 participants") does not hold at 4; see [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md#classroom-v2--deferred-to-future-initiatives).

## Whiteboard

A first-class **Board** workspace mode (alongside Call and Present), built on `@excalidraw/excalidraw`. See **[WHITEBOARD_ARCHITECTURE.md](WHITEBOARD_ARCHITECTURE.md)** for the full sync design; in short:

- **Multiple pages** per class — create, rename, duplicate, reorder, delete, switch, each with its own background (blank, lined, grid, dotted, coordinate — rendered as CSS behind a transparent canvas, never as real board elements).
- **Real-time collaborative drawing**, reconciled by element version/versionNonce (the same merge rule Excalidraw's own collaboration reference implementation uses) so a stale update can never overwrite a newer one, and applied with `captureUpdateAction: NEVER` so a remote peer's edit can never end up on your own undo stack.
- **Tutor-gated student drawing** — a permission toggle backed by Excalidraw's own view-mode locally, with the server as the actual authority (a disallowed student's mutation is rejected server-side regardless of client state).
- **Follow Me** — students follow the tutor's active page by default and can stop following locally at any time (a pure local choice, no server round-trip); the tutor can nudge everyone back with one click.
- **Cursor and laser pointer** via Excalidraw's own native collaborator rendering — both throttled client-side and rate-limited server-side as a backstop.
- **Tutor-only page clear** (with a confirmation) and **JSON import** (replaces a page outright, validated for size/shape server-side).
- **PNG/JSON export** (client-side only, never persisted anywhere).
- **Reconnect resync** — a full board snapshot (every page's elements) is resent alongside the rest of the room state.
- Three lightweight **tutoring shortcuts** (number line, coordinate axes, fraction bar) insert pre-built Excalidraw elements rather than requiring freehand drawing.

**Known gap:** renaming a page requires a double-click on its tab — there's no keyboard-only equivalent yet. See [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md).

## Explicitly out of scope this pass

- **Cloudflare Realtime SFU migration** — no Cloudflare account/credentials exist for this build, and isn't justified at the current 4-participant capacity anyway. (The TURN credential-generation path *is* now implemented against Cloudflare's Realtime TURN service — a different, much smaller piece of the same platform — see [TURN_TESTING.md](TURN_TESTING.md).)
- **Recording, transcripts, AI summaries, private DMs, breakout rooms, billing, persistent student records, a homework platform, a parent portal, permanent authentication, or full scheduling** — see [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md) for why each is a later-phase concern, not a gap in this pass.
