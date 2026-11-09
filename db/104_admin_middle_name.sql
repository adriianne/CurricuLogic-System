-- 104_admin_middle_name.sql
--
-- The optional middle name, on the Admin side (the Register page has had it since db/093).
--
--   * expected_student.middle_name (optional): the middle name the EDP list gives for a student, under the same
--     rule as university_student.middle_name (2 to 60 characters, starts with a letter, no digits or symbols).
--   * set_student_middle_name(student_id, middle): sets or clears the middle name of an existing student. Used by
--     the Admin forms right after they create an account (create_user_account itself is not changed, so nothing
--     that already calls it can break). Allowed for the System Administrator only.
--
-- The same-name rule needs no change: name_already_registered (db/093) already treats a missing middle name as
-- "none" and compares first, middle and last name together.
--
-- TO UNDO: drop function public.set_student_middle_name(text, text);
--          alter table public.expected_student drop column middle_name;
--
-- Safe to re-run.

alter table public.expected_student add column if not exists middle_name text;

alter table public.expected_student drop constraint if exists expected_student_middle_name_chars;
alter table public.expected_student add constraint expected_student_middle_name_chars check (
  middle_name is null
  or (
        char_length(middle_name) between 2 and 60
    and middle_name !~ '[\x01-\x1f\x7f-\x9f​-‏ -‮⁠-⁤﻿<>=@+*%$#^~|\\/{}\[\];:"!?0-9]'
    and middle_name ~ '^[[:alpha:]]'
    and middle_name ~ '[[:alpha:]].*[[:alpha:]]'
  )
);

create or replace function public.set_student_middle_name(p_student_id text, p_middle text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
    v_middle text := nullif(btrim(coalesce(p_middle, '')), '');
begin
    if not public.is_system_admin() then
        raise exception 'Not allowed.' using errcode = '42501';
    end if;

    update public.university_student set middle_name = v_middle where student_id = p_student_id;
    if not found then
        raise exception 'No student with ID %.', p_student_id using errcode = 'P0002';
    end if;
end;
$$;

revoke all on function public.set_student_middle_name(text, text) from public, anon, authenticated;
grant execute on function public.set_student_middle_name(text, text) to authenticated;
