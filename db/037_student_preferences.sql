-- 037_student_preferences.sql
--
-- STATUS: DRAFT. Not applied. Read it, then apply it.
--
-- WHY
--   Recommendations can now take a student's preferences into account: the
--   time of day they would rather have classes, and how heavy a load they
--   want. The engine still decides what a student MAY take; preferences only
--   choose between sections and trim the list to a lighter load
--   (shared/engine/preferences.js). They need somewhere to live that follows
--   the student between devices, which the Android app will need too.
--
-- WHAT THIS CHANGES
--   A new table, student_preference: at most one row per student, holding
--   time_of_day and load. Both are optional (null = no preference).
--   A student can read, create and change ONLY their own row. Nobody else
--   can read it: not faculty, not the Registrar, not other students. No
--   existing table or policy is touched.
--
--   Until this is applied the student dashboard still works: it keeps the
--   preferences in that browser only (localStorage) and says so.
--
-- HOW TO UNDO: run the ROLLBACK block at the bottom.

create table if not exists public.student_preference (
    student_id  uuid primary key
                references public.university_student(id) on delete cascade,
    time_of_day text check (time_of_day in ('morning', 'afternoon', 'evening')),
    load        text check (load in ('light', 'regular', 'full')),
    updated_at  timestamptz not null default now()
);

alter table public.student_preference enable row level security;

-- One test for "this row is mine", used by all three policies.
drop policy if exists "student reads own preference"   on public.student_preference;
drop policy if exists "student creates own preference" on public.student_preference;
drop policy if exists "student changes own preference" on public.student_preference;

create policy "student reads own preference"
    on public.student_preference for select
    using (exists (
        select 1 from public.university_student u
        where u.id = student_preference.student_id and u.user_id = auth.uid()
    ));

create policy "student creates own preference"
    on public.student_preference for insert
    with check (exists (
        select 1 from public.university_student u
        where u.id = student_preference.student_id and u.user_id = auth.uid()
    ));

create policy "student changes own preference"
    on public.student_preference for update
    using (exists (
        select 1 from public.university_student u
        where u.id = student_preference.student_id and u.user_id = auth.uid()
    ))
    with check (exists (
        select 1 from public.university_student u
        where u.id = student_preference.student_id and u.user_id = auth.uid()
    ));

grant select, insert, update on public.student_preference to authenticated;


-- ROLLBACK ------------------------------------------------------------------
-- drop table if exists public.student_preference;
