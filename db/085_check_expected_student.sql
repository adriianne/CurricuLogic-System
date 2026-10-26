-- 085_check_expected_student.sql
--
-- Lets the Register page ask "is this person on the EDP list?" without being able to read the list.
-- expected_student (db/084) is admin-only, so a signed-out visitor cannot select from it. This function
-- runs with the owner's rights and answers with one word, never a row.
--
--   'match'     the details match a student on the list
--   'no_match'  they do not
--   'no_list'   no list has been uploaded yet, so nothing can be checked (the page then says nothing)
--
-- How it matches, because the two ways of registering give different details:
--   - "existing record" path: the student typed a student ID. Matches on ID (and programme, if given).
--   - "new student" path: no ID is typed. Matches on first name + last name + programme.
-- Names are compared ignoring case, extra spaces and the common accents (n with tilde, a/e/i/o/u with
-- accent). Programme is compared only when one was sent.
--
-- It only advises: the page warns and still lets the student submit (the Registrar's flag is step 4).
-- Same answer whichever field is wrong, so nobody can probe the list one field at a time.
-- Safe to re-run.

create or replace function public._norm_name(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           translate(lower(btrim(coalesce(p, ''))),
                     'ñáàâäéèêëíìîïóòôöúùûü',
                     'naaaaeeeeiiiioooouuuu'),
           '\s+', ' ', 'g');
$$;

create or replace function public.check_expected_student(
    p_student_id text,
    p_first_name text,
    p_last_name  text,
    p_program_id integer
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text := btrim(regexp_replace(coalesce(p_student_id, ''), '^uc-', '', 'i'));
  v_found boolean;
begin
  if not exists (select 1 from public.expected_student) then
    return 'no_list';
  end if;

  if v_id <> '' then
    select exists (
      select 1 from public.expected_student e
      where e.student_id = v_id
        and (p_program_id is null or e.program_id = p_program_id)
    ) into v_found;
  else
    if public._norm_name(p_first_name) = '' or public._norm_name(p_last_name) = '' then
      return 'no_match';
    end if;
    select exists (
      select 1 from public.expected_student e
      where public._norm_name(e.first_name) = public._norm_name(p_first_name)
        and public._norm_name(e.last_name)  = public._norm_name(p_last_name)
        and (p_program_id is null or e.program_id = p_program_id)
    ) into v_found;
  end if;

  return case when v_found then 'match' else 'no_match' end;
end;
$$;

revoke all on function public._norm_name(text) from public, anon, authenticated;
revoke all on function public.check_expected_student(text, text, text, integer) from public;
grant execute on function public.check_expected_student(text, text, text, integer) to anon, authenticated;
