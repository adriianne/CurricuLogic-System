# db/

The database is a Supabase (PostgreSQL) project. This folder holds what is needed to rebuild it.

## To rebuild the database on an empty project

1. Enable the extensions named in the first lines of the newest snapshot (`pg_cron`, `pgcrypto`, `uuid-ossp`, and the ones Supabase turns on itself).
2. Run **the newest `schema-snapshot-*.sql`** once. It creates every table, key, rule, row-level-security policy, function, trigger, table privilege and the scheduled cleanup job, in a safe order. It holds no data.
3. Run any numbered migration file **newer than the snapshot** (a number higher than the last one applied when the snapshot was made), in number order.
4. Deploy the edge functions from `supabase/functions/` and set their secrets (they are never kept in the repository).

Newest snapshot: `schema-snapshot-2026-11-06.sql` (made after `db/106`, so no migration is needed on top of it).

## Why there are no files 001 to 022

The first tables and base security rules were created by hand in the Supabase SQL editor before migrations were kept, and Supabase's own migration history starts on 7 Sep 2026. They were never saved as files, in git or in Supabase, so they cannot be recovered one by one. Their result is part of every snapshot, which is why a snapshot replaces them. Numbered files start at `023`.

## Keeping the snapshot fresh

Make a new snapshot after every batch of migrations and before every demo or defence:

1. Open the Supabase SQL editor and paste `tools/export-schema.sql` (read-only: it only reads the catalog).
2. Run it. If the editor warns that the query "creates a table", choose **Run without RLS**: the script only generates text.
3. Export the result as CSV, then save the `ddl` column as `schema-snapshot-<date>.sql` (one statement per row, in order).

A snapshot is **not a backup**: it has no accounts, grades or requests. The free Supabase plan has no automatic data backup, so export the data separately before anything risky (see `docs/SECURITY-OPERATIONS.md`).

## Other files

- `tools/export-schema.sql`: makes the snapshot.
- `tools/e2e-cleanup.sql`: removes the test accounts of an end-to-end test (a test e-mail pattern only).
- `tools/data-reset.sql`: the full data reset planned before launch (irreversible, needs a backup first).
