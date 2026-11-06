-- 097_faculty_notify_by_program.sql
--
-- Found in the live end-to-end run on 6 Nov 2026: after a Faculty adviser decided a plan, the student got NO
-- notification. The insert policy "faculty notify advisees" (db/023) still required an active row in
-- advisee_assignment linking that faculty member to that student. Since db/024 a faculty member covers every
-- student of their programme (is_adviser_of_student, via faculty_program) and advisers are no longer assigned
-- one by one. 22 of the 27 approved students have no assignment row, so for them the notification was refused
-- silently (the page sends it "fire and forget" so that a failed notice never undoes a review).
--
-- Now: a faculty member may notify the student of a request when they cover that student's programme, the same
-- rule that lets them review the request. The notice still has to be about a real request of that student.
--
-- TO UNDO: restore the old policy from db/023 (it checks advisee_assignment).
--
-- Safe to re-run.

drop policy if exists "faculty notify advisees" on public.notification;
create policy "faculty notify advisees" on public.notification
    for insert to authenticated
    with check (
        exists (
            select 1
            from public.request r
            join public.university_student us on us.id = r.student_id
            where r.id = notification.related_request_id
              and us.user_id = notification.user_id
              and public.is_adviser_of_student(r.student_id)
        )
    );
