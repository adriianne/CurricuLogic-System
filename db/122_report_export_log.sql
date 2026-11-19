-- 122_report_export_log.sql
--
-- Every report a person prints or saves as Excel/CSV is recorded in the audit log: who, which report, which format, when.
-- The files hold student data, so a lost or shared file can be traced to the account that made it.
--
--   select log_report_export('program_report', 'csv');                        -- a programme report as CSV
--   select log_report_export('student_report', 'xlsx', '<student row id>');   -- one student's report, as Excel
--
-- What is stored: the account and its role, the report, the format, and (for a student report) the student's row id.
-- Never the report's content and never a name.
--
-- Who may log what (the same people who can see the report; anything else is refused):
--   student_report   faculty adviser, Registrar
--   program_report   Department staff, Registrar
--   analytics        Department staff
--   system_logs      System administrator
--   backup           System administrator
--
-- Rollback:  drop function public.log_report_export(text, text, text, integer);
--            (the log rows already written stay: they are history)

create or replace function public.log_report_export(
    p_report text,
    p_format text,
    p_target text    default null,
    p_rows   integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_uid  uuid := auth.uid();
    v_role text;
begin
    if v_uid is null then
        raise exception 'Not signed in.' using errcode = '42501';
    end if;
    if p_format not in ('print', 'xlsx', 'csv', 'file') then
        raise exception 'Unknown report format.' using errcode = '22023';
    end if;

    -- the capacity the person is acting in
    if is_system_admin() then
        v_role := 'system_administrator';
    elsif current_department_staff_id() is not null then
        v_role := 'department_staff';
    elsif current_registrar_id() is not null then
        v_role := 'registrar_staff';
    elsif current_faculty_id() is not null then
        v_role := 'faculty_staff';
    else
        raise exception 'Only staff can export reports.' using errcode = '42501';
    end if;

    if not (
        (p_report = 'student_report' and v_role in ('faculty_staff', 'registrar_staff')) or
        (p_report = 'program_report' and v_role in ('department_staff', 'registrar_staff')) or
        (p_report = 'analytics'      and v_role = 'department_staff') or
        (p_report in ('system_logs', 'backup') and v_role = 'system_administrator')
    ) then
        raise exception 'You cannot export this report.' using errcode = '42501';
    end if;

    insert into audit_log (actor_id, actor_role, action, table_name, record_id, new_values)
    values (v_uid, v_role, 'EXPORT_REPORT', 'report', left(p_target, 64),
            jsonb_strip_nulls(jsonb_build_object('report', p_report, 'format', p_format, 'rows', p_rows)));
end;
$function$;

revoke all on function public.log_report_export(text, text, text, integer) from public, anon;
grant execute on function public.log_report_export(text, text, text, integer) to authenticated;
