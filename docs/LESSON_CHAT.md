# Lesson chat and file sharing

Tutors and students exchange messages and files **only inside a lesson, and only during that lesson's scheduled time.** There is no other tutor-to-student messaging channel anywhere in the product.

Every rule below is enforced on the server, on every send, from the HTTP routes and from the classroom's Socket.IO path alike. The browser never decides who may send, which lesson a message belongs to, or when.

## What belongs to what

A message and a file belong to one **lesson instance**: one row in `lessons`. Each occurrence of a recurring lesson is its own row, so it has its own conversation and its own window.

## Who may send (`packages/data/src/lessonChat/policy.ts`, `canSend`)

Decided by the person's **relationship to this lesson**, never by role alone, and checked in this order so a refusal reveals no more than the person may know:

1. **Relationship.** The lesson's own tutor (the tutor record their `TUTOR` role stands on equals the lesson's tutor; an administrator who also teaches counts, as the tutor) or a student enrolled in it (the student record their `STUDENT` role stands on is on the lesson). A tutor of another lesson, or a student of another lesson, is refused. A person with several roles is checked with each role's own record.
2. **Junior tutors cannot send at all, for now** (`JUNIOR_TUTOR_CANNOT_SEND`), not messages and not files, even in a lesson they are assigned to. *TODO(supervision):* when the supervision rules exist (a tutor overseeing a junior's messages), decide in `canSend` what a junior may send and who sees it. They can read their assigned lesson's chat.
3. **Parents and the safeguarding lead only read.** An **administrator** may also send (see "Administrators" below).
4. **Not on a cancelled or no-show lesson,** and not on a lesson with no usable schedule.
5. **Only inside the scheduled window:** from the scheduled start up to, not including, the scheduled end, in Europe/London. The schedule is stored as an instant, so daylight saving cannot move it (a 17:00 summer lesson is 16:00Z). Students may reply anywhere inside the same window.

The grace window is configuration, default **0 minutes either side** (`LESSON_CHAT_GRACE_BEFORE_MINUTES`, `LESSON_CHAT_GRACE_AFTER_MINUTES`, each 0 to 60). A wrong value is an error, never a silent default.

## Administrators (migration 0032)

An administrator can step into any lesson's chat to sort out a problem, **without joining the classroom**: the lesson page's "Lesson chat" card shows
them the message box. They can also message from inside the classroom while supervising (see `docs/CLASSROOM_INTEGRATION.md`).

- They send **as an administrator** (`sender_party = 'admin'`, the record is their own account). The lesson page labels the message "administrator"
  and the classroom shows "Name (administrator)", so the tutor and the students always know who is speaking.
- **At any time**, not only during the lesson (a problem does not keep to the timetable), on any lesson that is **not cancelled**. The thread is the
  assignment's, so the message is there for the tutor and students at their next lesson too.
- An administrator who is also the lesson's tutor sends as its tutor while the lesson is on, and as an administrator otherwise.
- The database checks it by itself (`private.lesson_messages_guard`): only someone holding `ADMIN` can send as an administrator, and only as
  themself. The tutor and student rules are unchanged.

## Who may read (`canRead`)

| Reader | When | Audited |
| --- | --- | --- |
| The lesson's tutor, its junior tutor, a student on it | any time | no |
| A parent of a student on the lesson (own child only) | **afterwards** only, once the scheduled end has passed; read-only | yes |
| An administrator | any time | **yes** |
| The safeguarding lead (a linked email in `SAFEGUARDING_LEAD_EMAILS`) | any time | **yes** |
| Anyone else (another child's parent, another tutor or student) | never | n/a |

Every read by a non-participant, every file opened by one, and every removal is written to the append-only access log with who, what and when (`lesson_chat_access_log`).

## Nobody edits or deletes

The repository has no edit and no delete. **Only an administrator removes a message**, and a removal only *marks* it (who, when, why). The lesson's own people and parents then see "Removed by an administrator"; administrators and the safeguarding lead still see what was removed, because it may be evidence. The database refuses an edit or a direct delete for everyone, including the server. (The one exception to "never deleted" is purging a lesson, which takes its messages with it; the purge job must also delete the stored files.) The classroom's old tutor "delete message" and "clear chat" are gone.

## Files (`lessonChat/files.ts`)

- **Type:** png, jpg or pdf only, decided by the file's own first bytes. The name's extension, the claimed type and the bytes must all agree: a program renamed `.png` is refused. SVG, HTML, GIF and zip are refused.
- **Size:** a cap (default 10 MB, `LESSON_CHAT_MAX_FILE_MB`), and a non-empty file. A big upload is refused before it is read when the sender may not send.
- **Names:** a name that could point somewhere (`/`, `\`, `..`, a drive letter, a control character, an encoded dot or slash, a leading dot) is **refused**, not cleaned. Any other name is cleaned and used for display only. The file is **stored under a generated key** (`lessons/<lesson id>/<uuid>.<ext>`) and found by id, so nothing the user sent is in a path.
- **Metadata:** an image's EXIF, GPS, text and time are stripped before storage. A JPEG keeps one thing, its orientation, so a photo of a diagram taken sideways still shows the right way up; everything else in it is rebuilt without. A PDF is refused if it contains JavaScript, launch actions, embedded files or rich media; its metadata is **not** rewritten.
- **Private storage, signed links:** bytes are never public. The web app issues a link valid for 60 seconds, made for one person, one lesson and one file (HMAC). Opening it re-checks the lesson, that the file belongs to *that* lesson, and the person's right to read. Served `nosniff`, with a sandboxing policy, `private, no-store` and `noindex`.
- **Malware scanning hook:** every upload passes through `FileScanner.scan` after validation and before storage; anything but "clean", including a scanner that fails, is refused. The default scanner says everything is clean. *TODO(malware-scan):* plug a real one in at `apps/web/src/lib/lessonChat/runtime.ts`; nothing else changes.

## How the classroom's Socket.IO chat is enforced

The classroom server has no database. For each chat message it posts a signed request to `POST /api/internal/lesson-chat` on the web app and **relays nothing until the web app has said yes**. The request is signed (HMAC over the timestamp and the exact body, stale after a minute) with the secret both apps already share (`CLASSROOM_JOIN_SECRET`), and carries only the lesson and the account id named by the verified join token plus the text. The web app looks the person up fresh (roles and records as they are now) and runs the same service as the HTTP send.

- Only a socket that joined through a lesson link has an identity; a manual-name join cannot chat when a gate is configured.
- The classroom needs `CLASSROOM_WEB_URL` (the web app's address). The live site runs the classroom inside the website, so its own address is used automatically (`apps/web/server.ts`); set it only for a classroom server run apart from the website. With neither, production allows no chat in the classroom; development and tests keep the old unsaved relay so the classroom can be tried alone.

## Where it is in the product

The lesson page has a "Lesson chat" card for everyone connected to the lesson (the panel offers the message box only when the server says this person may send right now). It polls every few seconds. Classroom messages are stored too, but the classroom's own chat panel shows messages only from when a person joined, and sends text only: **files are shared from the lesson page**, not inside the classroom view.

## Storage today, and what is not applied

- **In Postgres (migrations 0027 and 0029).** Messages, file records and the stored file bytes (`lesson_file_objects`, private, no API grants) survive a restart. In production the chat is open whenever the database is set up; `LESSON_CHAT_ENABLED=false` switches it off. File links are signed with `LESSON_FILE_URL_SECRET` (at least 32 characters) when set, otherwise with a key derived from `CLASSROOM_JOIN_SECRET`; with neither, text chat works and uploads are refused. Any document, spreadsheet, slide, image, audio, video, text or zip type the meetings chat allows can be shared (migration 0030): PNG, JPEG and PDF are judged by their bytes and cleaned; every other type is judged by its extension, kept as sent and served only as a download, and a file that starts like a program is refused. Development and tests use memory and are always open.
- **One conversation per assignment.** A weekly lesson is one assignment with a lesson row per week. Its chat and files are one thread (`thread_id` = the assignment), so everything sent in the first lesson is there in every later one. Sending is still allowed only in that occurrence's own scheduled time and only to its tutor and students; anyone on a later occurrence reads the whole thread. Purging a lesson removes its messages (migration 0018 behaviour).
- **Written as files, applied nowhere:** `supabase/migrations/0027_lesson_chat.sql` creates `lesson_messages`, `lesson_files` and `lesson_chat_access_log`, with guards the database enforces by itself (who may send, the outer time limit, no edit or delete, removal by an administrator only, append-only log) and row-level security (participants read; a parent only after the lesson; **no policy for administrators**, who read through the server so every read is audited; no API role writes). It is tested on PGlite in `packages/data/src/lessonChatSql.test.ts` and has not been applied to any live project.
- **Not built yet:** the Postgres `LessonChatRepository`, a `FileStore` over a private Supabase Storage bucket (`lesson-files`), a real malware scanner, and supervision rules for junior tutors.

## Tests

`packages/data/src/lessonChat.test.ts` (rules, files, signed links, audit), `lessonChatSql.test.ts` (the migration), `apps/web/tests/lessonChat.test.mjs` (HTTP and the relay), `apps/realtime/server/chatGate.test.ts` (the Socket.IO gate). The negative cases: a message before the start, after the end and on a cancelled lesson; an unassigned tutor; a student from another lesson; a parent sending; a parent of another child reading; a junior tutor sending; disallowed and oversized files; path-traversal names; a file fetched through another lesson; and the grace window following config.
