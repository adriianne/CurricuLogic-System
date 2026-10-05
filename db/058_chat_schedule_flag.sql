-- 058_chat_schedule_flag.sql
--
-- Cura can now answer "when do my subjects meet?" with a schedule table (subject,
-- section, days and times) drawn by the app from the student's real plan. Like the
-- plan table, the conversation remembers THAT a table went with an answer, never
-- its contents: when the chat is reopened the table is rebuilt from the data as it
-- is now. This adds the flag next to show_recommended_table (db/029).
--
-- Safe to re-run. Apply this BEFORE the website code that writes the column is
-- used, or saving a chat message will fail.

alter table public.ai_chat_message
    add column if not exists show_schedule_table boolean not null default false;
