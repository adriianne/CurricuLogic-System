-- 068_registrar_reads_student_photos.sql
--
-- A Registrar can see the profile photo of the students they are allowed to see.
--
-- db/064 made the "profile-photos" bucket private and readable only by its owner:
-- the first folder of every file is the owner's auth user id. This adds ONE more
-- read rule, for Registrar staff, and nothing else:
--
--   * only SELECT (read); no one gains the right to add, replace or delete
--     somebody else's photo;
--   * only the photo of a student the Registrar can already see, using the same
--     check the students table uses (is_registrar_of_student: an approved
--     Registrar of that student's programme, or a student with no programme yet);
--   * the file must belong to a student: the folder name has to be the user id of
--     a university_student row, so a staff member's own photo is not opened up.
--
-- The page still asks for a short-lived signed link; there is still no public URL.
-- Safe to re-run.

drop policy if exists profile_photos_select_registrar on storage.objects;

create policy profile_photos_select_registrar on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and exists (
      select 1
      from public.university_student s
      where s.user_id::text = (storage.foldername(name))[1]
        and public.is_registrar_of_student(s.id)
    )
  );
