-- 118_retire_curriculum.sql
--
-- APPLIED 17 Nov 2026 to the CurricuLogic AI project, after a dry run that rolled back (retire/restore and every refusal, curriculum_for hiding a retired year
-- and showing it again after restore, a retired version refused by activate, a published version refused by delete, a non-Department user refused).
-- Checked afterwards: column, both functions and the trigger exist, anon cannot run any of them, no version changed.
--
-- A used curriculum is RETIRED, not deleted (owner's request, 17 Nov 2026): a retired version stays with all its subjects, so a
-- returnee can be placed on it again by Restoring it.
--
-- 1. prospectus.retired_at (null = not retired).
-- 2. retire_prospectus(id): Department staff of the programme; the version must be published, not the active one, not already retired.
--    restore_prospectus(id): clears retired_at. A restored version never becomes the default (db/117 keeps the default moving forward).
-- 3. curriculum_for(program, year) no longer returns a retired version for a year, so an account cannot be given a retired
--    curriculum (the Admin creation and the EDP registration both use it). Students ALREADY on a retired version keep it: they carry their own
--    prospectus_id and are assessed against it.
-- 4. activate_prospectus refuses a retired version ("restore it first").
-- 5. A published curriculum cannot be deleted by a signed-in user (trigger). A draft can. Work run directly on the database (no signed-in user,
--    for example the planned pre-launch data reset) is not blocked.
--
-- TO UNDO: drop the trigger prospectus_no_delete_published, drop both functions, restore curriculum_for from db/105 and activate_prospectus
-- from db/117, then drop the column retired_at.

alter table public.prospectus add column if not exists retired_at timestamptz;

create or replace function public.retire_prospectus(target_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_program integer; v_active boolean; v_published timestamptz; v_retired timestamptz;
begin
    if not exists (select 1 from department_staff where user_id = auth.uid() and is_approved) then
        raise exception 'Only Department Staff can retire a curriculum version.' using errcode = '42501';
    end if;

    select program_id, is_active, published_at, retired_at into v_program, v_active, v_published, v_retired
    from prospectus where id = target_id;

    if v_program is null then raise exception 'No such prospectus version.' using errcode = '22023'; end if;
    if not public.department_covers_program(v_program) then
        raise exception 'You can only retire a curriculum version of your own programme.' using errcode = '42501';
    end if;
    if v_active then
        raise exception 'The active curriculum cannot be retired. Make a newer version active first.' using errcode = '22023';
    end if;
    if v_published is null then
        raise exception 'A draft was never in use. Delete it instead of retiring it.' using errcode = '22023';
    end if;
    if v_retired is not null then
        raise exception 'That version is already retired.' using errcode = '22023';
    end if;

    update prospectus set retired_at = now(), updated_at = now() where id = target_id;
end;
$function$;

create or replace function public.restore_prospectus(target_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_program integer; v_retired timestamptz;
begin
    if not exists (select 1 from department_staff where user_id = auth.uid() and is_approved) then
        raise exception 'Only Department Staff can restore a curriculum version.' using errcode = '42501';
    end if;

    select program_id, retired_at into v_program, v_retired from prospectus where id = target_id;

    if v_program is null then raise exception 'No such prospectus version.' using errcode = '22023'; end if;
    if not public.department_covers_program(v_program) then
        raise exception 'You can only restore a curriculum version of your own programme.' using errcode = '42501';
    end if;
    if v_retired is null then
        raise exception 'That version is not retired.' using errcode = '22023';
    end if;

    update prospectus set retired_at = null, updated_at = now() where id = target_id;
end;
$function$;

revoke execute on function public.retire_prospectus(integer), public.restore_prospectus(integer) from public, anon;
grant  execute on function public.retire_prospectus(integer), public.restore_prospectus(integer) to authenticated;


create or replace function public.curriculum_for(p_program integer, p_year integer default null)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select pr.id
  from public.prospectus pr
  where pr.program_id = p_program
    and (
         (p_year is not null and pr.academic_year = p_year and pr.published_at is not null and pr.retired_at is null)
      or (p_year is null and pr.is_active)
    )
  order by pr.is_active desc, pr.academic_term, pr.id
  limit 1;
$$;


create or replace function public.activate_prospectus(target_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_program integer; v_year integer; v_current integer; v_active integer; v_retired timestamptz;
begin
    if not exists (select 1 from department_staff where user_id = auth.uid() and is_approved) then
        raise exception 'Only Department Staff can activate a curriculum version.' using errcode = '42501';
    end if;

    select program_id, academic_year, retired_at into v_program, v_year, v_retired from prospectus where id = target_id;

    if v_program is null then raise exception 'No such prospectus version.' using errcode = '22023'; end if;
    if not public.department_covers_program(v_program) then
        raise exception 'You can only activate a curriculum version of your own programme.' using errcode = '42501';
    end if;
    if v_retired is not null then
        raise exception 'That version is retired. Restore it first.' using errcode = '22023';
    end if;
    if not exists (select 1 from subject where prospectus_id = target_id) then
        raise exception 'That version has no subjects. A student placed on it '
                        'would have no curriculum to be assessed against.'
            using errcode = '22023';
    end if;

    select current_academic_year into v_current from system_config where id = 1;
    if v_current is not null and v_year > v_current then
        raise exception 'That version takes effect in % (the system is on %). A student placed on it '
                        'would have a curriculum that has not started. Activate it when its year begins.',
                        v_year, v_current
            using errcode = '22023';
    end if;

    select max(academic_year) into v_active
    from prospectus where program_id = v_program and is_active and id <> target_id;
    if v_active is not null and v_year < v_active then
        raise exception 'The % curriculum is older than the active % curriculum. The default can only move forward, '
                        'so new students are never placed on an older curriculum by mistake. '
                        'To let students be placed on the older one, use Publish instead.',
                        v_year, v_active
            using errcode = '22023';
    end if;

    update prospectus set is_active = false, updated_at = now()
    where program_id = v_program and is_active and id <> target_id;

    update prospectus
    set is_active = true, published_at = coalesce(published_at, now()), updated_at = now()
    where id = target_id;
end;
$function$;

revoke execute on function public.activate_prospectus(integer) from public, anon;
grant  execute on function public.activate_prospectus(integer) to authenticated;


create or replace function public.prospectus_block_published_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
    if auth.uid() is not null and old.published_at is not null then
        raise exception 'A published curriculum cannot be deleted. Retire it instead, so it can be restored for a returning student.'
            using errcode = '22023';
    end if;
    return old;
end;
$function$;

drop trigger if exists prospectus_no_delete_published on public.prospectus;
create trigger prospectus_no_delete_published
    before delete on public.prospectus
    for each row execute function public.prospectus_block_published_delete();
