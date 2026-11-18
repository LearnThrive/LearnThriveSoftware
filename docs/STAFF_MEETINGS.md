# Staff meetings

Administrators and tutors can meet on video in the same room a lesson uses, with no lesson attached. Built on 18 November 2026.

## How it works

- **Where:** *Meetings* in the menu (administrators and tutors; junior tutors too, unless they are also students, see below).
- **Who sets one up:** an administrator only. A title, a date and time (London time) and a length, or **Start now** for an instant meeting that goes straight into the room.
- **Who can be invited:** administrators and tutors with a working login. Never a parent, and never anyone who also holds the **Student** role (a learner may be under 18, and a staff meeting is for adults). This includes a junior tutor who is also a student. To include such a person, the administrator removes their Student role on the Roles screen.
- **Who can join:** the host and the invited people only, checked again at the moment of joining (`lib/meetings/rules.ts`, `decideEntry`). A cancelled meeting admits nobody. The host can enter 30 minutes before the start and everyone else 10 minutes before, until 30 minutes after the planned end: the same window as a lesson.
- **In the room:** the host is the room's "tutor" (admits people from the waiting room, can end the meeting for everyone, mute, share). Everyone else waits to be admitted. Up to 4 people at once with the peer-to-peer mesh, up to 11 with the Cloudflare video server configured.
- **Chat:** a plain relay between the people in the room. It is **not saved** and is not the lesson chat (which keeps a record). A meeting's join token carries `kind: "meeting"`, which is how the classroom server knows not to ask the lesson chat gate.
- **Cancel:** the host or any administrator. The meeting is kept and marked, never deleted.

## Data

Migration `0028_staff_meetings.sql`: `staff_meetings` and `staff_meeting_invitees`. Server only (RLS on and forced, no grant to the API roles). People are stored as sign-in ids plus the name at the time, so a meeting record does not depend on anyone's profile surviving. Code: `packages/data/src/meetings/`.

## Known limits

- The video room still labels the host "tutor" and invitees "students" in a few places, and the end screen says "class".
- There is no email or calendar invitation yet. Invited people see the meeting under *Meetings*.
- The classroom server still accepts a join without a signed link (a development convenience that also exists for lessons). Rooms are unguessable and the host admits everyone from the waiting room, but see the owner's note about requiring the signed link in production.
