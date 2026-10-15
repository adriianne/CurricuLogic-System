-- 077_edp_results.sql
--
-- DRAFT, NOT APPLIED. Read it, then run it in the Supabase SQL editor (or ask for it to be applied).
--
-- What the EDP office said about each subject of an approved plan, as the STUDENT reports it.
-- This system cannot see EDP; the student tells it, per subject, with a reason:
--
--   edp_result   'accepted'  the EDP office took the subject
--                'rejected'  it did not (edp_reason says why)
--                null        nothing reported yet
--   edp_reason   full | conflict | record | overload | code_error | hold | other   (only with 'rejected')
--
-- A report changes only the student's own plan. It never closes a section for anyone else:
-- only the Department can do that (is_open on subject_offering).
--
-- Students have no UPDATE policy on request_item (and should not), so the report goes through one
-- function that checks the item is the caller's own, in an approved plan the registrar did not reject,
-- and approved by the adviser. It writes only these three columns.

-- 1. the columns ------------------------------------------------------------------------------------
alter table public.request_item
    add column if not exists edp_result      text,
    add column if not exists edp_reason      text,
    add column if not exists edp_reported_at timestamptz;

alter table public.request_item
    add constraint request_item_edp_result_values
        check (edp_result is null or edp_result in ('accepted', 'rejected'));

alter table public.request_item
    add constraint request_item_edp_reason_values
        check (edp_reason is null or edp_reason in ('full', 'conflict', 'record', 'overload', 'code_error', 'hold', 'other'));

-- a reason belongs to a rejection, and only to a rejection
alter table public.request_item
    add constraint request_item_edp_reason_rule
        check (edp_reason is null or edp_result = 'rejected');

-- 2. the function -----------------------------------------------------------------------------------
-- p_results: [{ "item_id": 12, "result": "rejected", "reason": "full" },
--              { "item_id": 13, "result": "accepted" },
--              { "item_id": 14, "result": null }]          (null clears a report)
-- Returns how many subjects were updated. All or nothing: one bad entry undoes the rest.
create or replace function public.report_edp_results(p_results jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    me        uuid := current_student_id();
    entry     jsonb;
    v_item    integer;
    v_result  text;
    v_reason  text;
    n         integer := 0;
begin
    if me is null then
        raise exception 'Only a student account can report an EDP result.' using errcode = '42501';
    end if;
    if p_results is null or jsonb_typeof(p_results) <> 'array' then
        raise exception 'Send a list of results.';
    end if;
    if jsonb_array_length(p_results) > 40 then
        raise exception 'Send at most 40 results at a time.';
    end if;

    for entry in select * from jsonb_array_elements(p_results) loop
        v_item   := (entry ->> 'item_id')::integer;
        v_result := nullif(entry ->> 'result', '');
        v_reason := nullif(entry ->> 'reason', '');

        if v_result is not null and v_result not in ('accepted', 'rejected') then
            raise exception 'Unknown result "%".', v_result;
        end if;
        if v_result = 'rejected' and v_reason is null then
            raise exception 'Say why the EDP office rejected it.';
        end if;
        if v_reason is not null and v_reason not in ('full', 'conflict', 'record', 'overload', 'code_error', 'hold', 'other') then
            raise exception 'Unknown reason "%".', v_reason;
        end if;

        update request_item ri
           set edp_result      = v_result,
               edp_reason      = case when v_result = 'rejected' then v_reason else null end,
               edp_reported_at = case when v_result is null then null else now() end
          from request rq
         where ri.id = v_item
           and rq.id = ri.request_id
           and rq.student_id = me
           and rq.status in ('approved', 'partially_approved')
           and rq.registrar_status is distinct from 'rejected'
           and ri.status = 'approved';

        if not found then
            raise exception 'That subject is not in one of your approved plans.';
        end if;
        n := n + 1;
    end loop;

    return n;
end;
$$;

revoke all on function public.report_edp_results(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.report_edp_results(jsonb) to authenticated;
grant execute on function public.report_edp_results(jsonb) to service_role;

-- Check (read-only), as a student: select edp_result, edp_reason from request_item where id = <one of yours>;
