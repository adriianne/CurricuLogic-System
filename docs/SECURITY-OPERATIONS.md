# Security operations

How CurricuLogic keeps its secrets, its sessions, its audit trail and its ability
to recover. Written for whoever runs the system next (including future you).
Last reviewed 2026-10-04; the schema-snapshot status in section 4 was updated 2026-10-14.

## 1. Secrets

| Secret | Where it lives | Notes |
|---|---|---|
| Supabase **anon** key | `shared/js/app/config.js` (and the Android app's `local.properties`) | **Public by design.** It is in every visitor's browser. It identifies the project; row-level security is what protects the data. |
| Supabase **service-role** key | Only inside Supabase's edge-function environment (provided automatically) | Bypasses all row-level security. Never in the repo, never in the browser. Used by `sign-in`, and by the role checks in the AI functions. |
| **Gemini** API key (`GEMINI_API_KEY`) | Supabase → Edge Functions → Secrets | Used by the three AI functions. |
| Mail-service key (when item 6 is built) | Supabase → Edge Functions → Secrets | Same place; never in the repo. |
| Database password | Supabase dashboard | Not used by the app. |
| Test account passwords | Chat history only | The test accounts use a weak password on purpose. **Change them before real use.** |

**Guards in the repo**
- `.gitignore` keeps `.env*`, keys, certificates, `local.properties` and `node_modules` out of git.
- `tests/secrets.test.mjs` runs with the normal test suite
  (`node --test tests/*.test.mjs`). It scans every file git would commit and fails
  on a service-role key, a Google/OpenAI/Resend key, a private key or an `.env` file.
  The anon key in `config.js` is the only key allowed. The 2026-10-04 audit found
  no secret in any current file or in the full history of either repository.

**If a secret leaks**
1. Treat it as compromised straight away; do not wait to see if it was used.
2. Rotate it at the source: Gemini key in Google AI Studio, then update the Supabase
   function secret; service-role key in Supabase → Settings → API.
3. Remove it from the repo *and* the history (a deleted file is still in git history).
4. Check the Supabase logs and the audit log for activity you do not recognise.

## 2. Sessions

| Role | Idle sign-out after | Warning |
|---|---|---|
| System administrator | 15 minutes | 60 seconds before |
| Registrar, department, faculty | 30 minutes | 60 seconds before |
| Student | 60 minutes | 60 seconds before |

- Idle means no mouse, keyboard, scroll or touch activity. Tabs of the same role
  share one clock, so working in one keeps the others signed in. A laptop that
  slept past the limit signs out when it wakes. Implemented in
  `shared/js/app/idlesignout.js`; switched on by `data-idle-role` on each dashboard's
  `<body>`; off in the localhost `?preview` mode.
- **Remember me** now works. Registrar, department and administrator sessions are
  always per tab (gone when the tab closes). Staff login has no "Remember me" box,
  so faculty sessions are per tab too. A student's session is kept on the device
  only if the box is ticked. Where each session is stored: `authOptions()` in
  `shared/js/app/config.js`.
- **Log out** ends the session on every device (Supabase's default scope).
- **Not covered:** a stolen session token is not stopped by any of this, and the
  access token itself stays valid until it expires (about an hour). Ending sessions
  on the server (Supabase Auth → Sessions: "time-box user sessions", "inactivity
  timeout") needs a paid Supabase plan, and the leaked-password check (Auth → Email
  → "prevent use of leaked passwords") is also not available on this plan (checked
  2026-10-04). The app's own password rule (db/049) is the only password check.
- **First password.** An account an administrator creates is given a random
  password nobody sees (db/072) and the person is emailed a one-time link to
  choose their own (`setpassword.html`); "Forgot password" uses the same link.
  Setting it up (SMTP sender, redirect list, link lifetime) is in
  `docs/EMAIL-SETUP.md`. The special-character rule on a password chosen this way
  is checked in the browser only.

## 3. Audit log

`audit_log` is the record of who changed what. **Only administrators can read it**
(policy `admin_reads_audit_log`).

**Recorded** (`db/054_audit_trail.sql`, once applied): account creation and curriculum
copies (by their functions); subject edits and retirements; programme edits; the
term setting; curriculum version create / publish / activate / delete; staff and
administrator account changes (approval, programme, ID, email, department);
student approval, verification, ID, programme and curriculum changes; adviser
assignments. For a change, only the columns that changed are stored (old and new).

**Not recorded, on purpose:** grade uploads (the `grade_file` and `grade_file_row`
tables already keep who, when and what per upload); adviser decisions (kept in
`request_review`); the public sign-up queue (so nobody can fill the log by
registering repeatedly); sign-ins (Supabase Auth keeps its own log:
dashboard → Authentication → Logs).

**Append-only:** nobody signed in can insert, update or delete a row, and a trigger
refuses UPDATE, DELETE and TRUNCATE even for the database owner. A database
administrator could still drop the trigger on purpose, so this makes tampering
*visible*, not impossible. Nothing deletes from it (the nightly cleanup never
touches it); archive it by export if it ever gets large.

Useful queries (SQL editor):
```sql
-- what happened in the last day
select created_at, actor_role, action, table_name, record_id, old_values, new_values
from audit_log where created_at > now() - interval '1 day' order by id desc;

-- the full history of one curriculum version
select * from audit_log where table_name = 'prospectus' and record_id = '13' order by id;
```

## 4. Backups and recovery

**What protects you, honestly**
- The **code** is in git (two repositories). Edge-function source is in
  `supabase/functions/`.
- The **database structure** is in `db/` (migrations 023 onward) plus a snapshot
  you generate with `db/tools/export-schema.sql`. Migrations 001-022 (the original
  tables) were created before migrations were kept and are **not** in the repo, so
  a snapshot is the only complete record of the structure.
- The **data** is protected only by Supabase's backups. Whether any exist depends on
  your plan: check Supabase dashboard → Database → Backups. Free projects have
  no downloadable backups; daily backups are a paid-plan feature and point-in-time
  recovery is an add-on. **If that page shows none, make a manual export (below).**

**Status, checked 2026-10-04:** the Backups page offers backups only on a paid plan, so this project has none. The manual exports below are the only data backup. The latest schema snapshot is `db/schema-snapshot-2026-10-13.sql` (generated 2026-10-13 after migration 070; its counts match the live database).

**Routine (before every demo or defence, and after every batch of migrations)**
1. Run `db/tools/export-schema.sql` in the SQL editor. It returns one row per
   statement. Export the result and save the `ddl` column as
   `db/schema-snapshot-YYYY-MM-DD.sql`. (The script was validated by replaying its
   own output into an empty schema: every table, column, key, index, policy,
   function, trigger and grant came back, matching the live database.)
2. Export the data: Supabase → Table editor → each table → Export CSV (or, with the
   Supabase CLI, `supabase db dump --data-only`). The tables that matter most:
   `university_student`, `academic_record`, `request`, `request_item`,
   `request_review`, the four staff tables, `prospectus`, `subject`, `prerequisite`.
3. Keep both off the machine that holds the project (a USB drive or a private cloud
   folder). Exports contain personal data: treat them like the database itself.

**Recovery, in order**
1. Create a new Supabase project; enable the extensions named at the top of the
   latest snapshot (`pgcrypto`, `uuid-ossp`, `pg_cron` ...).
2. Run the schema snapshot once in the SQL editor.
3. Import the data CSVs (parents before children: programmes, prospectus, subject,
   prerequisite, the account tables, then records and requests). Accounts also need
   their `auth.users` rows: a restore of Supabase's own backup is the clean way; a
   CSV restore means every person has to be recreated or reset.
4. Deploy the edge functions from `supabase/functions/` (six are in use:
   `sign-in`, `assess-student`, `submit-advising-request`, `eligibility-chat`,
   `analyze-curriculum-document`, `analyze-schedule-document`; `explain-eligibility`
   is a retired stub and can be skipped), set their secrets (section 1), and point
   `shared/js/app/config.js` at the new project.
5. Verify. As of 2026-10-13 the structure has 29 tables, 82 policies, 45 functions
   and 18 triggers; compare counts against the restored project. Then sign in as
   each role, open each dashboard, and run the test suite.

**Test a restore once** into a throwaway project before you ever need one.

## 5. Checklists

**After each database migration:** note it in `db/`, apply it, run its verification,
then regenerate the schema snapshot.

**Before a demo or defence:** change the test passwords; run
`node --test tests/*.test.mjs`; make the exports in section 4; check
`maintenance_log` shows the nightly cleanup ran; sign in as each role once.

## 6. Content-Security-Policy

A Content-Security-Policy (CSP) tells the browser what a page may load and run. If an attacker
ever got text into a page that the code failed to escape, the CSP is the second wall: the injected
script still cannot run, and cannot send anything to another server. Added 2026-10-14.

It is a `<meta http-equiv="Content-Security-Policy">` tag, the first thing in the `<head>` of all
13 pages, **identical on every page** (`tests/csp.test.mjs` fails if one differs):

| Directive | Allows | Why |
|---|---|---|
| `default-src 'self'` | the site's own files | everything not listed below |
| `script-src 'self' https://cdn.jsdelivr.net` | own scripts; jsDelivr (supabase-js and ExcelJS, both with integrity hashes) | **no inline scripts, no `eval`** |
| `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com` | own CSS, Google Fonts CSS, Font Awesome CSS | `'unsafe-inline'` only because the pages set `style="..."` attributes |
| `font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com` | the font files | |
| `img-src 'self' data: blob: https://<project>.supabase.co` | own images; `data:` (the dropdown arrows in the CSS); `blob:` (a photo just picked); Supabase Storage (profile photos) | |
| `connect-src 'self' https://<project>.supabase.co` | network calls to the Supabase project only (data, sign-in, edge functions, storage) | no other server can receive data |
| `object-src 'none'`, `frame-src 'none'` | nothing | no plug-ins, no frames |
| `base-uri 'self'`, `form-action 'self'` | | stops injected `<base>` and forms that post elsewhere |

What had to change to make this possible: the theme set-up that sat in an inline `<script>` in five
dashboards is now `shared/js/app/themeinit.js` (still a plain blocking script in the head, so there is
no white flash); the Department avatar upload no longer calls `fetch()` on a `data:` address
(`CurriculogicPhoto.dataUrlToBlob`). The project's own code has no `eval`, `new Function`,
inline `onclick=` or `javascript:` links; the test keeps it so.

**Checked 2026-10-14 in a browser:** all public pages, the admin dashboard with real data and the
other four dashboards in `?preview` show no violations; Font Awesome, Fraunces, supabase-js and
ExcelJS load; the register page loads its programmes from Supabase. Proved enforced: an inline
script, a script from another server, an inline `onclick` and a `fetch` to another server are all
blocked and reported, and a string timer (`setTimeout("...")`, i.e. `eval`) is blocked.

**Not checked (needs a real sign-in per role):** photos from Supabase Storage in the dashboards,
and the advising-slip print window. The print window inherits this policy; the slip only uses a
`<style>` block, which is allowed. If something misbehaves, open the browser console: a blocked item
is reported as "Refused to ..." with the directive that blocked it.

**When to change the policy.** Adding a new outside server (a new CDN, a new font host, a new API)
needs its address added to the matching directive on every page, and `tests/csp.test.mjs` tells you
if you forgot a page. Moving the Supabase project means changing the address in `connect-src` and
`img-src`. Do not add `'unsafe-inline'` or `'unsafe-eval'` to `script-src`.

**When the site is hosted.** A `<meta>` policy cannot carry `frame-ancestors` (stops other sites
framing the pages), `report-uri`, or `upgrade-insecure-requests`, and `<meta>` cannot be
read-only. Set these as **HTTP response headers** at the host (the meta tag can stay; the browser
applies both). A starting point, once the host is chosen:

```
Content-Security-Policy: frame-ancestors 'none'; upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

(Netlify and Cloudflare Pages take these in a `_headers` file; nginx with `add_header`; Apache with
`Header set`.) Add `upgrade-insecure-requests` only on the hosted site; on `http://localhost` it would
break the page. Re-run the browser check above after the host adds headers.

**What a CSP does not do.** It does not replace escaping, row-level security or the sign-in rules:
it limits the damage if one of those fails. `style-src 'unsafe-inline'` leaves CSS injection
possible, which is far less harmful than script injection.

## 7. What Cura is told (eligibility-chat v18, 14 Oct 2026)

Cura answers from a summary of the student's standing. Until v17 the browser built that summary and sent it in the request, so the chat trusted the client for the facts it narrated. From v18 the `eligibility-chat` function ignores any `summary` in the request and asks `assess-student` (the same engine, on the server, with the student's own sign-in token; 15 s timeout) for it. If that call fails the chat answers with an error; it never falls back to what the browser sent.

- Errors the student can see: not signed in (401), awaiting approval (403), no student linked (404), record not verified or no curriculum (409), "Could not load your record. Try again." (502).
- Logic lives in `supabase/functions/eligibility-chat/core.js` (tested in `tests/eligibility-chat-core.test.mjs`). The deployable file is built by `node supabase/functions/eligibility-chat/build.mjs` into `dist/index.js`.
- The web page still keeps its own summary, only to draw the plan and schedule tables and the suggested questions.
- The Android app still sends a summary; it is ignored.
