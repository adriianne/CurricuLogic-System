-- 070_department_reads_student_photos.sql
--
-- Department staff can see the profile photo of the students in their own
-- programme. Same idea as db/068 (Registrar) and db/069 (Faculty), and just as
-- narrow:
--
--   * only SELECT (read); nobody gains the right to add, replace or delete
--     somebody else's photo;
--   * only a student the Department account can already see, using the same
--     check the students table uses (is_department_of_student: an approved
--     Department account of that student's programme);
--   * the file must belong to a student: the folder name has to be the user id of
--     a university_student row, so staff photos are not opened up.
--
-- The page still asks for a short-lived signed link; there is still no public URL.
-- Safe to re-run.

drop policy if exists profile_photos_select_department on storage.objects;

create policy profile_photos_select_department on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and exists (
      select 1
      from public.university_student s
      where s.user_id::text = (storage.foldername(name))[1]
        and public.is_department_of_student(s.id)
    )
  );
