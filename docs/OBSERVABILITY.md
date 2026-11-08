# Observability: knowing the service is up, and finding out when it is not

Launch checklist task 3.8. This is what the running service reports about itself, what to point a monitor at, and what to search the logs for.
There is **no third-party error reporter or analytics** (decided, checklist 0.6), so the host's log and an uptime monitor are the whole picture.

## The two health endpoints

| Path | Answers | Use it for |
| --- | --- | --- |
| `GET /api/health` | Always `200 {"status":"ok"}` while the process is serving. Calls nothing. | **Render's health check.** Render restarts the service when it fails, so it must not depend on the database: a Supabase outage must not cause a restart loop of a healthy web server. |
| `GET /api/health/ready` | `200` when ready, `503` when not, with `{"status":"ok"\|"failing","checks":{"database":…,"auth":…,"classroom":…}}`. Each check is `ok`, `failing` or `off`. | **The uptime monitor.** |

What the readiness checks mean:

- **database**: `select 1` through the site's own connection (`DATABASE_URL`, the narrow `learnthrive_server` role), with a 3-second limit.
- **auth**: Supabase Auth's own health endpoint (`/auth/v1/health`, with the publishable key), with a 3-second limit.
- **classroom**: the classroom's signalling server is running in this process. `server.ts` records it at start-up. A service started with
  `next start` instead of `npm run serve` serves the site with **no classroom at all** (checklist 3.1); this check is what catches that.

A check is `off` when it is not configured here. Once the portal is open in production (`NEXT_PUBLIC_APP_PORTAL_ENABLED=true`) all three are
required, so `off` counts as not ready. With the portal closed (go-live step one, checklist 8.1), `off` is fine, but a check that **is**
configured and does not answer is still a failure.

The answer is worked out at most once every 10 seconds however often it is asked, so polling it cannot load the database, and it never
names a host, an error or a count. A change between ready and not ready writes one `readiness` log line.

## The log line

Every structured line is one JSON object with an `event` and an `outcome`, written by `logOutcome` (`apps/web/src/lib/log.ts`, and its twin
`apps/realtime/server/log.ts`). Routine outcomes (`ok`, `sent`, `received`, `dropped`, `duplicate`, `stored`, `served`, `started`,
`stopping`, `heartbeat`) go to **stdout**; everything else (refused, failed, rate limited, unavailable, locked) goes to **stderr**. Extra
fields survive only if they are numbers, booleans or short codes (letters, digits, `_ . : -`, at most 40 characters).

**Never logged:** names, usernames, email or postal addresses, IP addresses, tokens, passwords, keys, request URLs or bodies, error
messages, SDPs, room or lesson ids. The filter drops most of these by shape, but a short code-like value (a username such as `jamie.p`)
would pass it, so **callers must never pass one**. Review any new `logOutcome` call with that in mind.

### Events

| Event | Written by | Outcomes worth knowing |
| --- | --- | --- |
| `server` | `server.ts` | `started` (mode, media `sfu`/`mesh`, `maxStudents`); `heartbeat` every 5 minutes; `stopping` (signal, and the rooms and participants a restart ends); `failed` (the listen error's code) |
| `server-error` | `src/instrumentation.ts` (`onRequestError`) | `error`: any page, route, server action or proxy that threw. Fields: `route` (the file pattern, e.g. `/dashboard/admin/students/[id]/page`), `routeType`, `method`, `kind`, `digest` |
| `request-aborted` | `src/instrumentation.ts` (`onRequestError`) | `client_gone`, on stdout: a page cut short because the **browser** went away (someone clicked on, reloaded or lost signal while it was still streaming in). Same fields as `server-error`. Not a server failure, so it is kept out of `server-error` (it was all 7 of the `server-error` lines in one real-stack run before 8 Nov 2026). Recognised exactly: React's two stream messages and Next's `ResponseAborted`; a timeout of the site's own is still a `server-error` (`clientWentAway` in `src/lib/observability.ts`) |
| `readiness` | `/api/health/ready` | `ok` / `failing` when the state changes, with each check |
| `account-signin` | sign-in | `ok`, `locked`, `invalid_credentials`, `account_disabled`, `rate_limited`, `forbidden_origin`, `unavailable` |
| `account-forgot`, `account-password`, `account-verify` | password reset and change | `sent`, `ok`, `failed`, `rate_limited` |
| `classroom-turn` | `GET /api/turn-credentials` | `failed` (Cloudflare's `status`, or `reason` `timeout`/`network`), `rate_limited` |
| `classroom-sfu` | the Cloudflare SFU relay | `failed` (`op`, Cloudflare's `status` and `code`, or `reason`) |
| `enquiry`, `careers`, `careers-file`, `subject-request`, `reconfirm`, `human-check`, `library-*`, `learner*`, `assistant-*`, `paper-*` | the forms and their routes | `sent`/`stored`, `rejected`, `rate_limited`, `unavailable`, `send_failed`, `error` |

The heartbeat:

```json
{"event":"server","outcome":"heartbeat","uptimeS":3600,"rssMb":310,"heapMb":121,"loopP99Ms":22,"media":"sfu","rooms":2,"participants":13,"waiting":1,"sockets":14}
```

`loopP99Ms` is the 99th-percentile event-loop delay over the last five minutes. One process carries the site **and** every live
classroom, so a high value means lessons stutter as well as pages.

### Matching a person's report to the log

When a page fails on the server, the error page shows **"Reference: `<digest>`"** (the signed-in app) or asks the visitor to quote it
(the public site). That digest is the `digest` field of the `server-error` line. Search the log for it.

## Setting it up (when the Render service exists, checklist Phase 6)

1. **Render health check path:** `/api/health` (already in `RENDER.md`). Leave it there.
2. **Uptime monitor** (checklist 0.7: any external monitor, such as UptimeRobot or Better Stack). Point it at
   `https://www.learnthrivetuition.co.uk/api/health/ready`, every 1 to 5 minutes, alerting after **two** failures in a row, and send the
   alerts to at least two people. The monitor sees only this public answer, so it receives no personal data. Add it to the supplier list
   on the privacy page anyway, because it is a service the company uses.
3. **Logs:** check how long your Render plan keeps logs. If it is shorter than you need to look back on an incident (30 days is a
   sensible minimum), add a Render log stream to a log store. A log store is a new supplier that receives the log, so it goes on the
   privacy page's supplier list too. The log holds no personal data by design, which is what makes this a small decision.
4. **Alerts to set** (on the log store, or by checking Render's log search daily in the first week, checklist 10.1):

| Search | Means | Do |
| --- | --- | --- |
| `"event":"server-error"` | A page, route or action threw | Read `route` and `digest`. More than a handful an hour is an incident. **Match this JSON field, not the word `Error`:** Next also prints its own `⨯ Error: The destination stream errored…` line each time a browser leaves a page early, which is not a failure (see `request-aborted`) |
| Many `"event":"request-aborted"`, with high `loopP99Ms` | People are giving up on pages that are too slow | A few an hour is normal browsing. A rise together with a slow heartbeat means the server is struggling: look at `route` for the slow page |
| `"event":"readiness","outcome":"failing"` | The database, Auth or the classroom is not answering | Check Supabase status and the dashboard; `SUPABASE_RUNBOOK.md` |
| No `"outcome":"heartbeat"` for 10 minutes | The process is stuck or restarting | Check Render's events and the last lines before the gap |
| `"outcome":"heartbeat"` with `loopP99Ms` above 200 | The server is overloaded | Lessons will stutter. Look at `rooms`, `participants` and `rssMb` |
| `rssMb` rising across a day without falling | A memory leak | Plan a restart outside lesson hours |
| `"outcome":"stopping"` with `participants` above 0 | A deploy or restart ended live lessons | Deploy outside lesson hours (checklist 3.1.1) |
| `"event":"classroom-turn","outcome":"failed"` or `"event":"classroom-sfu","outcome":"failed"` | Cloudflare is refusing or unreachable | A `401`/`403` status means the key or secret is wrong or rotated |
| Many `"event":"account-signin","outcome":"locked"` | Someone guessing passwords | Check for one source in Render's request logs; consider a firewall rule (checklist 6.4) |

## Not covered

- **Client-side errors** (in a person's browser) are not reported anywhere: there is no third-party reporter, and the cookie and privacy
  pages assume none. A person's description and the server log are what is available.
- **Admin actions** (making an account, a purge) are recorded in the database's audit tables, not the log.
- **Supabase's own logs and metrics** are in its dashboard (checklist 10.1: usage, auth errors, the pooler).
