# db/ — database migrations and tools

The database is a Supabase (PostgreSQL) project. This folder holds the SQL that
shaped it, and the tools for keeping this folder in step with the live database.

## Why the numbering starts at 023

Migrations `001`–`022` do not exist in this repository. The original tables and
the first security rules were created before migration files were being kept
(most likely in the Supabase dashboard), and Supabase's own migration history
lists only some of what was run. Nothing earlier is in Git either.

The numbers only give an order; they are not renamed because the notes, comments
and docs refer to them (for example "db/042", "db/054").

So this folder alone **cannot** rebuild the database from migration 001. Use the
snapshot below as the starting point instead.

## Files

| File | What it is |
|---|---|
| `023_…` to `059_…` | Numbered migrations, in the order they were written. |
| `schema-snapshot-2026-10-04.sql` | The whole structure of the `public` schema as ordinary SQL: sequences, tables, keys and checks, foreign keys, indexes, row-level security, functions with their grants, triggers, policies, table grants and the daily cleanup job. Generated 2026-10-04 12:45 UTC. Replayed into a scratch schema and compared with the live catalog (tables, columns, constraints, indexes, policies, functions, triggers and grants all matched). |
| `tools/export-schema.sql` | Regenerates a snapshot from the live database. Run it in the Supabase SQL editor and save the `ddl` column as `schema-snapshot-<date>.sql`. |
| `tools/e2e-cleanup.sql` | Removes the accounts created by the end-to-end test (`zz.e2e.*@example.com`). Run the preview query first. |

The snapshot holds **structure only**, no rows. It does not create the Supabase
`auth` users, storage, secrets or edge functions (those are in `../supabase/`).

## Rebuilding on a new Supabase project

1. Create the project and enable the extensions listed at the top of the snapshot
   (`pg_cron`, `pgcrypto`, `uuid-ossp`, …).
2. Run the newest `schema-snapshot-*.sql`.
3. Run every migration **newer than the snapshot** that is not already in it, in
   number order. The snapshot dated 2026-10-04 12:45 UTC was taken *before*
   migration 055 was written, so apply `055` onwards, checking each one against
   the list below first.
4. Deploy the edge functions in `../supabase/functions/` and set their secrets
   (AI key, service role) in the Supabase dashboard. Secrets never go in the repo.
5. Create the admin account, then the programmes, then staff and students through
   the admin screens.

## Keeping this folder honest

- A migration is only a file until somebody runs it in the SQL editor. The
  `STATUS:` line at the top of an older file may be out of date (some still say
  "DRAFT. Not applied" although they were applied). Treat the live database as
  the truth and check it before relying on a file.
- After each batch of migrations, run `tools/export-schema.sql` and commit a new
  `schema-snapshot-<date>.sql`.
- Do not edit a migration that has been applied. Write a new one.
- Anything run by hand in the SQL editor that changes structure should be saved
  here as a numbered file.

## Known state (as of 2026-10-05)

- `041_adviser_approval_is_final.sql` is **drafted and not applied**.
- `055` was applied and verified on 2026-10-04.
- `056`–`059` were written on 2026-10-04 after the snapshot; confirm which are
  applied before relying on them. `056` (BSN/BSCRIM unit limits) was skipped by
  the project owner at one point, so check it deliberately.
