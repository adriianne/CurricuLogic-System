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
| `023_…` to `081_…` | Numbered migrations, in the order they were written. `071` only records the staff photo storage that already existed. All are applied; `073` onward are in the 2026-10-17 snapshot, which was taken after `081`. |
| `schema-snapshot-2026-10-17.sql` | **The current snapshot.** The whole structure of the `public` schema as ordinary SQL: sequences, tables, keys and checks, foreign keys, indexes, row-level security, functions with their grants, triggers, policies, table grants and the daily cleanup job. Generated 2026-10-17 10:02 UTC, after migration 081. Its statement counts were checked against the live catalog (31 tables, 88 policies, 54 functions, 20 triggers); it has not been replayed into an empty schema. |
| `schema-snapshot-2026-10-13.sql` | Previous snapshot (after migration 070), kept for history. Do not use it to rebuild. |
| `schema-snapshot-2026-10-04.sql` | The previous snapshot, kept for history. Taken before migration 055 and before 7 unused tables were dropped (36 tables, 97 policies, 40 functions, 6 triggers). That one was replayed into a scratch schema and matched the live catalog at the time. Do not use it to rebuild. |
| `tools/export-schema.sql` | Regenerates a snapshot from the live database. Run it in the Supabase SQL editor and save the `ddl` column as `schema-snapshot-<date>.sql`. |
| `tools/e2e-cleanup.sql` | Removes the accounts created by the end-to-end test (`zz.e2e.*@example.com`). Run the preview query first. |

The snapshot holds the **`public` schema structure only**, no rows. It does not
create the Supabase `auth` users, storage buckets and their policies, secrets or
edge functions (the functions are in `../supabase/`).

**Storage is not in the snapshot.** The live `storage.objects` table has 11
policies (checked 2026-10-14):

- `profile_photos_*` (7 policies, student photos): in `064_profile_photos.sql`,
  `068_…`, `069_…` and `070_…`. Run those files, and create the bucket they refer
  to, when rebuilding.
- `staff avatars delete / insert / read / update` (4 policies, staff photos) and
  the `staff-avatars` bucket: recorded in `071_staff_avatars_storage.sql`. They
  were first created by hand, so the file was written from the live project on
  2026-10-14 and replayed against it in a rolled-back block (policies and bucket
  came out identical). Run it when rebuilding.

## Rebuilding on a new Supabase project

1. Create the project and enable the extensions listed at the top of the snapshot
   (`pg_cron`, `pgcrypto`, `uuid-ossp`, …).
2. Run the newest `schema-snapshot-*.sql`.
3. Run every migration **newer than the snapshot** that is not already in it, in
   number order. The snapshot dated 2026-10-17 10:02 UTC was taken *after*
   migration 081, so nothing in the `public` schema needs applying on top of it.
   Then run the storage files: `064`, `068`, `069`, `070` and `071`.
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

## Known state (as of 2026-10-17)

- The newest snapshot, `schema-snapshot-2026-10-17.sql`, is the record of the live
  `public` structure through migration `081`. Storage policies are separate (see
  above).
- `041_adviser_approval_is_final.sql` is **applied**: the live policies
  "department reads approved enrollment requests / items" use its meaning
  (checked 2026-10-14). An older note here said it was only drafted.
- **Cura chats (14 Oct 2026), `073` to `075`, all applied and checked.**
  - `073_ai_chat_reset.sql`: table `ai_chat_reset`, one row per "New chat" press. It was the first attempt at
    starting over and is **no longer used** by the website; it can be dropped.
  - `074_ai_chat_conversations.sql`: table `ai_chat_conversation` (`id`, `student_id`, `title`,
    `created_at`, `updated_at`) and `ai_chat_message.conversation_id`. The existing 90 messages were put into
    conversations, split where a student had pressed New chat; the part before it is titled "Earlier conversation".
    A BEFORE INSERT trigger files a message that arrives without a conversation (the Android app before its
    update) in the student's latest one, starts one if there is none, keeps `updated_at` current and sets the
    title to the first question (60 characters) while it is null. An AFTER DELETE trigger removes conversations
    left empty by the 6-month cleanup (048). Students may read and start their own conversations and change only
    the `title` (column grant); inserting a message also needs the conversation to be the student's own.
  - `075_ai_chat_delete.sql`: students may delete their own conversation. Its messages go with it through the
    `ON DELETE CASCADE`; `ai_chat_message` itself still has no delete policy. Tested in a rolled-back
    transaction (own chat deleted, another student's untouched).
  - `076_section_demand.sql`: two read-only functions for the Department dashboard, applied 14 Oct 2026. `section_demand(year, term)` counts the different students who chose each section (sent or approved plans); `section_demand_students(...)` lists their names for the department's own programme. Neither writes anything. Capacity defaults to 45 in the app when not set.
  - `077_edp_results.sql`: what the EDP office said about each subject of an approved plan, as the student reports it, applied 14 Oct 2026. Three columns on `request_item` (`edp_result`, `edp_reason`, `edp_reported_at`) and `report_edp_results(jsonb)`, the only way a student writes them: it checks the item is the student's own, in an approved plan, and approved by the adviser. A report changes only that student's own plan.
  - `078_set_section_open.sql`: `set_section_open(subject, section, year, term, open)`, applied 14 Oct 2026. Department staff close or reopen a section (`is_open` on every meeting of it) for subjects of their own programme only. Closing writes one `section_closed` notification to each student with a sent or approved plan on that section; reopening notifies nobody. Returns { updated, notified }.
  - `079_move_item_section.sql`: `move_request_item_section(item_id, new_offering_id)`, applied 14 Oct 2026. A student moves one subject of their approved plan to another open section of the same subject and term (same meeting type); no adviser approval, the adviser gets a `section_moved` information note; clears any EDP report on that item. Clashes with other subjects are checked by the apps, not the database. Returns { item_id, from_section, to_section, notified }.
  - No other role can read these tables: staff have no policy on them.
- `055` was applied and verified on 2026-10-04. `068`, `069` and `070` (staff
  reading student photos) are applied: their three `profile_photos_select_*`
  policies are live (checked 2026-10-14).
- Some older files still say "DRAFT. Not applied" in their own `STATUS:` line.
  When in doubt, trust the live database and the newest snapshot, not the line.
