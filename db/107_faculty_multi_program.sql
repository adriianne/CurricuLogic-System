-- 107_faculty_multi_program.sql
--
-- A faculty adviser can cover MORE THAN ONE programme (a BSIT adviser also covering IS, AI and Animation, the way the
-- faculty respondents asked). Today a faculty account has a single programme: faculty_staff.program_id.
--
-- How:
--   * faculty_staff.program_id stays. It is the faculty member's MAIN programme, so everything that reads it keeps
--     working (account lists, the cap count in create_staff_account, the registrar's view of staff).
--   * a new table faculty_program lists EVERY programme a faculty member covers, the main one included.
--     Existing accounts are copied in, so nobody loses access.
--   * is_adviser_of_student, can_read_program and the "registrar reads faculty" rule now look at that table.
--   * Admin changes the list through set_faculty_programs(); the table has no write policy for anyone else.
--   * The cap stays at 10 faculty per programme, counted from faculty_program, so a faculty member covering two
--     programmes counts toward both. A trigger enforces it, so it holds for any way a row gets in.
--
-- Registrar and Department keep one programme each for now (their own migrations come later).
--
-- TO UNDO (in this order):
--   drop trigger faculty_program_cap on public.faculty_program;
--   drop trigger faculty_main_program_link on public.faculty_staff;
--   drop function public.set_faculty_programs(uuid, integer[]);
--   restore is_adviser_of_student and can_read_program from db/030 and db/024's snapshot, and the policy
--   "registrar reads faculty" (program_id = my_registrar_program()); then
--   drop table public.faculty_program;  drop function public.my_faculty_programs();
--
-- Safe to re-run.

-- ── 1. The table ───────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.faculty_program (
    faculty_id uuid    not null references public.faculty_staff(id) on delete cascade,
    program_id integer not null references public.program(id),
    created_at timestamptz not null default now(),
    primary key (faculty_id, program_id)
);

create index if not exists faculty_program_program_idx on public.faculty_program (program_id);

-- Every existing faculty member covers their current programme.
insert into public.faculty_program (faculty_id, program_id)
select id, program_id from public.faculty_staff where program_id is not null
on conflict do nothing;

-- ── 2. The main programme is always in the list ────────────────────────────────────────────────────────────────
create or replace function public.faculty_main_program_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    if new.program_id is not null then
        insert into public.faculty_program (faculty_id, program_id)
        values (new.id, new.program_id)
        on conflict do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists faculty_main_program_link on public.faculty_staff;
create trigger faculty_main_program_link
    after insert or update of program_id on public.faculty_staff
    for each row execute function public.faculty_main_program_link();

-- ── 3. The cap: 10 faculty per programme, counted across everyone who covers it ───────────────────────────────
create or replace function public.faculty_program_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_count integer;
    v_code  text;
begin
    select count(*) into v_count
    from public.faculty_program
    where program_id = new.program_id and faculty_id <> new.faculty_id;

    if v_count >= 10 then
        select code into v_code from public.program where id = new.program_id;
        raise exception '% already has the maximum of 10 faculty accounts.', coalesce(v_code, 'This programme')
            using errcode = '23505';
    end if;
    return new;
end;
$$;

drop trigger if exists faculty_program_cap on public.faculty_program;
create trigger faculty_program_cap
    before insert on public.faculty_program
    for each row execute function public.faculty_program_cap();

-- ── 4. Who can see the list ────────────────────────────────────────────────────────────────────────────────────
alter table public.faculty_program enable row level security;

drop policy if exists "faculty reads own programmes"   on public.faculty_program;
drop policy if exists "admin reads faculty programmes" on public.faculty_program;
drop policy if exists "registrar reads faculty programmes" on public.faculty_program;

create policy "faculty reads own programmes" on public.faculty_program
    for select to authenticated
    using (exists (select 1 from public.faculty_staff f where f.id = faculty_program.faculty_id and f.user_id = auth.uid()));

create policy "admin reads faculty programmes" on public.faculty_program
    for select to authenticated
    using (public.is_system_admin());

create policy "registrar reads faculty programmes" on public.faculty_program
    for select to authenticated
    using (program_id = public.my_registrar_program());

-- No insert, update or delete policy: only set_faculty_programs() (below) changes the list.

-- ── 5. The faculty member's own programmes, for the access rules ───────────────────────────────────────────────
create or replace function public.my_faculty_programs()
returns integer[]
language sql
stable
security definer
set search_path to 'public'
as $$
    select coalesce(array_agg(fp.program_id), '{}'::integer[])
    from public.faculty_program fp
    join public.faculty_staff f on f.id = fp.faculty_id
    where f.user_id = auth.uid() and f.is_approved;
$$;

revoke all on function public.my_faculty_programs() from public, anon, authenticated, service_role;
grant execute on function public.my_faculty_programs() to authenticated;
grant execute on function public.my_faculty_programs() to service_role;

-- ── 6. The access rules now use the list ───────────────────────────────────────────────────────────────────────
create or replace function public.is_adviser_of_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (
        select 1
        from university_student s
        join faculty_program fp on fp.program_id = s.program_id
        join faculty_staff f    on f.id = fp.faculty_id
        where s.id = p_student_id
          and f.user_id = auth.uid()
          and f.is_approved
    );
$$;

create or replace function public.can_read_program(p_program_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select p_program_id is not null and (
        exists (select 1 from system_administrator where user_id = auth.uid() and is_approved)
        or exists (select 1 from university_student where user_id = auth.uid() and program_id = p_program_id)
        or p_program_id = any (public.my_faculty_programs())
        or exists (select 1 from registrar_staff  where user_id = auth.uid() and is_approved and program_id = p_program_id)
        or exists (select 1 from department_staff where user_id = auth.uid() and is_approved and program_id = p_program_id)
    );
$$;

-- A Registrar sees every faculty member who covers their programme, not only those whose main programme it is.
drop policy if exists "registrar reads faculty" on public.faculty_staff;
create policy "registrar reads faculty" on public.faculty_staff
    for select to authenticated
    using (
        exists (
            select 1 from public.faculty_program fp
            where fp.faculty_id = faculty_staff.id
              and fp.program_id = public.my_registrar_program()
        )
    );

-- ── 7. Admin sets the list ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.set_faculty_programs(p_faculty_id uuid, p_program_ids integer[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_ids     integer[];
    v_main    integer;
    v_missing integer;
begin
    if not public.is_system_admin() then
        raise exception 'Only an administrator can change a faculty member''s programmes.' using errcode = '42501';
    end if;

    select array_agg(distinct x order by x) into v_ids from unnest(coalesce(p_program_ids, '{}'::integer[])) as x where x is not null;

    if v_ids is null or array_length(v_ids, 1) is null then
        raise exception 'A faculty member must cover at least one programme.' using errcode = '22023';
    end if;
    if array_length(v_ids, 1) > 12 then
        raise exception 'Too many programmes chosen.' using errcode = '22023';
    end if;

    select program_id into v_main from public.faculty_staff where id = p_faculty_id for update;
    if not found then
        raise exception 'That faculty account was not found.' using errcode = '02000';
    end if;

    select count(*) into v_missing from unnest(v_ids) as x where not exists (select 1 from public.program where id = x);
    if v_missing > 0 then
        raise exception 'One of the chosen programmes does not exist.' using errcode = '23503';
    end if;

    -- The main programme moves only if the old one was taken away.
    if v_main is null or not (v_main = any (v_ids)) then
        v_main := v_ids[1];
    end if;

    delete from public.faculty_program
    where faculty_id = p_faculty_id and not (program_id = any (v_ids));

    -- New rows go through the cap trigger. Rows already there are left alone.
    insert into public.faculty_program (faculty_id, program_id)
    select p_faculty_id, x from unnest(v_ids) as x
    on conflict do nothing;

    update public.faculty_staff set program_id = v_main where id = p_faculty_id and program_id is distinct from v_main;
end;
$$;

revoke all on function public.set_faculty_programs(uuid, integer[]) from public, anon, authenticated, service_role;
grant execute on function public.set_faculty_programs(uuid, integer[]) to authenticated;
grant execute on function public.set_faculty_programs(uuid, integer[]) to service_role;
