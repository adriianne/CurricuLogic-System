-- 065_drop_unused_tables.sql
--
-- Removes four tables that nothing uses any more:
--
--   * system_log       empty; audit_log does this job.
--   * request_approval empty; decisions live in request_review and request.
--   * enrollment_item, enrollment
--                      empty; the advising request / request_item flow
--                      replaced them. No web, app or edge-function code
--                      reads or writes them. Their own policies go with them.
--
-- Safe by construction:
--   * it stops with an error if any of the four has a row, so nothing that
--     holds data can be dropped by mistake;
--   * DROP TABLE without CASCADE, so it also stops if anything else still
--     depends on one of them (a foreign key, a view).
--
-- Not removed on purpose: elective_group(_member), stg_subject,
-- stg_prerequisite, student_id_counter, maintenance_log (all still used).
-- Left for a later step: ai_recommendation, recommendation_item (the
-- delete_draft_prospectus function still touches them) and section
-- (subject_offering.section_id points at it).
--
-- Not safe to re-run after it has succeeded only in the sense that the tables
-- are gone; the IF EXISTS makes a second run do nothing.

do $$
declare
    t text;
    n bigint;
begin
    foreach t in array array['system_log', 'request_approval', 'enrollment_item', 'enrollment'] loop
        if to_regclass('public.' || t) is not null then
            execute format('select count(*) from public.%I', t) into n;
            if n > 0 then
                raise exception 'public.% has % row(s); not dropping it.', t, n;
            end if;
        end if;
    end loop;
end $$;

drop table if exists public.system_log;
drop table if exists public.request_approval;
drop table if exists public.enrollment_item;
drop table if exists public.enrollment;
