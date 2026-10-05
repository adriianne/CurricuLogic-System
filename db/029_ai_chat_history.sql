-- 029_ai_chat_history.sql
--
-- STATUS: APPLIED to the live database (verified 2026-09-30).
--
-- WHY
--   The "Ask AI" (Cura) chat only ever lived in an in-page JS array
--   (ai-assist/eligibility-chat.js) -- it reset on every reload, so a
--   student who left the page and came back lost the conversation,
--   including which subjects Cura had recommended. Students want to be
--   able to check that conversation again later.
--
-- WHAT THIS CHANGES
--   New table ai_chat_message: one row per chat message (the student's
--   own, or Cura's reply), building a single ongoing thread per student
--   -- no separate "sessions", matching how the chat already behaves
--   within one page load. A student may INSERT and SELECT only their
--   own rows, via current_student_id() (the same helper request and
--   request_item already use). No other role is granted access -- this
--   is a private student<->AI record, not part of the advising workflow.
--
-- HOW TO UNDO: run the ROLLBACK block at the bottom.

create table if not exists public.ai_chat_message (
    id bigint generated always as identity primary key,
    student_id uuid not null references public.university_student(id) on delete cascade,
    role text not null check (role in ('user', 'model')),
    text text not null,
    show_recommended_table boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists ai_chat_message_student_id_created_at_idx
    on public.ai_chat_message (student_id, created_at);

alter table public.ai_chat_message enable row level security;

drop policy if exists "students read own chat" on public.ai_chat_message;
create policy "students read own chat"
    on public.ai_chat_message for select
    using (student_id = current_student_id());

drop policy if exists "students insert own chat" on public.ai_chat_message;
create policy "students insert own chat"
    on public.ai_chat_message for insert
    with check (student_id = current_student_id());


-- ROLLBACK ------------------------------------------------------------------
-- drop table if exists public.ai_chat_message;
