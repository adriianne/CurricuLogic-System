-- 091_section_changed_at.sql
--
-- A student who switches a section after the adviser approved the plan (move_request_item_section, db/079)
-- has to print the enrollment form again and get it signed again: the Dean/Chairperson/Head signed the OLD
-- section. The printed UC form (shared/js/enrolment/enrollmentform.js) marks such a reprint as REVISED, so the
-- EDP office and the Dean can tell it from the first copy. For that the database must remember WHEN a section
-- was changed, which nothing recorded before.
--
-- What this does (additive, nothing is removed):
--   1. request_item.section_changed_at: null until a student switches the section of that subject;
--   2. move_request_item_section() sets it. The function is rewritten from its LIVE definition by text
--      replacement, and the replacement is checked, so this stops loudly if the function was changed.
--
-- TO CHECK AFTERWARDS: select count(*) from request_item where section_changed_at is not null;  (0 until a switch)
-- TO UNDO: alter table request_item drop column section_changed_at; and re-run db/079's function
--   (the page and the form work without the column: they only lose the REVISED mark).

alter table public.request_item add column if not exists section_changed_at timestamptz;

do $$
declare
    v_def text;
    v_new text;
begin
    v_def := pg_get_functiondef('public.move_request_item_section(integer,integer)'::regprocedure);
    if position('section_changed_at' in v_def) > 0 then
        return;                                   -- already patched
    end if;
    v_new := replace(v_def, 'edp_reported_at = null,', 'edp_reported_at = null,' || E'\n           section_changed_at = now(),');
    if v_new = v_def then
        raise exception 'db/091: the text to patch was not found in move_request_item_section';
    end if;
    execute v_new;
end
$$;
