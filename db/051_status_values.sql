  -- 051: only known values in the status-type columns (security item 5, defence in depth).
  -- DRAFT: review, then run once in the Supabase SQL editor.
  --
  -- Why: the stored-XSS audit (2026-10-04) found that academic_record.status was
  -- printed into the registrar's, the faculty's and the student's pages as it
  -- came from the database, and nothing limited what that column could hold.
  -- Someone allowed to write grade records could store HTML there and it would
  -- run in the browser of whoever opened that student. The pages now escape the
  -- value (that is the real fix); this makes the database refuse anything else,
  -- so a page that forgets to escape cannot be turned against its users.
  --
  -- The lists are what the code writes today, and every existing row fits
  -- (checked 2026-10-04). NULL stays allowed where the column allows it.
  -- Safe to re-run: each constraint is dropped and re-added.

  begin;

  do $$
  declare
    r record;
  begin
    for r in
      select * from (values
        ('academic_record',   'status',        array['PASSED','FAILED','ENROLLED','DROPPED']),
        ('grade_file_row',    'status',        array['PASSED','FAILED','ENROLLED','DROPPED']),
        ('grade_file',        'status',        array['pending','processing','completed','failed']),
        ('request',           'status',        array['submitted','approved','partially_approved','rejected']),
        ('request_item',      'status',        array['pending','valid','flagged','approved','rejected']),
        ('request_review',    'status',        array['approved','partially_approved','rejected']),
        ('university_student','declared_path', array['new','existing']),
        ('subject_offering',  'meeting_type',  array['LEC','LAB'])
      ) as v(tbl, col, allowed)
    loop
      execute format('alter table public.%I drop constraint if exists %I',
                    r.tbl, r.tbl || '_' || r.col || '_values');
      execute format('alter table public.%I add constraint %I check (%I is null or %I::text = any (%L::text[]))',
                    r.tbl, r.tbl || '_' || r.col || '_values', r.col, r.col, r.allowed);
    end loop;
  end $$;

  commit;

  -- To see them:
  --   select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid)
  --   from pg_constraint where conname like '%\_values' order by 1, 2;
