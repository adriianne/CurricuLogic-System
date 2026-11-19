# Backup and restore

Written 19 Nov 2026. A manual backup of the system's data, made by the System administrator, and how to load it back.

## What a backup is

**Admin → Backup → Create backup** reads the system's tables and saves **one JSON file**
(`curriculogic-backup-2026-11-19-1030.json`) to the browser's downloads. It also writes two lines to the audit log: one when the backup
starts (`BACKUP_DATA_READ`) and one when it finishes (`EXPORT_REPORT`, report `backup`). The "Last backup" line on the page comes from the second.

It is a **manual** backup. Automatic daily backups need the paid Supabase plan (Database → Backups). Make a backup before anything risky:
a data reset, a large upload, a schema change.

### What is in it (32 tables)

Accounts and profiles (students, faculty, registrar, department, administrators), programmes and the staff-programme links, curricula
(prospectus, subjects, prerequisites, electives), the schedule (offerings), grades and grade uploads, advising requests and their items
and reviews, notifications, preferences, the EDP student list, upload history, settings, the student ID counter, and the audit log.

### What is NOT in it, and why

| Left out | Why |
|---|---|
| Supabase sign-in data (`auth.users`: emails, password hashes) | It lives in Supabase's own schema, which the Admin account cannot read. See "Accounts after a restore". |
| Cura's chat messages and reset marks | Private conversations; not needed to run the system. |
| Login-attempt and AI-usage counters, staging tables | Temporary. |
| The database's structure (tables, functions, policies) | That is the `db/` migration files in the repository, not data. |

The tables hold no passwords or keys (only `must_change_password` flags). The file still contains **student information**: keep it private
and delete old copies.

## Checking a backup

**Admin → Backup → Check a backup file** opens a file and tells you whether it is complete (every table present, every row count right) and
**unchanged since it was made** (a SHA-256 checksum of the data). Check a backup right after making it, and again before you rely on it.

## Restoring

A restore is a deliberate, careful job. Do it on a **new, empty** project first if you can, and read this whole section before starting.

### 1. Make the restore scripts

```bash
node db/tools/backup-to-sql.mjs path/to/curriculogic-backup-....json restore-scripts
```

This checks the file (and refuses a damaged one unless you add `--force`), then writes one numbered `.sql` file per table into
`restore-scripts/`, plus `00_README.txt` listing the order. Empty tables are skipped.

### 2. What must exist first

- **The database structure.** Apply the migrations in `db/` (or a copy of the project's schema) so the tables, constraints and functions exist.
- **The Supabase sign-in users.** The staff and student tables point at `auth.users` by id (`user_id`). A row cannot be restored unless
  its sign-in user exists **with the same id**.
  - Restoring into the **same project** (data damaged, users still there): the users exist, nothing more to do.
  - Restoring into a **new project**: recreate each sign-in user with its original id (the Supabase Admin API's create-user call accepts an `id`),
    or restore Supabase's own backup first. The `user_id` and `email` columns of the profile tables in the backup tell you which users are needed.
    People will need to set their passwords again.

### 3. Run the scripts

Open the Supabase **SQL editor** and run the files **in numbered order** (they follow the table dependencies: programmes and staff first, then
curricula, students, schedule, grades, requests, then logs).

- Each file first tries to switch triggers off for the session (so the restore does not write new audit rows or recompute data). If your
  role may not do that you will see a notice and the restore still works, only with extra audit lines.
- Each `insert` uses `on conflict do nothing`: a row that already exists is left alone, so a script can be run again safely. It will **not**
  overwrite existing rows. To replace damaged data, empty the table first (carefully).
- After the rows of a table with its own counters (requests, subjects, ...) the script moves that counter past the restored ids, so new rows do not collide.

### 4. Check the result

Compare the row counts in the SQL editor with `counts` at the top of the JSON file, sign in as each role, and open a few records. The Admin
"Check a backup file" page and the `counts` block tell you what to expect.

## Notes

- Large files: the browser holds the whole backup in memory. Today it is a few hundred KB. If it ever reaches hundreds of MB, split the work
  by table with the same functions (`admin_backup_page`) instead.
- Rows are read page by page while people may still be using the system. If a table changes while the backup runs, the page says so
  ("the data changed while the backup ran"). Make backups when the system is quiet.
- The functions behind the page are `admin_backup_tables()` and `admin_backup_page(table, from, size)` (db/127). Both refuse anyone who is not a
  signed-in System administrator, and only read the tables on a fixed list.
