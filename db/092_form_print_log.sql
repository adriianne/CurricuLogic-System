-- 092_form_print_log.sql
--
-- A record of every time the UC enrollment form (UC-Form 1A) is printed from an approved plan, so the adviser, the
-- Registrar and the student can see when it was printed and by whom ("a copy kept in the system", 30 Oct 2026).
-- The form itself is always built from the live plan, so a reprint is the same form; this table only remembers
-- the prints.
--
--   form_print                      one row per print. Nobody reads or writes it directly (no policy, no grants).
--   log_form_print(request_id)      called by the page after a successful print. Allowed for the plan's own student, the
--                                   student's adviser and the student's Registrar, and only for an approved plan.
--                                   It also writes an audit_log row (action PRINT_ENROLLMENT_FORM) for the Admin's log.
--   form_print_history(request_id)  the last 20 prints of a plan, newest first, with who printed (name, role) and the
--                                   total. Same people as above.
--
-- TO CHECK AFTERWARDS: select count(*) from form_print;  (0 until someone prints)
-- TO UNDO: drop function log_form_print(integer), form_print_history(integer); drop table form_print;
--   (audit_log rows written by prints stay, it is append-only by design.)

create table if not exists public.form_print (
    id          bigserial primary key,
    request_id  integer     not null references public.request(id) on delete cascade,
    printed_by  uuid        not null,
    printed_as  text        not null check (printed_as in ('student', 'faculty', 'registrar')),
    printed_at  timestamptz not null default now()
);
create index if not exists form_print_request_idx on public.form_print (request_id, printed_at desc);

alter table public.form_print enable row level security;
revoke all on public.form_print from public, anon, authenticated;
revoke all on sequence public.form_print_id_seq from public, anon, authenticated;

-- Who may use the plan's print log, and in what capacity. null = nobody.
create or replace function public._form_print_role(p_request_id integer)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
    v_student uuid;
    v_status  text;
    v_reg     text;
begin
    select student_id, status, registrar_status into v_student, v_status, v_reg
      from request where id = p_request_id;
    if not found then
        return null;
    end if;
    if v_status not in ('approved', 'partially_approved') or v_reg is not distinct from 'rejected' then
        return null;                                   -- only an approved plan has a form
    end if;
    if current_student_id() is not null and current_student_id() = v_student then
        return 'student';
    elsif is_adviser_of_request(p_request_id) then
        return 'faculty';
    elsif is_registrar_of_student(v_student) then
        return 'registrar';
    end if;
    return null;
end;
$function$;
revoke all on function public._form_print_role(integer) from public, anon, authenticated;

create or replace function public.log_form_print(p_request_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_uid uuid := auth.uid();
    v_as  text;
begin
    if v_uid is null then
        raise exception 'Not signed in.' using errcode = '42501';
    end if;
    v_as := _form_print_role(p_request_id);
    if v_as is null then
        raise exception 'You cannot print the form of this plan.' using errcode = '42501';
    end if;

    insert into form_print (request_id, printed_by, printed_as) values (p_request_id, v_uid, v_as);

    insert into audit_log (actor_id, actor_role, action, table_name, record_id, new_values)
    values (v_uid, v_as, 'PRINT_ENROLLMENT_FORM', 'request', p_request_id::text,
            jsonb_build_object('printed_as', v_as));
end;
$function$;

create or replace function public.form_print_history(p_request_id integer)
returns table (printed_at timestamptz, printed_as text, printed_by_name text, total bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
    if auth.uid() is null or _form_print_role(p_request_id) is null then
        raise exception 'You cannot see the prints of this plan.' using errcode = '42501';
    end if;

    return query
    select fp.printed_at,
           fp.printed_as,
           coalesce(
               nullif(trim(coalesce(f.first_name, '') || ' ' || coalesce(f.last_name, '')), ''),
               nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
               nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''),
               ''
           ) as printed_by_name,
           count(*) over () as total
      from form_print fp
      left join faculty_staff   f on f.user_id = fp.printed_by
      left join registrar_staff r on r.user_id = fp.printed_by
      left join university_student s on s.user_id = fp.printed_by
     where fp.request_id = p_request_id
     order by fp.printed_at desc
     limit 20;
end;
$function$;

revoke all on function public.log_form_print(integer), public.form_print_history(integer) from public, anon;
grant execute on function public.log_form_print(integer), public.form_print_history(integer) to authenticated;
