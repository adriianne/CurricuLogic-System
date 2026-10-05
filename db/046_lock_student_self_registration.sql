-- 046: lock down the signed-out "request an account" insert on university_student
-- (security item 17). DRAFT: review, then run once in the Supabase SQL editor.
--
-- Problem: policy anon_can_request_account only checks is_approved = false and
-- record_verified = false. A direct REST call could therefore also set
-- approval_status, reviewed_*, verified_*, created_by, prospectus_id, year_level,
-- must_change_password, attach the row to ANY auth user (e.g. a staff member who
-- has no student row), or send very long text.
--
-- Why a trigger and not just the policy: with email confirmation on, the new
-- user has no session when register.js inserts (so auth.uid() is null and the
-- policy cannot require user_id = auth.uid()). The trigger checks the row
-- instead. It only restricts direct callers (current_user anon/authenticated);
-- the SECURITY DEFINER admin path (_provision_account) runs as the function
-- owner and is not affected.

begin;

-- Helper that needs to read auth.users (the caller cannot). Returns only a boolean.
create or replace function public._fresh_student_account(p_user uuid, p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_created timestamptz;
begin
  select u.created_at into v_created
  from auth.users u
  where u.id = p_user
    and lower(u.email) = lower(coalesce(p_email, ''));

  if v_created is null or v_created < now() - interval '15 minutes' then
    return false;
  end if;

  if exists (select 1 from public.faculty_staff   where user_id = p_user)
     or exists (select 1 from public.registrar_staff  where user_id = p_user)
     or exists (select 1 from public.department_staff where user_id = p_user)
     or exists (select 1 from public.system_administrator where user_id = p_user) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public._fresh_student_account(uuid, text) from public;
grant execute on function public._fresh_student_account(uuid, text) to anon, authenticated;

-- SECURITY INVOKER on purpose: inside a SECURITY DEFINER function current_user
-- is the owner, so the "direct caller" test below would never fire.
create or replace function public.student_register_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Admin / definer functions (_provision_account) run as the owner: leave them alone.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  -- Only plain pending requests, with nothing a reviewer would fill in.
  if new.approval_status is distinct from 'pending'
     or new.is_approved is distinct from false
     or new.record_verified is distinct from false
     or new.reviewed_by is not null or new.reviewed_at is not null or new.review_note is not null
     or new.verified_by is not null or new.verified_at is not null
     or new.created_by is not null
     or new.prospectus_id is not null
     or new.year_level is not null
     or new.must_change_password is distinct from false
     or new.academic_standing is distinct from 'regular'
     or new.created_via is distinct from 'SELF_REGISTER'
     or new.declared_path is null or new.declared_path not in ('new', 'existing') then
    raise exception 'Invalid registration request' using errcode = '42501';
  end if;

  -- Size limits (same as the form's maxlength).
  if char_length(coalesce(new.first_name, '')) > 60
     or char_length(coalesce(new.last_name, '')) > 60
     or char_length(coalesce(new.email, '')) > 254
     or char_length(coalesce(new.phone, '')) > 30 then
    raise exception 'Invalid registration request' using errcode = '22001';
  end if;

  -- The program, when given, must exist.
  if new.program_id is not null
     and not exists (select 1 from public.program p where p.id = new.program_id) then
    -- (anon can read program since db/026)
    raise exception 'Invalid registration request' using errcode = '23503';
  end if;

  -- The auth user must be brand new (created in the last 15 minutes), carry the
  -- same email, and not already be a staff/admin account. This stops anyone
  -- attaching a student row to somebody else's existing account.
  if not public._fresh_student_account(new.user_id, new.email) then
    raise exception 'Invalid registration request' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Fires after student_id_on_register (trigger names run alphabetically).
drop trigger if exists student_register_guard on public.university_student;
create trigger student_register_guard
  before insert on public.university_student
  for each row execute function public.student_register_guard();

-- Table privileges that RLS never covers (TRUNCATE) or that a signed-out
-- visitor has no use for.
revoke truncate, references, trigger on public.university_student from anon, authenticated;
revoke select, update, delete on public.university_student from anon;

commit;
