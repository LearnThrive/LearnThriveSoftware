# Supabase operations runbook

For the owner or whoever is on call. Four situations: **rotating a credential**, **restoring from a backup**, **suspending a user**, **a suspected key leak**. Nothing here needs code changes. Names of environment variables are in `docs/ENVIRONMENT.md`; **never paste a value into a chat, a ticket, a log or this repository.**

The fastest way to stop everything, whatever has happened: in Render, **unset `LIBRARY_ENABLED`** (and `NEXT_PUBLIC_APP_PORTAL_ENABLED` if the portal is open) and redeploy. Every account, Library and LearnThrive AI route then answers "closed". It does not touch Supabase, so it is safe and reversible while you work out the rest.

## 1. Rotating credentials

Rotate on a schedule (at least yearly), when someone with access leaves, and always after a suspected leak (section 4). Do it in a **quiet hour**: two of these have a short window where connections fail.

### The publishable and secret keys (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)

The new-style keys can be replaced one at a time with no downtime:

1. Dashboard, Project Settings, API Keys: **create a new secret key** (and a new publishable key if rotating that).
2. In Render, set the variable to the new value and let it redeploy.
3. Run `npm run supabase:verify` and a sign-in on the live site.
4. Back in the dashboard, **delete the old key**. From that moment the old value is dead everywhere.

If the project is still on the **legacy** `anon` / `service_role` JWT keys, rotating them means rotating the project's **JWT secret**, which signs **every user out** and invalidates both legacy keys at once. Prefer moving to the new keys first.

### The site's database password (`learnthrive_server`, inside `DATABASE_URL`)

```bash
# one shell session; the owner generates the password, it never goes in a file
export DATABASE_ADMIN_URL=...          # the postgres connection (owner only)
export LEARNTHRIVE_SERVER_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
node apps/web/scripts/create-server-role.mjs --host <the database host>
# then immediately put the new password into Render's DATABASE_URL and redeploy
unset DATABASE_ADMIN_URL LEARNTHRIVE_SERVER_PASSWORD
```

**Two measured behaviours of the pooler** (Supavisor; `docs/SUPABASE_REAL_STACK.md`):

- After the password changes, the pooler keeps the old one cached and **refuses both** for about **10 to 16 seconds**. Expect pooled connections to fail for that long. The site shows "unavailable" and recovers by itself.
- **A burst of refused attempts trips a circuit breaker** that blocks *every* new pooled connection for about **a minute**. So: change the password, update Render at once, and **do not retry in a loop** (no scripts that hammer the connection while you wait).

Order that keeps the gap shortest: have the new `DATABASE_URL` ready in Render's editor, run the script, paste, save. If you cannot tolerate even that, create a second role the same way and switch to it (`learnthrive_server` is the only name the script makes, so that needs a small change first).

### The `postgres` password

Dashboard, Project Settings, Database, reset the password. The site does not use `postgres`, so nothing breaks; update wherever the owner keeps it (and `SUPABASE_DB_PASSWORD` for the CLI, for one session only).

### Other secrets

`RESEND_API_KEY`, `CAPTCHA_SECRET`, `STRIPE_*`, `ASSISTANT_API_KEY`: replace at the provider, set the new value in Render, redeploy, then revoke the old one. `CAPTCHA_SECRET` signs the site's own human-check tokens: changing it only invalidates challenges that are open at that moment. The Resend key used for **Auth's SMTP** is separate (set in the Supabase dashboard); rotate it there.

## 2. Restoring from a backup

Supabase backups hold the **database**. **They do not hold uploaded files** (the objects in Storage; confirm on the day in Supabase's documentation). A restore also **brings back rows the retention job and families had already deleted**, so a restore must not be the last step.

1. **Close the site** (unset `LIBRARY_ENABLED`, redeploy). Note the time and the backup you are restoring.
2. Restore in the dashboard (Database, Backups; or point-in-time to a chosen minute). Roles and passwords can differ after a restore: **re-run `scripts/create-server-role.mjs`** so `learnthrive_server` has the right grants and password, and update Render's `DATABASE_URL`. Remember the pooler's 10 to 16 second cache and one-minute breaker.
3. **Re-apply every deletion since the backup's date, before anyone is let in:**
   - run the retention job (`npm run assistant:retention` in `apps/web`): it deletes expired chats and uploads, objects first, then rows;
   - for each family that asked to delete a chat or its account since the backup, delete again (the account page's own "delete" actions, or `delete from auth.users` through the dashboard for erased accounts);
   - a restore that resurrected a deleted account is a **personal-data incident**: record it and decide with the owners whether anyone must be told.
4. Check the schema is what the code expects: `npx supabase db push --dry-run` should list nothing to apply (or only newer migrations), and `npm run supabase:verify` must show no FAIL.
5. Run the smoke test (`npm run supabase:smoke`, `docs/SUPABASE_REAL_STACK.md`) and sign in as a test family.
6. **Reopen the site** and write down what was restored, from when, and what was re-deleted.

## 3. Suspending a user

Pick the least that fixes the problem. None of these deletes anything.

| Goal | How |
| --- | --- |
| Stop the person signing in, now | Dashboard, Authentication, Users, the user, **Ban user** (a long duration), then **Sign out** the user so existing sessions end. Or by the admin API: `PUT /auth/v1/admin/users/<id>` with `{"ban_duration":"876000h"}` using the secret key from your shell, and `POST /auth/v1/admin/users/<id>/logout`. |
| Stop their access to the Library but keep the account | End the entitlement: `npm run library:grant -- --revoke <grant id>` for an administrator grant (`--list --email ...` shows it); a paid subscription ends in Stripe, and a refund ends it (`npm run billing:reconcile` catches up). Enrolment follows the tuition record. |
| Stop LearnThrive AI for a family | There is no per-family switch in code today (and an administrator cannot read or delete a family's chats, by design). To block use, ban the user (they then also cannot open their account, so they cannot delete their own chats until you unban them). |
| Preserve evidence (a safeguarding or abuse matter) | **Do not delete.** Ban, do not purge, and tell the safeguarding lead: chats are held for 30 days by default, uploads 7. Extending retention is a decision for the lead and the owners; **do not edit `delete_after` casually**: it is a service-role-only column, so it needs the server connection and a written reason. Export first: `GET /api/assistant/export` is the family's own copy; an operator's copy needs a query by the owner. |
| Remove an administrator | `update public.profiles set role = 'CLIENT' where id = ...` through the dashboard SQL editor (as `postgres`), then ban and sign them out; then check `select count(*) from public.profiles where role = 'ADMIN'`. |

## 4. A suspected key leak

**Assume it is real until shown otherwise.** What matters is which credential, and what it could do:

| What leaked | What an attacker could do | Severity |
| --- | --- | --- |
| The **publishable** key (`sb_publishable_...` or the legacy `anon`) | Call Auth and the Data API as an anonymous caller. Row level security and the private buckets still apply. The key is not a secret in design (it names the project), but the site never sends it to a browser, so a leak means the server environment was exposed. | Low to medium: rotate anyway |
| The **secret** key (`sb_secret_...` or the legacy `service_role`) | Everything: it bypasses row level security and the storage rules; read and write every family's data and every file; create or delete users. | **Critical** |
| The **database URL / password** of `learnthrive_server` | Read and write every table (it bypasses row level security by design); it cannot create tables, read other schemas or the credentials. | **Critical** |
| The `postgres` password or `DATABASE_ADMIN_URL` | Full control of the database. | **Critical** |
| `RESEND_API_KEY`, `STRIPE_*`, `CAPTCHA_SECRET`, `ASSISTANT_API_KEY` | Send mail as the site; act on Stripe within the key's rights; forge human-check tokens; spend the AI budget. | High |

**Steps, in this order:**

1. **Contain.** If it is a secret, database or `postgres` credential: unset `LIBRARY_ENABLED` in Render and redeploy (section top). If the key was **committed**, treat it as public the moment it was pushed: removing it from the history does not un-leak it.
2. **Rotate** the leaked credential (section 1). A new key does not help while the old one is still valid: **delete or revoke the old one**.
3. **Look** for use you did not make. Dashboard, **Logs**: *API* and *Auth* (unusual callers, a burst of signups, sign-ins from unexpected places), *Postgres* (connections by `learnthrive_server` or `postgres` at odd hours), *Storage*. In the database, as `postgres`: `select client_id, count(*) from public.download_events where at > now() - interval '7 days' group by 1 order by 2 desc limit 20` (an unusual download pattern), and `select rolname, usename, client_addr, backend_start from pg_stat_activity` (who is connected now; unknown addresses). Check `select * from auth.audit_log_entries order by created_at desc limit 100` for admin actions.
4. **Decide what was reachable.** For a secret key or database credential, assume every family's data was readable between the leak and the rotation. For the publishable key alone, only what row level security allows an anonymous caller (the published catalogue).
5. **Record** what happened, when, what you did and what you found, in a note the owners keep (no secrets in it).
6. **Tell, if you must.** A breach that risks people's rights must be reported to the ICO within **72 hours** of becoming aware, and to affected people without undue delay where the risk is high. The owners decide, with the safeguarding lead if children's data is involved; `apps/web/LEGAL_REVIEW.md` has the data flows.
7. **Find how it leaked** (a log, a screenshot, a committed file, a laptop) and fix that, or it will happen again. GitHub secret scanning, the registry check (`npm run check:env`) and the bundle check (`npm run check:bundle`) exist to catch the common ways; none can catch a pasted message.

## Routine checks

- After any migration or dashboard change: `npm run supabase:verify`.
- After any migration that adds a table: re-run `create-server-role.mjs` (a new table is unreachable by the site's role until you do; a test pins this on purpose).
- Daily: the retention job (`npm run assistant:retention`) runs on Render's cron; if it stops, chats and uploads outlive their promised deadlines.
- Quarterly: rotate credentials, review dashboard members, run the advisors, run `npm run supabase:smoke`.
