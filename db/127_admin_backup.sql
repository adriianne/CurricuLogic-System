-- 127_admin_backup.sql
--
-- The System administrator's manual backup: read the system's data, table by table, to save as one file (Admin > Backup).
--
-- Why a function: row-level security hides most tables from the Admin (students, grades, subjects, requests ...), so a
-- page reading them directly would produce a file with most of the data missing. These two functions are the only door,
-- and they are closed to everyone but a signed-in System administrator.
--
--   admin_backup_tables()                    the tables a backup holds, with their row counts. Also writes ONE audit row,
--                                            BACKUP_DATA_READ, so every backup starts on the record.
--   admin_backup_page(table, from, size)     up to `size` (max 1000) rows of one table as a JSON array, in primary-key order,
--                                            starting at row `from`. Only tables on the list below.
--
-- What is NOT in a backup, on purpose:
--   - Supabase's own login data (auth.users: emails, password hashes). The account tables point at those users by id.
--   - Cura's chat messages and reset marks (ai_chat_*), login-attempt counters, AI usage counters, and staging tables.
--     Private or temporary, and not needed to run the system after a restore.
-- The tables hold no secrets (only must_change_password flags); a backup file still contains student data and must be treated so.
--
-- Rollback:  drop function public.admin_backup_page(text, integer, integer);
--            drop function public.admin_backup_tables();
--            drop function public._backup_table_list();

create or replace function public._backup_table_list()
returns text[]
language sql
immutable
as $$
    -- in restore order: a table comes after every table it points at (see docs/BACKUP-RESTORE.md)
    select array[
        'program', 'department_staff', 'faculty_staff', 'registrar_staff', 'system_administrator',
        'prospectus', 'subject', 'prerequisite', 'elective_group', 'elective_group_member',
        'university_student', 'subject_offering', 'academic_record', 'grade_file', 'grade_file_row',
        'request', 'request_item', 'request_review', 'form_print', 'notification',
        'student_preference', 'advisee_assignment', 'department_program', 'faculty_program', 'registrar_program',
        'expected_student', 'bulk_upload_history', 'system_config', 'student_id_counter',
        'audit_log', 'account_stop_log', 'maintenance_log'
    ]::text[];
$$;

revoke all on function public._backup_table_list() from public, anon, authenticated, service_role;

create or replace function public.admin_backup_tables()
returns table (table_name text, row_count bigint)
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
    t text;
    n bigint;
begin
    if auth.uid() is null or not is_system_admin() then
        raise exception 'Only a System administrator can back up the database.' using errcode = '42501';
    end if;

    insert into audit_log (actor_id, actor_role, action, table_name, record_id, new_values)
    values (auth.uid(), 'system_administrator', 'BACKUP_DATA_READ', 'database', null,
            jsonb_build_object('tables', array_length(_backup_table_list(), 1)));

    foreach t in array _backup_table_list() loop
        execute format('select count(*) from public.%I', t) into n;
        table_name := t;
        row_count := n;
        return next;
    end loop;
end;
$function$;

create or replace function public.admin_backup_page(p_table text, p_from integer default 0, p_size integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
    v_order text;
    v_size  integer := least(greatest(coalesce(p_size, 500), 1), 1000);
    v_from  integer := greatest(coalesce(p_from, 0), 0);
    v_out   jsonb;
begin
    if auth.uid() is null or not is_system_admin() then
        raise exception 'Only a System administrator can back up the database.' using errcode = '42501';
    end if;
    if p_table is null or not (p_table = any (_backup_table_list())) then
        raise exception 'That table is not part of a backup.' using errcode = '22023';
    end if;

    -- a stable order, so pages do not overlap or skip: the primary key, else the physical row
    select string_agg(format('%I', a.attname), ', ' order by array_position(i.indkey::int2[], a.attnum))
      into v_order
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = format('public.%I', p_table)::regclass
       and i.indisprimary;

    execute format(
        'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I order by %s offset %s limit %s) t',
        p_table, coalesce(v_order, 'ctid'), v_from, v_size)
      into v_out;
    return v_out;
end;
$function$;

revoke all on function public.admin_backup_tables() from public, anon, authenticated, service_role;
grant execute on function public.admin_backup_tables() to authenticated;
revoke all on function public.admin_backup_page(text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_backup_page(text, integer, integer) to authenticated;
