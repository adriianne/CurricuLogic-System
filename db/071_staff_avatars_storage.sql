-- 071_staff_avatars_storage.sql
--
-- STATUS: ALREADY LIVE. This file only RECORDS the staff photo storage so the
-- repository can rebuild it; it was written on 2026-10-14 from the live project.
-- Running it on the live database changes nothing (it drops and recreates the
-- same four policies and sets the bucket to the values it already has).
--
-- The staff photo bucket and its four policies were first created by hand in
-- the Supabase dashboard, before migrations covered storage, so no earlier file
-- describes them. (The students' photos are different: see 064, 068, 069, 070.)
--
--   * Bucket "staff-avatars": PUBLIC, 2 MB at most, JPEG, PNG or WebP.
--     Public means anyone who has a photo's address can open it without signing
--     in; the row-level rules below govern uploading, replacing and deleting, and
--     listing through the API. This is NOT how the student photos work (those
--     are private and use short-lived signed links).
--   * Each person's files live in a folder named after their auth user id.
--   * A signed-in person can add, replace and delete ONLY files inside their own
--     folder (the first path segment must equal their auth user id).
--   * Any signed-in person can read any file in the bucket.
--
-- Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-avatars', 'staff-avatars', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "staff avatars read"   on storage.objects;
drop policy if exists "staff avatars insert" on storage.objects;
drop policy if exists "staff avatars update" on storage.objects;
drop policy if exists "staff avatars delete" on storage.objects;

create policy "staff avatars read" on storage.objects
  for select to authenticated
  using (bucket_id = 'staff-avatars');

create policy "staff avatars insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'staff-avatars'
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "staff avatars update" on storage.objects
  for update to authenticated
  using (bucket_id = 'staff-avatars'
         and (storage.foldername(name))[1] = auth.uid()::text);

create policy "staff avatars delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'staff-avatars'
         and (storage.foldername(name))[1] = auth.uid()::text);
