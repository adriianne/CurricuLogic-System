-- 059_chat_schedule_option.sql
--
-- Cura can now offer alternative clash-free schedules ("Afternoon classes", "Include
-- CC-ACCTG21", ...) and draw the one the student asks for. Like the other chat tables,
-- the conversation keeps only a pointer, never the contents: show_schedule_table (db/058)
-- says a schedule table went with the answer, and this column says WHICH alternative (its
-- label), or is null for the current plan. When the chat is reopened the table is rebuilt
-- from today's plan; a label that no longer exists simply shows no table.
--
-- Safe to re-run. Apply it before the website or app code that writes the column is used.

alter table public.ai_chat_message
    add column if not exists schedule_option text;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'ai_chat_message_schedule_option_maxlen'
          and conrelid = 'public.ai_chat_message'::regclass
    ) then
        alter table public.ai_chat_message
            add constraint ai_chat_message_schedule_option_maxlen
            check (schedule_option is null or char_length(schedule_option) <= 60);
    end if;
end $$;
