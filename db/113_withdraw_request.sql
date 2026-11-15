-- 113_withdraw_request.sql   (14 Nov 2026)   DRAFT: review, then run once in the Supabase SQL editor.
--
-- A student can take back a plan the adviser has not started on.
--
-- THE RULE (checked here, in the database, not only on the page)
--   A student may withdraw their OWN request, only while request.status is 'submitted', and only while the adviser
--   has decided nothing: no subject approved or rejected, no review row. The request is not deleted: its status
--   becomes 'withdrawn', so the history stays (who, when, which subjects) and the adviser's queue, counts and
--   reports, which all look for 'submitted', no longer see it.
--
-- WHAT IS ADDED
--   1. public.withdraw_my_request(p_request_id)  one atomic UPDATE that checks the rule and withdraws in the same
--      statement, so an adviser pressing Approve at the same moment cannot be overtaken. Returns
--      { ok: true } or { ok: false, reason: 'not_found' | 'not_waiting' | 'already_reviewed' }.
--   2. request_item_withdrawn_guard  refuses to approve or reject a subject of a withdrawn request (a stale adviser
--      page cannot undo the withdrawal).
--   3. request_withdrawn_final       a withdrawn request cannot be changed back to another status.
--   4. An audit_log row for every withdrawal (action WITHDRAW_REQUEST). audit_log stays append-only (db/054).
--
-- NOT HERE (and needed for the subjects to be free again): the submit function ignores withdrawn requests when it
-- decides which subjects are "already awaiting a decision" (supabase/functions/submit-advising-request/core.js,
-- assess-student shares it). Rebuild and redeploy both functions after this migration.
--
-- TO UNDO (only if no request has been withdrawn yet; withdrawn rows would need a status first):
--   alter table public.request drop constraint request_status_values;
--   alter table public.request add constraint request_status_values
--       check (status is null or status::text = any (array['submitted', 'approved', 'partially_approved', 'rejected']));
--   drop function if exists public.withdraw_my_request(integer);
--   drop trigger if exists request_item_withdrawn_guard on public.request_item;
--   drop function if exists public.request_item_withdrawn_guard();
--   drop trigger if exists request_withdrawn_final on public.request;
--   drop function if exists public.request_withdrawn_final();
--
-- Safe to re-run.

-- 0. allow the new status ----------------------------------------------------------------------------------------
-- request.status has a CHECK constraint (request_status_values, from before the numbered migrations: it is only in the
-- schema snapshots) that lists the allowed values. 'withdrawn' must be on the list or the update below is refused
-- ("violates check constraint request_status_values"): the live test on 15 Nov hit exactly that. Every existing row
-- already holds one of the old four values, so re-adding the constraint with one more value cannot fail.
alter table public.request drop constraint if exists request_status_values;
alter table public.request add constraint request_status_values
    check (status is null or status::text = any (array['submitted', 'approved', 'partially_approved', 'rejected', 'withdrawn']));

-- 1. the withdraw call -----------------------------------------------------------------------------------------
create or replace function public.withdraw_my_request(p_request_id integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_student uuid := public.current_student_id();
    v_n       integer;
    v_status  text;
begin
    if v_student is null then
        raise exception 'Only a signed-in student can withdraw a request.' using errcode = '42501';
    end if;

    -- The rule and the change in ONE statement: nothing can slip in between "check" and "update".
    update public.request r
       set status = 'withdrawn', updated_at = now()
     where r.id = p_request_id
       and r.student_id = v_student
       and r.status = 'submitted'
       and r.registrar_status is null
       and not exists (select 1 from public.request_item i
                        where i.request_id = r.id and i.status in ('approved', 'rejected'))
       and not exists (select 1 from public.request_review v where v.request_id = r.id);
    get diagnostics v_n = row_count;

    if v_n = 0 then
        -- Say why, without revealing anything about somebody else's request.
        select r.status into v_status from public.request r where r.id = p_request_id and r.student_id = v_student;
        if not found then
            return jsonb_build_object('ok', false, 'reason', 'not_found');
        elsif v_status <> 'submitted' then
            return jsonb_build_object('ok', false, 'reason', 'not_waiting', 'status', v_status);
        else
            return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
        end if;
    end if;

    insert into public.audit_log (actor_id, actor_role, action, table_name, record_id, old_values, new_values)
    values (auth.uid(), 'student', 'WITHDRAW_REQUEST', 'request', p_request_id::text,
            jsonb_build_object('status', 'submitted'), jsonb_build_object('status', 'withdrawn'));

    return jsonb_build_object('ok', true, 'id', p_request_id);
end;
$$;

-- Signed-in users only (db/052 keeps the list of what signed-out visitors may call to one function).
revoke all on function public.withdraw_my_request(integer) from public, anon;
grant execute on function public.withdraw_my_request(integer) to authenticated;

-- 2. no decision on a withdrawn plan -----------------------------------------------------------------------------
create or replace function public.request_item_withdrawn_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
    -- (A trigger's WHEN clause cannot hold a subquery, so the look at the parent request is done here.)
    if exists (select 1 from public.request r where r.id = new.request_id and r.status = 'withdrawn') then
        raise exception 'This request was withdrawn by the student, so its subjects can no longer be approved or rejected.'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists request_item_withdrawn_guard on public.request_item;
create trigger request_item_withdrawn_guard
    before update of status on public.request_item
    for each row
    when (new.status in ('approved', 'rejected') and old.status is distinct from new.status)
    execute function public.request_item_withdrawn_guard();

-- 3. a withdrawn request stays withdrawn -----------------------------------------------------------------------
create or replace function public.request_withdrawn_final()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
    raise exception 'A withdrawn request cannot be changed. The student sends a new one.' using errcode = '23514';
    return new;   -- (never reached; keeps the function a valid trigger function)
end;
$$;

drop trigger if exists request_withdrawn_final on public.request;
create trigger request_withdrawn_final
    before update of status on public.request
    for each row
    when (old.status = 'withdrawn' and new.status is distinct from 'withdrawn')
    execute function public.request_withdrawn_final();

-- CHECK (run after): the function exists, both triggers exist
--   select proname from pg_proc where proname in ('withdraw_my_request', 'request_item_withdrawn_guard', 'request_withdrawn_final');
--   select tgname from pg_trigger where tgname in ('request_item_withdrawn_guard', 'request_withdrawn_final');
