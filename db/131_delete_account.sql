-- 131_delete_account.sql
--
-- WHY
--   The Admin could stop an account but never remove one, so test and mistaken accounts stayed in the lists for good.
--
-- WHAT THIS ADDS: public.delete_account(role, id, confirm), for the System administrator only.
--   Rules (chosen 25 Nov 2026):
--     * Only a STOPPED account can be deleted, so it is always a second, deliberate step (Stop, then Delete), and the
--       seat it held is already free. An active, pending or declined account is refused.
--     * Students, faculty, registrar and Department accounts. Administrator accounts cannot be deleted here.
--     * Nobody can delete their own account.
--     * The caller must type the account's ID (student ID, or employee ID) exactly: the same check the page makes.
--     * An account with HISTORY is refused, with the reason in plain words ("Keep it stopped instead"), so nothing is
--       ever orphaned or lost:
--         student     academic records, requests, grade-upload rows
--         faculty     approval decisions (request_review)
--         registrar   requests it handled
--         department  curricula, subjects, prerequisites, elective groups, schedule offerings, grade uploads it made
--         any staff   accounts it created
--       What is NOT history, and goes with the account: notifications, chat, preferences, advisee links, programme links.
--   What it does: one audit_log row (DELETE_ACCOUNT, with who/what was deleted), then it removes the sign-in
--   (auth.users), which removes the account's own row and its links. account_stop_log keeps its lines.
--   Irreversible: there is no undo. db/backup (Admin > Backup) is the way back.
--
-- ROLLBACK: drop function public.delete_account(text, uuid, text);   (deleted accounts do not come back)

create or replace function public.delete_account(p_role text, p_target uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare
    v_caller   uuid := auth.uid();
    v_user     uuid;
    v_approved boolean;
    v_status   text;
    v_ident    text;
    v_name     text;
    v_email    text;
    v_last     text;
    v_table    text;
    v_n        integer;
    v_hist     text[] := '{}';
begin
    if not public.is_system_admin() then
        raise exception 'Only an administrator can delete an account.' using errcode = '42501';
    end if;

    if p_role = 'student' then
        v_table := 'university_student';
        select user_id, is_approved, approval_status, student_id, btrim(first_name || ' ' || last_name), email
          into v_user, v_approved, v_status, v_ident, v_name, v_email
          from public.university_student where id = p_target for update;
    elsif p_role = 'faculty' then
        v_table := 'faculty_staff';
        select user_id, is_approved, employee_id, btrim(first_name || ' ' || last_name), email
          into v_user, v_approved, v_ident, v_name, v_email
          from public.faculty_staff where id = p_target for update;
    elsif p_role = 'registrar' then
        v_table := 'registrar_staff';
        select user_id, is_approved, employee_id, btrim(first_name || ' ' || last_name), email
          into v_user, v_approved, v_ident, v_name, v_email
          from public.registrar_staff where id = p_target for update;
    elsif p_role = 'department' then
        v_table := 'department_staff';
        select user_id, is_approved, employee_id, btrim(first_name || ' ' || last_name), email
          into v_user, v_approved, v_ident, v_name, v_email
          from public.department_staff where id = p_target for update;
    elsif p_role = 'admin' then
        raise exception 'Administrator accounts cannot be deleted here.' using errcode = '42501';
    else
        raise exception 'Unknown role: %.', p_role using errcode = '22023';
    end if;

    if not found then
        raise exception 'Account not found.' using errcode = 'P0002';
    end if;

    if v_user is not null and v_user = v_caller then
        raise exception 'You cannot delete your own account.' using errcode = '42501';
    end if;

    -- Only a stopped account: the latest line of the stop log says "stop", or (a student whose request was approved
    -- and whose access was switched off by hand) the same rule the page uses.
    select action into v_last from public.account_stop_log
      where role = p_role and target_id = p_target order by seq desc limit 1;
    if v_approved is true
       or not (v_last = 'stop' or (p_role = 'student' and v_status = 'approved')) then
        raise exception 'Only a stopped account can be deleted. Stop it first.' using errcode = '22023';
    end if;

    -- The typed ID must match exactly (case does not matter).
    if upper(btrim(coalesce(p_confirm, ''))) is distinct from upper(btrim(coalesce(v_ident, v_email, ''))) then
        raise exception 'To delete this account, type its ID (%) exactly.', coalesce(v_ident, v_email) using errcode = '22023';
    end if;

    -- History: anything that would be lost or left pointing at nobody.
    if p_role = 'student' then
        select count(*) into v_n from public.academic_record where student_id = p_target;
        if v_n > 0 then v_hist := v_hist || (v_n || ' academic record' || case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from public.request where student_id = p_target;
        if v_n > 0 then v_hist := v_hist || (v_n || ' plan request' || case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from public.grade_file_row where student_id = p_target;
        if v_n > 0 then v_hist := v_hist || (v_n || ' grade-upload row' || case when v_n = 1 then '' else 's' end); end if;
    elsif p_role = 'faculty' then
        select count(*) into v_n from public.request_review where faculty_id = p_target;
        if v_n > 0 then v_hist := v_hist || (v_n || ' approval decision' || case when v_n = 1 then '' else 's' end); end if;
    elsif p_role = 'registrar' then
        select count(*) into v_n from public.request where registrar_id = p_target;
        if v_n > 0 then v_hist := v_hist || (v_n || ' request' || case when v_n = 1 then '' else 's' end || ' it handled'); end if;
    elsif p_role = 'department' then
        select count(*) into v_n from public.prospectus where created_by = p_target or published_by = p_target;
        if v_n > 0 then v_hist := v_hist || (v_n || ' curriculum version' || case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from public.subject where created_by = p_target or retired_by = p_target;
        if v_n > 0 then v_hist := v_hist || (v_n || ' subject' || case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from public.prerequisite where created_by = p_target;
        if v_n > 0 then v_hist := v_hist || (v_n || ' prerequisite' || case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from public.elective_group where created_by = p_target;
        if v_n > 0 then v_hist := v_hist || (v_n || ' elective group' || case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from public.subject_offering where created_by = p_target;
        if v_n > 0 then v_hist := v_hist || (v_n || ' schedule row' || case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from public.grade_file where uploaded_by = p_target;
        if v_n > 0 then v_hist := v_hist || (v_n || ' grade upload' || case when v_n = 1 then '' else 's' end); end if;
    end if;

    if v_user is not null then
        select (select count(*) from public.university_student where created_by = v_user)
             + (select count(*) from public.faculty_staff      where created_by = v_user)
             + (select count(*) from public.registrar_staff    where created_by = v_user)
             + (select count(*) from public.department_staff   where created_by = v_user)
             + (select count(*) from public.system_administrator where created_by = v_user)
          into v_n;
        if v_n > 0 then v_hist := v_hist || (v_n || ' account' || case when v_n = 1 then '' else 's' end || ' it created'); end if;
    end if;

    if array_length(v_hist, 1) > 0 then
        raise exception 'Cannot delete %: it has % on file. Keep it stopped instead.', coalesce(nullif(v_name, ''), 'this account'), array_to_string(v_hist, ', ')
            using errcode = '23503';
    end if;

    insert into public.audit_log (actor_id, actor_role, action, table_name, record_id, old_values)
    values (v_caller, 'system_administrator', 'DELETE_ACCOUNT', v_table, p_target::text,
            jsonb_build_object('role', p_role, 'identifier', v_ident, 'name', v_name, 'email', v_email));

    begin
        if v_user is not null then
            delete from auth.users where id = v_user;      -- removes the account row, its links and its notifications
        else
            execute format('delete from public.%I where id = $1', v_table) using p_target;
        end if;
    exception when foreign_key_violation then
        raise exception 'Cannot delete %: other records still refer to it. Keep it stopped instead.', coalesce(nullif(v_name, ''), 'this account')
            using errcode = '23503';
    end;

    return jsonb_build_object('ok', true, 'role', p_role, 'identifier', v_ident, 'name', v_name);
end;
$function$;

revoke all on function public.delete_account(text, uuid, text) from public, anon;
grant execute on function public.delete_account(text, uuid, text) to authenticated;
