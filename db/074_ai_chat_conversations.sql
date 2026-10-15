-- 074_ai_chat_conversations.sql
--
-- STATUS: APPLIED to the live database (verified 2026-10-14: 92 messages in 5 conversations, none unassigned, 2 triggers, 3+2 policies).
--
-- WHY
--   Cura's chat was one permanent thread per student. 073 let a student start over
--   by hiding older messages. This makes conversations real: a list on the left of
--   the chat (like ChatGPT), each one renamable and reopenable.
--
-- WHAT THIS CHANGES
--   1. New table ai_chat_conversation (id, student_id, title, created_at, updated_at).
--      The title is the student's first question, cut to 60 characters, until they
--      rename it. A student may SELECT and INSERT their own rows and UPDATE only
--      the title of their own rows.
--   2. ai_chat_message gets conversation_id. Existing messages are put into
--      conversations: split where the student pressed "New chat" (ai_chat_reset, 073);
--      the part before their first reset is called "Earlier conversation".
--   3. A trigger fills conversation_id when a client does not send one (the Android
--      app still does not): the message joins the student's latest conversation, or
--      a new one is started. It also keeps updated_at and the automatic title.
--   4. The insert policy on ai_chat_message now also requires the conversation to be
--      the student's own.
--   5. When the 6-month cleanup (048) deletes old messages, conversations left with
--      no messages are removed too.
--   ai_chat_reset (073) is no longer used by the website. It is left in place.
--
-- HOW TO UNDO: run the ROLLBACK block at the bottom.

create table if not exists public.ai_chat_conversation (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.university_student(id) on delete cascade,
    title text check (title is null or (char_length(btrim(title)) between 1 and 60)),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists ai_chat_conversation_student_updated_idx
    on public.ai_chat_conversation (student_id, updated_at desc);

alter table public.ai_chat_conversation enable row level security;

drop policy if exists "students read own conversations" on public.ai_chat_conversation;
create policy "students read own conversations"
    on public.ai_chat_conversation for select to authenticated
    using (student_id = current_student_id());

drop policy if exists "students start own conversations" on public.ai_chat_conversation;
create policy "students start own conversations"
    on public.ai_chat_conversation for insert to authenticated
    with check (student_id = current_student_id());

drop policy if exists "students rename own conversations" on public.ai_chat_conversation;
create policy "students rename own conversations"
    on public.ai_chat_conversation for update to authenticated
    using (student_id = current_student_id())
    with check (student_id = current_student_id());

revoke all on public.ai_chat_conversation from anon, authenticated;
grant select on public.ai_chat_conversation to authenticated;
grant insert (student_id) on public.ai_chat_conversation to authenticated;
grant update (title) on public.ai_chat_conversation to authenticated;

-- Messages belong to a conversation --------------------------------------------
alter table public.ai_chat_message
    add column if not exists conversation_id uuid references public.ai_chat_conversation(id) on delete cascade;

create index if not exists ai_chat_message_conversation_idx
    on public.ai_chat_message (conversation_id, created_at);

-- Put the existing messages into conversations (only rows that have none yet).
do $$
declare
    seg record;
    v_id uuid;
begin
    for seg in
        select m.student_id,
               (select max(r.created_at) from public.ai_chat_reset r
                 where r.student_id = m.student_id and r.created_at < m.created_at) as since,
               min(m.created_at) as first_at,
               max(m.created_at) as last_at
          from public.ai_chat_message m
         where m.conversation_id is null
         group by 1, 2
    loop
        insert into public.ai_chat_conversation (student_id, title, created_at, updated_at)
        values (
            seg.student_id,
            case when seg.since is null then 'Earlier conversation'
                 else (select left(regexp_replace(btrim(m.text), '\s+', ' ', 'g'), 60)
                         from public.ai_chat_message m
                        where m.student_id = seg.student_id and m.role = 'user'
                          and m.created_at > seg.since
                        order by m.created_at limit 1)
            end,
            seg.first_at, seg.last_at)
        returning id into v_id;

        update public.ai_chat_message m
           set conversation_id = v_id
         where m.student_id = seg.student_id
           and m.conversation_id is null
           and m.created_at >= seg.first_at and m.created_at <= seg.last_at
           and (seg.since is null
                or m.created_at > seg.since)
           and (select max(r.created_at) from public.ai_chat_reset r
                 where r.student_id = m.student_id and r.created_at < m.created_at)
               is not distinct from seg.since;
    end loop;
end $$;

-- A message with no conversation joins the latest one (or starts one); every message
-- keeps its conversation's updated_at current and gives it its automatic title.
create or replace function public.ai_chat_message_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.conversation_id is null then
        select c.id into new.conversation_id
          from public.ai_chat_conversation c
         where c.student_id = new.student_id
         order by c.updated_at desc limit 1;

        if new.conversation_id is null then
            insert into public.ai_chat_conversation (student_id)
            values (new.student_id)
            returning id into new.conversation_id;
        end if;
    end if;

    update public.ai_chat_conversation c
       set updated_at = now(),
           title = case
                     when c.title is null and new.role = 'user'
                     then left(regexp_replace(btrim(new.text), '\s+', ' ', 'g'), 60)
                     else c.title
                   end
     where c.id = new.conversation_id
       and c.student_id = new.student_id;

    return new;
end;
$$;
revoke all on function public.ai_chat_message_before_insert() from public, anon, authenticated;

drop trigger if exists ai_chat_message_before_insert on public.ai_chat_message;
create trigger ai_chat_message_before_insert
    before insert on public.ai_chat_message
    for each row execute function public.ai_chat_message_before_insert();

-- Insert policy: the conversation, if one is named, must be the student's own.
drop policy if exists "students insert own chat" on public.ai_chat_message;
create policy "students insert own chat"
    on public.ai_chat_message for insert
    with check (
        student_id = current_student_id()
        and (conversation_id is null
             or exists (select 1 from public.ai_chat_conversation c
                         where c.id = conversation_id and c.student_id = ai_chat_message.student_id))
    );

-- When old messages are cleaned up, drop the conversations that are left empty.
create or replace function public.ai_chat_drop_empty_conversations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.ai_chat_conversation c
     where c.id in (select conversation_id from old_rows where conversation_id is not null)
       and not exists (select 1 from public.ai_chat_message m where m.conversation_id = c.id);
    return null;
end;
$$;
revoke all on function public.ai_chat_drop_empty_conversations() from public, anon, authenticated;

drop trigger if exists ai_chat_message_after_delete on public.ai_chat_message;
create trigger ai_chat_message_after_delete
    after delete on public.ai_chat_message
    referencing old table as old_rows
    for each statement execute function public.ai_chat_drop_empty_conversations();


-- ROLLBACK ------------------------------------------------------------------
-- drop trigger if exists ai_chat_message_after_delete on public.ai_chat_message;
-- drop function if exists public.ai_chat_drop_empty_conversations();
-- drop trigger if exists ai_chat_message_before_insert on public.ai_chat_message;
-- drop function if exists public.ai_chat_message_before_insert();
-- drop policy if exists "students insert own chat" on public.ai_chat_message;
-- create policy "students insert own chat" on public.ai_chat_message for insert
--     with check (student_id = current_student_id());
-- alter table public.ai_chat_message drop column if exists conversation_id;
-- drop table if exists public.ai_chat_conversation;
