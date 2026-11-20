-- 128_submit_request_atomic.sql
--
-- One student, two submissions at the same instant: close the gap found on 20 Nov 2026.
--
-- Before: submit-advising-request CHECKED (is the subject already in a request? has the student sent one in the last 30 s?)
-- and then, as separate calls, INSERTED the request and its subjects. Two submissions sent together (two tabs, two
-- devices) could both pass the check before either had inserted, and put two requests for the same subjects in the
-- Faculty queue. A request whose subjects failed to save was also left behind without them.
--
-- Now: this function does the re-check and both inserts in ONE transaction, behind a lock held for that student only.
--   - pg_advisory_xact_lock(student): a second submission from the same student waits until the first has committed, then
--     sees it and is refused. Other students are not slowed.
--   - the request row and its subjects are written together; if the subjects fail, nothing is kept.
--
-- SECURITY INVOKER on purpose: it runs as the signed-in student, so the same row-level security that guarded the two inserts
-- before still guards them (students_create_own_requests, "students insert own request items").
--
-- The rules are the ones in supabase/functions/submit-advising-request/core.js (lockedSubjectIds, submissionLimit):
--   a subject is held by its latest request that is not withdrawn, unless that whole plan was sent back by the Registrar
--   or that item was rejected; 30 s between requests; 5 requests in 24 hours.
-- The edge function still checks first with core.js (a friendly early answer, and the dry run); this is the part nobody
-- can race past.
--
-- Answers are error messages that start with a code the edge function turns into a plain sentence:
--   ALREADY_SUBMITTED:<codes>   RATE_GAP:<seconds>   RATE_DAY:<hours>   NOT_A_STUDENT   NO_ITEMS
--
-- Rollback:  drop function public.submit_advising_request(integer, integer, integer, jsonb);

create or replace function public.submit_advising_request(
    p_prospectus_id integer,
    p_term          integer,
    p_year          integer,
    p_items         jsonb          -- [{ "subject_id": 1, "offering_id": 2 | null, "status": "valid" | "flagged", "remarks": "..." }]
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    sid     uuid := current_student_id();
    rid     integer;
    held    text;
    last_at timestamp;
    fifth   timestamp;
    n_day   integer;
    wait_s  integer;
begin
    if sid is null then
        raise exception 'NOT_A_STUDENT';
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
        raise exception 'NO_ITEMS';
    end if;

    -- One submission at a time per student. Released when this transaction ends.
    perform pg_advisory_xact_lock(hashtextextended('submit_advising_request:' || sid::text, 0));

    -- Subjects already held by an earlier request (same rule as lockedSubjectIds in core.js).
    with latest as (
        select distinct on (ri.subject_id)
               ri.subject_id, ri.status as item_status, r.registrar_status
          from request_item ri
          join request r on r.id = ri.request_id
         where r.student_id = sid
           and coalesce(r.status, '') <> 'withdrawn'
         order by ri.subject_id, r.created_at desc, r.id desc
    )
    select string_agg(s.code, ', ' order by s.code)
      into held
      from latest l
      join subject s on s.id = l.subject_id
     where l.subject_id in (select (x ->> 'subject_id')::integer from jsonb_array_elements(p_items) x)
       and coalesce(l.registrar_status, '') <> 'rejected'
       and coalesce(l.item_status, '') <> 'rejected';

    if held is not null then
        raise exception 'ALREADY_SUBMITTED:%', held;
    end if;

    -- How often a student may send a plan (same numbers as submissionLimit in core.js).
    select max(created_at) into last_at from request where student_id = sid;
    if last_at is not null and last_at <= localtimestamp then
        wait_s := 30 - ceil(extract(epoch from (localtimestamp - last_at)))::integer;
        if wait_s > 0 then
            raise exception 'RATE_GAP:%', wait_s;
        end if;
    end if;

    select count(*) into n_day
      from request
     where student_id = sid and created_at <= localtimestamp and created_at > localtimestamp - interval '24 hours';
    if n_day >= 5 then
        select created_at into fifth
          from request
         where student_id = sid and created_at <= localtimestamp and created_at > localtimestamp - interval '24 hours'
         order by created_at desc
         offset 4 limit 1;
        raise exception 'RATE_DAY:%', greatest(1, ceil(extract(epoch from (fifth + interval '24 hours' - localtimestamp)) / 3600)::integer);
    end if;

    insert into request (student_id, prospectus_id, requested_term, requested_year, status)
    values (sid, p_prospectus_id, p_term, p_year, 'submitted')
    returning id into rid;

    insert into request_item (request_id, subject_id, offering_id, status, remarks)
    select rid,
           (x ->> 'subject_id')::integer,
           nullif(x ->> 'offering_id', '')::integer,
           coalesce(x ->> 'status', 'pending'),
           x ->> 'remarks'
      from jsonb_array_elements(p_items) x;

    return rid;
end;
$$;

revoke all on function public.submit_advising_request(integer, integer, integer, jsonb) from public, anon;
grant execute on function public.submit_advising_request(integer, integer, integer, jsonb) to authenticated;
