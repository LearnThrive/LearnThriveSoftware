# Staff meetings

Administrators and tutors can meet on video in the same room a lesson uses, with no lesson attached. Built on 18 November 2026.

## How it works

- **Where:** *Meetings* in the menu (administrators and tutors; junior tutors too, unless they are also students, see below).
- **Who sets one up:** an administrator only. A title, a date and time (London time) and a length, or **Start now** for an instant meeting that goes straight into the room.
- **Who can be invited:** administrators and tutors with a working login. Never a parent, and never anyone who also holds the **Student** role (a learner may be under 18, and a staff meeting is for adults). This includes a junior tutor who is also a student. To include such a person, the administrator removes their Student role on the Roles screen.
- **Who can join:** the host and the invited people only, checked again at the moment of joining (`lib/meetings/rules.ts`, `decideEntry`). A cancelled meeting admits nobody. The host can enter 30 minutes before the start and everyone else 10 minutes before, until 30 minutes after the planned end: the same window as a lesson.
- **In the room:** the host is the room's "tutor" (admits people from the waiting room, can end the meeting for everyone, mute, share). Everyone else waits to be admitted. Up to 4 people at once with the peer-to-peer mesh, up to 11 with the Cloudflare video server configured.
- **Chat:** a plain relay between the people in the room. It is **not saved** and is not the lesson chat (which keeps a record). A meeting's join token carries `kind: "meeting"`, which is how the classroom server knows not to ask the lesson chat gate.
- **Mute:** in a meeting the host's mute switches the person's microphone off once and does **not** lock it: they can turn it back on themselves. (In a lesson, a tutor's mute stays locked until the tutor allows an unmute.) The server decides from the room, which is marked a meeting by a verified join token (`room.meeting`).
- **Cancel:** the host or any administrator. The meeting is kept and marked, never deleted.

## Inside the room (meetings and lessons)

- **Sound** is played by one hidden audio element per person (`components/RemoteAudio.tsx`), mounted all the time, so switching to the whiteboard or a shared screen never silences anyone. If the browser blocks sound until the page is clicked, a "Turn on sound" button appears.
- **Shared screen** is shown in the room itself (`components/ScreenStage.tsx`), not as a full-page takeover. It travels on its **own video track beside the camera** (a third line that is always negotiated and idle until someone shares: `peer.ts` for the mesh, `sfu.ts` for Cloudflare), so the cameras stay visible. No server change was needed: the server already accepts extra named tracks.
- **Cameras on the right** (`components/StageRail.tsx`): one column, equal size, students on top and the tutor (the host of a meeting) below. The same layout for the shared screen and for the whiteboard.
- **Drawing on a shared screen** (`components/ScreenAnnotations.tsx`): the tutor can draw, write and add equations on top of whatever is shared (a past paper, a slide). It is the whiteboard's own drawing tool on a transparent layer whose coordinates are the shared screen's own pixels, so a mark lands on the same spot for everybody. Tutor only (the server refuses anyone else, `annotation:update`), only while a screen is shared, and it is cleared when the share ends. Held in memory on the server (`room.annotations`), never stored.
- **Equations** (`components/EquationDialog.tsx`, `math.ts`): LaTeX with a live preview, symbol palettes (structure, operators, Greek, calculus, geometry and trigonometry, sets and logic, science), and ready-made formulas. MathJax (already a dependency) typesets it to SVG in the browser; chemistry (`\ce{...}`, `\pu{...}`), physics, `\cancel`, degrees and matrices are included. An equation is an image element whose LaTeX is stored in the element (`customData.latex`): only that small element is shared, and every browser draws the picture itself, so late joiners see it too. Available on the whiteboard (tutor, Insert menu) and on the drawing layer.

## Data

Migration `0028_staff_meetings.sql`: `staff_meetings` and `staff_meeting_invitees`. Server only (RLS on and forced, no grant to the API roles). People are stored as sign-in ids plus the name at the time, so a meeting record does not depend on anyone's profile surviving. Code: `packages/data/src/meetings/`.

## Known limits

- The video room still labels the host "tutor" and invitees "students" in a few places, and the end screen says "class".
- Only a tutor (the host, in a meeting) can draw on a shared screen. An invitee who shares their screen cannot mark it up themselves.
- A shared screen and its drawing are tested in the peer-to-peer path with real browsers, and the Cloudflare path with a fake connection (`tests/classroomSfu.test.mjs`). The Cloudflare path has **not** been run against the real service: try a share with the camera on, in a room with Cloudflare configured, before relying on it.
- There is no email or calendar invitation yet. Invited people see the meeting under *Meetings*.
- The classroom server still accepts a join without a signed link (a development convenience that also exists for lessons). Rooms are unguessable and the host admits everyone from the waiting room, but see the owner's note about requiring the signed link in production.
