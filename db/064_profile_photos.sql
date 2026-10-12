-- 064_profile_photos.sql
--
-- A profile photo for every kind of account (student, faculty, registrar,
-- department, administrator).
--
--   * One private bucket, "profile-photos". Private on purpose: a student's
--     face is personal data, so there is no public URL; the page asks for a
--     short-lived signed link instead.
--   * One file per person at  <auth user id>/avatar.jpg . The page shrinks the
--     picture to a 256 px JPEG before uploading, so the bucket itself only
--     accepts JPEG and at most 256 KB. A larger or different file is refused
--     by the server even if someone skips the page.
--   * A person can read, add, replace and delete ONLY the files in their own
--     folder (the first path segment must equal their auth user id). Nobody
--     else can list or read them yet; showing a student's photo to their
--     adviser or the Registrar is a later, separate decision.
--
-- No table column is needed: "has a photo" is simply "the file exists".
-- Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 262144, array['image/jpeg'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = 262144,
      allowed_mime_types = array['image/jpeg'];

drop policy if exists profile_photos_select_own on storage.objects;
drop policy if exists profile_photos_insert_own on storage.objects;
drop policy if exists profile_photos_update_own on storage.objects;
drop policy if exists profile_photos_delete_own on storage.objects;

create policy profile_photos_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'profile-photos'
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy profile_photos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'profile-photos'
              and (storage.foldername(name))[1] = auth.uid()::text
              and name = auth.uid()::text || '/avatar.jpg');

create policy profile_photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'profile-photos'
         and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-photos'
              and (storage.foldername(name))[1] = auth.uid()::text
              and name = auth.uid()::text || '/avatar.jpg');

create policy profile_photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-photos'
         and (storage.foldername(name))[1] = auth.uid()::text);
