-- 112_flagged_cannot_be_approved.sql
--
-- Replaces db/111's "approve anyway" rule with a stricter one, as the faculty asked: a subject the system flagged when
-- the plan was submitted CANNOT be approved, for any reason. The adviser can only reject it (with a reason the student
-- sees). db/111 allowed an approval if the adviser wrote a justification; that door is now closed.
--
-- Only the trigger function changes. The trigger from db/111 stays: it fires on a flagged -> approved change and
-- nothing else, so valid -> approved, flagged -> rejected and every other update are untouched.
--
-- (A schedule clash is not a flag, so it is not checked here: the page blocks it, using the sections on the plan.)
--
-- TO UNDO: re-run db/111_flagged_approval_guard.sql (the "approve anyway" version).
--
-- Safe to re-run.

create or replace function public.request_item_flag_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
    raise exception 'A flagged subject cannot be approved (%). It can only be rejected.', btrim(coalesce(old.remarks, ''))
        using errcode = '23514';
end;
$$;

-- The trigger itself is created by db/111; make sure it exists if this file is run on its own.
drop trigger if exists request_item_flag_guard on public.request_item;
create trigger request_item_flag_guard
    before update of status, remarks on public.request_item
    for each row
    when (old.status = 'flagged' and new.status = 'approved')
    execute function public.request_item_flag_guard();
