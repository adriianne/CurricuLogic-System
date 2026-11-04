-- 093_reject_duplicate_name.sql   (DRAFT, not applied: review, then apply once)
--
-- Request an account, two changes that belong together:
--
--  A. A MIDDLE NAME column (optional). The UC enrollment form already reads student.middle_name, but the
--     column did not exist, so it was always blank.
--       - NULL is fine (no middle name).
--       - When given: at least 2 letters, starts with a letter, at most 60 characters, and none of the
--         harmful characters db/060 already refuses (control and zero-width characters,
--         < > = @ + * % $ # ^ ~ | \ / { } [ ] ; : " ! ? and digits).
--       - The browser rule is stricter and gives the friendly message (namerules.js middleProblem).
--
--  B. A new student whose first, middle and last name all match someone who already has an account
--     (approved) or a request waiting (pending) is rejected, whatever email they give. Declined requests
--     do not count, so a person whose request was declined can try again. Names are compared ignoring case,
--     extra spaces and common accents (public._norm_name, db/085); a missing middle name counts as "none",
--     so "Ana Cruz" and "Ana Reyes Cruz" are different people.
--       1. name_already_registered(first, last, middle): lets the Register page ask BEFORE it creates the
--          sign-in account, so a rejected request leaves nothing behind. Answers true or false, never a row.
--       2. student_register_name_guard: a trigger that enforces the same rule inside the database, so it
--          cannot be skipped by calling the API directly. Like student_register_guard (db/046) it only
--          restricts direct callers (anon / authenticated). Accounts made by the administrator (create
--          account, bulk upload) are NOT affected, which is how two real people who share a name still get
--          their accounts.
--       Only the "new student" path is checked: a student claiming an existing record is matched on ID.
--
-- Safe to re-run. To undo:
--   drop trigger if exists student_register_name_guard on public.university_student;
--   drop function if exists public.student_register_name_guard();
--   drop function if exists public.name_already_registered(text, text, text);
--   alter table public.university_student drop constraint if exists university_student_middle_name_chars;
--   alter table public.university_student drop column if exists middle_name;   -- loses typed middle names

begin;

-- A. the column and its rule ----------------------------------------------------------------------------
alter table public.university_student add column if not exists middle_name text;

alter table public.university_student drop constraint if exists university_student_middle_name_chars;
alter table public.university_student add constraint university_student_middle_name_chars check (
  middle_name is null
  or (
        char_length(middle_name) between 2 and 60
    and middle_name !~ '[\x01-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff<>=@+*%$#^~|\\/{}\[\];:"!?0-9]'
    and middle_name ~ '^[[:alpha:]]'
    and middle_name ~ '[[:alpha:]].*[[:alpha:]]'
  )
);

-- B. the same-name rule -------------------------------------------------------------------------------
drop function if exists public.name_already_registered(text, text);

create or replace function public.name_already_registered(p_first_name text, p_last_name text, p_middle_name text default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public._norm_name(p_first_name) <> ''
     and public._norm_name(p_last_name)  <> ''
     and exists (
       select 1 from public.university_student s
       where public._norm_name(s.first_name)  = public._norm_name(p_first_name)
         and public._norm_name(s.last_name)   = public._norm_name(p_last_name)
         and public._norm_name(s.middle_name) = public._norm_name(p_middle_name)
         and coalesce(s.approval_status, 'pending') <> 'declined'
     );
$$;

revoke all on function public.name_already_registered(text, text, text) from public;
grant execute on function public.name_already_registered(text, text, text) to anon, authenticated;

-- SECURITY INVOKER on purpose (same reason as db/046): inside a SECURITY DEFINER function current_user
-- would be the owner and the "direct caller" test below would never fire.
create or replace function public.student_register_name_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.declared_path = 'new'
     and public.name_already_registered(new.first_name, new.last_name, new.middle_name) then
    raise exception 'A student with this name already has an account or a pending request.'
      using errcode = '23505', constraint = 'student_name_taken';
  end if;
  return new;
end;
$$;

drop trigger if exists student_register_name_guard on public.university_student;
create trigger student_register_name_guard
  before insert on public.university_student
  for each row execute function public.student_register_name_guard();

commit;
