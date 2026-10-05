-- 028_registrar_reads_request_review.sql
--
-- STATUS: DRAFT. Not applied. Read it, then apply it.
--
-- WHY
--   request_review has SELECT policies for students (their own) and faculty
--   (their own) but NONE for the Registrar — this predates tonight's work,
--   not a regression from it. The Registrar's "Print approved plan" looks up
--   the request's review row to print the adviser's name on the slip
--   (registrardashboard.js, printApprovedPlan). With no policy allowing the
--   read, Postgres RLS does not error — it silently returns zero rows — so
--   every printed slip has shown the generic "Faculty adviser" instead of
--   the real name, confirmed live against request #8's real review rows.
--   (027 restored the Registrar's read of faculty_staff, which this same
--   query also needs, but request_review itself was still blocking it —
--   that is what this migration closes.)
--
-- WHAT THIS CHANGES
--   The Registrar may SELECT from request_review, for any request — mirroring
--   the access they already have on request and request_item
--   (registrar_read_all_requests, registrar_read_all_request_items). No
--   write access, and no other role's access changes.
--
-- HOW TO UNDO: run the ROLLBACK line at the bottom.

drop policy if exists "registrar reads all reviews" on public.request_review;
create policy "registrar reads all reviews"
    on public.request_review for select
    using (exists (
        select 1 from registrar_staff r
        where r.user_id = auth.uid() and r.is_approved
    ));


-- ROLLBACK ------------------------------------------------------------------
-- drop policy if exists "registrar reads all reviews" on public.request_review;
