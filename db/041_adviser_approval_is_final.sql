-- 041_adviser_approval_is_final.sql
--
-- The adviser's approval of an enrollment plan is now final; the Registrar no
-- longer approves plans (see shared/js/requeststatus.js). A plan is "approved
-- for enrollment" when request.status is approved or partially_approved, and it
-- was not one of the old plans the Registrar sent back (registrar_status =
-- 'rejected', which stay closed).
--
-- db/040 let a department read only plans with registrar_status = 'approved'.
-- Nothing sets that any more, so this replaces those two policies with the new
-- meaning. A department still reads only its own programme's students' plans,
-- and still cannot change any.
--
-- TO APPLY: run this file in the Supabase SQL editor.
-- TO UNDO: run db/040 again after dropping the two policies below.

drop policy if exists "department reads approved enrollment requests" on public.request;
drop policy if exists "department reads approved enrollment items"    on public.request_item;

create policy "department reads approved enrollment requests"
    on public.request
    for select
    to authenticated
    using (
        status in ('approved', 'partially_approved')
        and registrar_status is distinct from 'rejected'
        and public.is_department_of_student(student_id)
    );

create policy "department reads approved enrollment items"
    on public.request_item
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.request r
            where r.id = request_item.request_id
              and r.status in ('approved', 'partially_approved')
              and r.registrar_status is distinct from 'rejected'
              and public.is_department_of_student(r.student_id)
        )
    );
        