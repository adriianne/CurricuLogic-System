-- 086_edp_status.sql
--
-- Tells the Registrar and the Admin whether each student is on the EDP list (db/084), without letting
-- the Registrar read the list itself (it holds names and e-mail addresses and is admin-only).
--
--   edp_status(ids)  ->  one row per student the caller may see: (student_uuid, status)
--
--   status 'on_list'      the student matches a row on the list
--          'not_on_list'  they do not
--          'no_list'      no list has been uploaded yet, so nothing can be said
--
-- How a student is matched, the same rules as the Register page (db/085):
--   - registered as an EXISTING record (declared_path = 'existing', with a student ID): by student ID
--   - anyone else (a new student, or no ID yet): by first name + last name
--   and, when the student has a programme, the listed programme must be the same one.
--
-- Who may call it: the Admin (any student) and an approved Registrar (students of their own programme,
-- the same reach as is_registrar_of_student). Anyone else gets nothing back. At most 500 ids a call.
-- The Registrar page uses it to show a badge and to refuse Approve for "not_on_list"; that refusal is a
-- screen rule, not a database one. Safe to re-run.

create or replace function public.edp_status(p_ids uuid[])
returns table (student_uuid uuid, status text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_list boolean;
begin
  if coalesce(array_length(p_ids, 1), 0) > 500 then
    raise exception 'At most 500 students at a time.';
  end if;

  select exists (select 1 from public.expected_student) into v_has_list;

  return query
  select
    s.id,
    case
      when not v_has_list then 'no_list'
      when exists (
        select 1 from public.expected_student e
        where (s.program_id is null or e.program_id = s.program_id)
          and (
            (s.declared_path = 'existing' and s.student_id is not null and e.student_id = s.student_id)
            or
            ((s.declared_path is distinct from 'existing' or s.student_id is null)
              and public._norm_name(e.first_name) = public._norm_name(s.first_name)
              and public._norm_name(e.last_name)  = public._norm_name(s.last_name))
          )
      ) then 'on_list'
      else 'not_on_list'
    end
  from public.university_student s
  where s.id = any(p_ids)
    and (public.can_read_all_students() or public.is_registrar_of_student(s.id));
end;
$$;

revoke all on function public.edp_status(uuid[]) from public, anon;
grant execute on function public.edp_status(uuid[]) to authenticated;
