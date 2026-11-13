-- 110_registrar_multi_program.sql
--
-- A Registrar can cover MORE THAN ONE programme, and unlike Faculty (db/107, db/108) there is no college rule: a
-- Registrar may cover BSIT together with BSED and BSHM. Admin sets the list.
--
-- Same shape as db/107:
--   * registrar_staff.program_id stays as the Registrar's MAIN programme.
--   * a new table registrar_program lists EVERY programme a Registrar covers, the main one included. Existing
--     accounts are copied in.
--   * the functions that said "the registrar's programme" now say "any of the registrar's programmes".
--   * the cap of 2 Registrars per programme is a trigger, counted across everyone who covers the programme.
--   * every cross-table check in a security rule goes through a SECURITY DEFINER function, so the rules cannot loop
--     (the mistake db/107 made and db/109 repaired).
--
-- TO UNDO (in this order):
--   drop trigger registrar_program_cap on public.registrar_program;
--   drop trigger registrar_main_program_link on public.registrar_staff;
--   restore is_registrar_of_student, department_ids_for_my_registrar, registrar_covers_faculty and can_read_program
--   from their earlier definitions (db/034, db/107), and the policy "registrar reads faculty programmes" with
--   (program_id = my_registrar_program());
--   drop function public.set_registrar_programs(uuid, integer[]); drop function public.my_registrar_programs();
--   drop function public.is_my_registrar_row(uuid); drop table public.registrar_program;
--
-- Safe to re-run.

-- ── 1. The table ───────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.registrar_program (
    registrar_id uuid    not null references public.registrar_staff(id) on delete cascade,
    program_id   integer not null references public.program(id),
    created_at   timestamptz not null default now(),
    primary key (registrar_id, program_id)
);

create index if not exists registrar_program_program_idx on public.registrar_program (program_id);

insert into public.registrar_program (registrar_id, program_id)
select id, program_id from public.registrar_staff where program_id is not null
on conflict do nothing;

-- ── 2. The main programme is always in the list ────────────────────────────────────────────────────────────────
create or replace function public.registrar_main_program_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    if new.program_id is not null then
        insert into public.registrar_program (registrar_id, program_id)
        values (new.id, new.program_id)
        on conflict do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists registrar_main_program_link on public.registrar_staff;
create trigger registrar_main_program_link
    after insert or update of program_id on public.registrar_staff
    for each row execute function public.registrar_main_program_link();

-- ── 3. The cap: 2 Registrars per programme, counted across everyone who covers it ──────────────────────────────
create or replace function public.registrar_program_cap()
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
    from public.registrar_program
    where program_id = new.program_id and registrar_id <> new.registrar_id;

    if v_count >= 2 then
        select code into v_code from public.program where id = new.program_id;
        raise exception '% already has the maximum of 2 registrar accounts.', coalesce(v_code, 'This programme')
            using errcode = '23505';
    end if;
    return new;
end;
$$;

drop trigger if exists registrar_program_cap on public.registrar_program;
create trigger registrar_program_cap
    before insert on public.registrar_program
    for each row execute function public.registrar_program_cap();

-- ── 4. Helpers (SECURITY DEFINER, so they read the tables without applying their rules) ────────────────────────
create or replace function public.is_my_registrar_row(p_registrar_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (select 1 from public.registrar_staff r where r.id = p_registrar_id and r.user_id = auth.uid());
$$;

create or replace function public.my_registrar_programs()
returns integer[]
language sql
stable
security definer
set search_path to 'public'
as $$
    select coalesce(array_agg(rp.program_id), '{}'::integer[])
    from public.registrar_program rp
    join public.registrar_staff r on r.id = rp.registrar_id
    where r.user_id = auth.uid() and r.is_approved;
$$;

revoke all on function public.is_my_registrar_row(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_my_registrar_row(uuid) to authenticated;
grant execute on function public.is_my_registrar_row(uuid) to service_role;
revoke all on function public.my_registrar_programs() from public, anon, authenticated, service_role;
grant execute on function public.my_registrar_programs() to authenticated;
grant execute on function public.my_registrar_programs() to service_role;

-- ── 5. Who can read the list ───────────────────────────────────────────────────────────────────────────────────
alter table public.registrar_program enable row level security;

drop policy if exists "registrar reads own programmes"   on public.registrar_program;
drop policy if exists "admin reads registrar programmes" on public.registrar_program;

create policy "registrar reads own programmes" on public.registrar_program
    for select to authenticated
    using (public.is_my_registrar_row(registrar_id));

create policy "admin reads registrar programmes" on public.registrar_program
    for select to authenticated
    using (public.is_system_admin());

-- No insert, update or delete policy: only set_registrar_programs() (below) changes the list.

-- ── 6. The rules that said "the registrar's programme" now say "any of the registrar's programmes" ──────────────
create or replace function public.is_registrar_of_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (
        select 1
        from registrar_staff r
        join university_student s on s.id = p_student_id
        where r.user_id = auth.uid() and r.is_approved
          and (
              s.program_id is null
              or exists (select 1 from registrar_program rp where rp.registrar_id = r.id and rp.program_id = s.program_id)
          )
    );
$$;

create or replace function public.department_ids_for_my_registrar()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
    select id from department_staff where program_id = any (public.my_registrar_programs());
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
        or p_program_id = any (public.my_registrar_programs())
        or exists (select 1 from department_staff where user_id = auth.uid() and is_approved and program_id = p_program_id)
    );
$$;

-- A Registrar sees every faculty member who covers any of their programmes.
create or replace function public.registrar_covers_faculty(p_faculty_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (
        select 1 from public.faculty_program fp
        where fp.faculty_id = p_faculty_id
          and fp.program_id = any (public.my_registrar_programs())
    );
$$;

drop policy if exists "registrar reads faculty programmes" on public.faculty_program;
create policy "registrar reads faculty programmes" on public.faculty_program
    for select to authenticated
    using (program_id = any (public.my_registrar_programs()));

-- ── 7. Admin sets the list ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.set_registrar_programs(p_registrar_id uuid, p_program_ids integer[])
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
        raise exception 'Only an administrator can change a registrar''s programmes.' using errcode = '42501';
    end if;

    select array_agg(distinct x order by x) into v_ids from unnest(coalesce(p_program_ids, '{}'::integer[])) as x where x is not null;

    if v_ids is null or array_length(v_ids, 1) is null then
        raise exception 'A registrar must cover at least one programme.' using errcode = '22023';
    end if;
    if array_length(v_ids, 1) > 30 then
        raise exception 'Too many programmes chosen.' using errcode = '22023';
    end if;

    select program_id into v_main from public.registrar_staff where id = p_registrar_id for update;
    if not found then
        raise exception 'That registrar account was not found.' using errcode = '02000';
    end if;

    select count(*) into v_missing from unnest(v_ids) as x where not exists (select 1 from public.program where id = x);
    if v_missing > 0 then
        raise exception 'One of the chosen programmes does not exist.' using errcode = '23503';
    end if;

    if v_main is null or not (v_main = any (v_ids)) then
        v_main := v_ids[1];
    end if;

    delete from public.registrar_program
    where registrar_id = p_registrar_id and not (program_id = any (v_ids));

    -- New rows go through the cap trigger.
    insert into public.registrar_program (registrar_id, program_id)
    select p_registrar_id, x from unnest(v_ids) as x
    on conflict do nothing;

    update public.registrar_staff set program_id = v_main where id = p_registrar_id and program_id is distinct from v_main;
end;
$$;

revoke all on function public.set_registrar_programs(uuid, integer[]) from public, anon, authenticated, service_role;
grant execute on function public.set_registrar_programs(uuid, integer[]) to authenticated;
grant execute on function public.set_registrar_programs(uuid, integer[]) to service_role;
