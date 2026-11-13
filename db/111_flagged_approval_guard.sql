-- 111_flagged_approval_guard.sql
--
-- Found on 12 Nov 2026 while testing the faculty review: one click on a flagged subject approved it, wiped the flag
-- reason, and nothing in the database objected (no trigger on request_item; the adviser's update rule allows any
-- status). "Approve all" did the same to every flagged subject.
--
-- Now a flagged subject can only become approved if:
--   * the flag is not a HARD STOP: already passed, already in progress, not in the student's curriculum, or the chosen
--     section is not offered. These can only be rejected. (The wording is the engine's own, in
--     supabase/functions/submit-advising-request/core.js; shared/js/enrolment/flagrules.js repeats it.)
--   * the new remarks start with the ORIGINAL flag, so it stays on the record, followed by the adviser's written
--     reason of at least 10 characters:   Approved despite flag (<flag>): <reason>
-- Everything else is untouched: valid -> approved, flagged -> rejected, any rejection, and every other column.
--
-- TO UNDO:  drop trigger request_item_flag_guard on public.request_item;
--           drop function public.request_item_flag_guard();
--
-- Safe to re-run.

create or replace function public.request_item_flag_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
    v_flag   text := btrim(coalesce(old.remarks, ''));
    v_prefix text := 'Approved despite flag (' || btrim(coalesce(old.remarks, '')) || '): ';
begin
    if v_flag ~* '(already passed|already in progress|not found in the current curriculum|section is not offered)' then
        raise exception 'This subject cannot be approved (%). It can only be rejected.', v_flag
            using errcode = '23514';
    end if;

    if new.remarks is null
       or left(new.remarks, length(v_prefix)) <> v_prefix
       or char_length(btrim(substr(new.remarks, length(v_prefix) + 1))) < 10 then
        raise exception 'A flagged subject can only be approved with a written reason after the flag: "Approved despite flag (...): ...".'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

drop trigger if exists request_item_flag_guard on public.request_item;
create trigger request_item_flag_guard
    before update of status, remarks on public.request_item
    for each row
    when (old.status = 'flagged' and new.status = 'approved')
    execute function public.request_item_flag_guard();
