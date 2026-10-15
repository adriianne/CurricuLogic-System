-- 073_ai_chat_reset.sql
--
-- STATUS: APPLIED to the live database (verified 2026-10-14: RLS on, 2 policies, select+insert only).
--
-- WHY
--   Cura's chat is one permanent thread per student (ai_chat_message, 029). The
--   suggested questions under the chat never repeat a question already asked, so in
--   a long thread they run out, and there was no way to start over.
--
-- WHAT THIS CHANGES
--   New table ai_chat_reset: one row each time a student presses "New chat". The
--   web page then shows and sends only the messages newer than the student's latest
--   reset. Nothing in ai_chat_message is deleted or changed (the 048 cleanup still
--   ages old messages out). A student may INSERT and SELECT only their own rows.
--   The Android app does not read this table yet and keeps showing the full thread.
--
-- HOW TO UNDO: run the ROLLBACK block at the bottom.

create table if not exists public.ai_chat_reset (
    id bigint generated always as identity primary key,
    student_id uuid not null references public.university_student(id) on delete cascade,
    created_at timestamptz not null default now()
);

create index if not exists ai_chat_reset_student_id_created_at_idx
    on public.ai_chat_reset (student_id, created_at desc);

alter table public.ai_chat_reset enable row level security;

drop policy if exists "students read own chat reset" on public.ai_chat_reset;
create policy "students read own chat reset"
    on public.ai_chat_reset for select
    to authenticated
    using (student_id = current_student_id());

drop policy if exists "students insert own chat reset" on public.ai_chat_reset;
create policy "students insert own chat reset"
    on public.ai_chat_reset for insert
    to authenticated
    with check (student_id = current_student_id());

revoke all on public.ai_chat_reset from anon, authenticated;
grant select, insert on public.ai_chat_reset to authenticated;


-- ROLLBACK ------------------------------------------------------------------
-- drop table if exists public.ai_chat_reset;
