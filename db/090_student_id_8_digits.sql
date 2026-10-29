-- 090_student_id_8_digits.sql
--
-- A student ID becomes 8 digits: the 2-digit year, then a 6-digit counter that restarts every year
-- (26000001, 26000002, ... in 2026). The printed UC enrolment form (UC-Form 1A) has 8 ID boxes.
--
-- Decided with the user (29 Oct 2026):
--   * format YY + 6-digit counter (up to 999,999 a year);
--   * the existing IDs are converted by inserting a 0 after the first two digits
--     (2600001 -> 26000001, 2401187 -> 24001187). One rule for every row, so two IDs can never collide;
--   * 8 digits only, from now on: nothing 7 digits is accepted anywhere.
--
-- What this does:
--   1. converts the IDs already in university_student, and swaps the format check to 8 digits;
--   2. next_student_id(): lpad to 6 and the 999999 ceiling;
--   3. _provision_account (admin form and bulk upload): a typed ID must be 8 digits;
--   4. resolve_login_identifier: uc-<8 digits> signs in (a short number is padded to 8, as before).
--   The three functions are rewritten from their LIVE definitions by text replacement, and each replacement is
--   checked, so this fails loudly instead of silently leaving a 7 somewhere.
--
-- ORDER OF ROLLOUT: publish the web changes first (register.js, admindashboard.js, expectedstudents.js,
-- departmentdashboard.js, auth.js) and the Android build, then run THIS file. Between the two, a student typing
-- a 7-digit ID is refused by the page, and an 8-digit one by the old database check; run it promptly.
--
-- TO CHECK AFTERWARDS: select length(student_id), count(*) from university_student group by 1;  (only 8)
--   register a test "new student", approve it as the Registrar and see an 8-digit ID (26000004 or later).
-- TO UNDO: remove the 0 again (left(id,2) || substr(id,4)) for IDs that have a 0 in that place, restore the
--   7-digit check and re-run db/045's next_student_id and db/044's _provision_account. IDs issued after this
--   file carry the year and 6 digits and would need their own decision, so take a backup first.

-- ---------------------------------------------------------------------
-- 1. The IDs already issued, and the format check
-- ---------------------------------------------------------------------
alter table public.university_student drop constraint if exists university_student_id_format;

update public.university_student
   set student_id = left(student_id, 2) || '0' || substr(student_id, 3)
 where student_id ~ '^\d{7}$';

alter table public.university_student
    add constraint university_student_id_format
    check (student_id is null or student_id ~ '^\d{8}$');

-- ---------------------------------------------------------------------
-- 2-4. The three functions, from their live definitions
-- ---------------------------------------------------------------------
do $$
declare
    v_def  text;
    v_new  text;
    v_fn   regprocedure;
    v_pair text[];
    -- { function, from, to } : every pair must change the function, or the migration stops.
    v_edits text[][] := array[
        array['public.next_student_id()',                  'lpad(v_n::text, 5',          'lpad(v_n::text, 6'],
        array['public.next_student_id()',                  'v_n > 99999',                'v_n > 999999'],
        array['public._provision_account(text,text,text,text,text,text,text,text,text,text,text,text,text)',
                                                           '^\d{7}$',                    '^\d{8}$'],
        array['public._provision_account(text,text,text,text,text,text,text,text,text,text,text,text,text)',
                                                           'must be 7 digits',           'must be 8 digits'],
        array['public._provision_account(text,text,text,text,text,text,text,text,text,text,text,text,text)',
                                                           '(YY + 5-digit counter)',     '(YY + 6-digit counter)'],
        array['public.resolve_login_identifier(text)',     'lpad(digits, 7, ''0'')',     'lpad(digits, 8, ''0'')']
    ];
    i integer;
begin
    for i in 1 .. array_length(v_edits, 1) loop
        v_fn  := v_edits[i][1]::regprocedure;
        v_def := pg_get_functiondef(v_fn);
        v_new := replace(v_def, v_edits[i][2], v_edits[i][3]);
        if v_new = v_def then
            raise exception 'db/090: "%" not found in %', v_edits[i][2], v_edits[i][1];
        end if;
        execute v_new;       -- CREATE OR REPLACE FUNCTION with the edit
    end loop;
end
$$;

-- A last look: no function may still insist on 7.
do $$
declare v_left text;
begin
    select string_agg(p.proname, ', ') into v_left
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('next_student_id', '_provision_account', 'resolve_login_identifier')
       and (pg_get_functiondef(p.oid) ~ '\\d\{7\}' or pg_get_functiondef(p.oid) ~ 'lpad\(digits, 7' or pg_get_functiondef(p.oid) ~ 'lpad\(v_n::text, 5');
    if v_left is not null then
        raise exception 'db/090: still 7 digits in %', v_left;
    end if;
end
$$;
