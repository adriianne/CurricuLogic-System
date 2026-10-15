-- 075_ai_chat_delete.sql
--
-- STATUS: APPLIED to the live database (verified 2026-10-14 in a rolled-back test: a student deletes their own chat, 0 rows of another student's).
--
-- WHY
--   The chat list (074) lets a student rename a conversation but not remove one.
--   They asked for a delete option with a confirmation pop-up.
--
-- WHAT THIS CHANGES
--   A student may DELETE their own rows in ai_chat_conversation. The messages in
--   it go with it (ai_chat_message.conversation_id is ON DELETE CASCADE), so the
--   conversation is gone for good. Nothing else changes: no other table is touched,
--   no new access to other students' chats, and ai_chat_message still has no
--   delete policy of its own (the cascade does the deleting).
--
-- HOW TO UNDO: run the ROLLBACK block at the bottom.

drop policy if exists "students delete own conversations" on public.ai_chat_conversation;
create policy "students delete own conversations"
    on public.ai_chat_conversation for delete to authenticated
    using (student_id = current_student_id());

grant delete on public.ai_chat_conversation to authenticated;


-- ROLLBACK ------------------------------------------------------------------
-- drop policy if exists "students delete own conversations" on public.ai_chat_conversation;
-- revoke delete on public.ai_chat_conversation from authenticated;
