# Classroom Features

A feature-by-feature reference for the moderation, room-lock, polls, understanding-check, and class-timer capabilities added on top of the base 1-tutor/3-student meeting. See [README.md](README.md#classroom-moderation-polls-understanding-checks-and-the-class-timer) for a narrative overview and [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md) for what this does *not* cover.

"Server-enforced" means the server itself checks and rejects a bad request regardless of what the client does. "Client directive" means the server tells a client what to do and trusts it to comply — a modified client could ignore it. See [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md#abuse-and-safety) for why force-mute and stop-share can only ever be directives in this pure P2P (non-SFU) architecture.

| Feature | Tutor | Student | Enforcement | Tested |
| --- | --- | --- | --- | --- |
| Room lock | Toggle on/off (Class controls) | Blocked from joining while locked; already-admitted participants unaffected | Server-enforced (rejects `room:join` while `settings.locked`) | Server + Playwright |
| Waiting-room Deny | Deny a specific waiting student | Sent back to pre-join with an explanation | Server-enforced | Server + Playwright |
| Force-mute (one) | Mute / allow-unmute a specific student | Mic disabled; cannot self-unmute while muted | Client directive (target's own client calls its existing mute path) | Server + Playwright |
| Mute all | Force-mutes every current student at once (never the tutor) | Same as force-mute, applied to all | Client directive | Server + Playwright |
| Remove participant | Immediately disconnects a student, bypassing the reconnect grace period | Sees a "removed from class" screen, no Rejoin option | Server-enforced (participant deleted from the room) | Server + Playwright |
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

## Capacity

Still exactly 1 tutor + up to 3 students (4 participants max) — an explicit correction to an earlier draft spec that assumed 10 students behind a Cloudflare Realtime SFU. The SFU migration is not attempted in this pass because its stated justification ("a full mesh is unacceptable at 11 participants") does not hold at 4; see [PRODUCTION_GAPS.md](PRODUCTION_GAPS.md#classroom-v2--deferred-to-future-initiatives).

## Explicitly out of scope this pass

- **Cloudflare Realtime SFU migration** — no Cloudflare account/credentials exist for this build, and isn't justified at the current 4-participant capacity anyway.
- **Collaborative whiteboard** — a standalone subsystem (new dependency, its own sync protocol, pages, permissions, backgrounds, follow-mode, laser pointer, export/import) comparable in size to everything in the table above combined; deferred to its own dedicated pass.
