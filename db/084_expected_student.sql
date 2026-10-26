-- 084_expected_student.sql
--
-- Applied 24 Oct 2026.
--
-- The list of students the EDP office has confirmed, as received by the Admin. It is the reference
-- that self-registration is checked against (later steps). Nothing reads it yet, so nothing changes
-- for anyone when this is applied.
--
-- Admin only: the list holds names and e-mail addresses, and the Admin is the one who receives it.
-- Safe to re-run.

create table if not exists public.expected_student (
    id           uuid primary key default gen_random_uuid(),
    student_id   varchar(20)  not null unique,
    first_name   varchar(100) not null,
    last_name    varchar(100) not null,
    program_id   integer      not null references public.program(id),
    email        varchar(255) not null,      -- the address EDP has on file; setup links go here
    uploaded_by  uuid         default auth.uid(),
    uploaded_at  timestamptz  not null default now(),
    updated_at   timestamptz  not null default now()
);

alter table public.expected_student enable row level security;

drop policy if exists admin_all_expected_student on public.expected_student;
create policy admin_all_expected_student on public.expected_student
    for all to authenticated
    using (is_system_admin())
    with check (is_system_admin());

revoke all on public.expected_student from anon, authenticated;
grant select, insert, update, delete on public.expected_student to authenticated;
