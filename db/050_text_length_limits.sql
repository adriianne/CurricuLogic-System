-- 050: length limits on free-text columns (security item 2, step 4).
-- DRAFT: review, then run once in the Supabase SQL editor.
--
-- Until now ~40 text columns accepted any length (a text column holds up to
-- 1 GB) and no CHECK existed anywhere, so a client that skipped the form's
-- maxlength could store enormous values. Each column below gets
-- CHECK (char_length(col) <= N). NULL still passes.
--
-- The numbers are generous on purpose: well above anything the app writes
-- today (the longest real value in each column was measured on 2026-10-04),
-- so no legitimate write is refused. Where a person types the text (the
-- adviser's and Registrar's reasons) or a file supplies it (grade rows,
-- schedule rows) the pages now check the length first, so the person sees a
-- plain message instead of a failed save.
--
-- Safe to re-run: each constraint is dropped and re-added.

begin;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- written by people (typed reasons, notes, chat)
      ('ai_chat_message',        'text',                   4000),   -- user <= 500, Cura's reply ~2000
      ('request_item',           'remarks',                 500),   -- adviser's reason per subject
      ('request_review',         'remarks',                5000),   -- those reasons joined, one request
      ('request_approval',       'remarks',                 500),   -- table unused today
      ('request',                'registrar_notes',         500),
      ('university_student',     'review_note',             500),   -- Registrar's decline reason
      ('enrollment',             'notes',                  1000),
      ('notification',           'message',                1000),
      -- supplied by uploaded files
      ('grade_file_row',         'raw_student_name',        200),
      ('grade_file_row',         'raw_subject_code',         60),
      ('grade_file_row',         'raw_grade',                20),
      ('grade_file_row',         'error_message',           500),
      ('grade_file',             'error_log',             50000),
      ('bulk_upload_history',    'file_name',               255),
      ('subject_offering',       'edp_code',                 20),
      ('subject_offering',       'section',                  50),
      ('subject_offering',       'schedule_days',            20),
      ('subject_offering',       'room',                     50),
      ('subject_offering',       'instructor',              150),
      -- written by the system (engine, functions, jobs)
      ('ai_recommendation',      'recommendation_summary', 10000),
      ('recommendation_item',    'reason',                  2000),
      ('recommendation_item',    'prerequisite_evidence',   2000),
      ('system_log',             'message',                 2000),
      ('maintenance_log',        'task',                      50),
      -- short labels and identifiers
      ('university_student',     'created_via',               30),
      ('faculty_staff',          'created_via',               30),
      ('registrar_staff',        'created_via',               30),
      ('department_staff',       'created_via',               30),
      ('system_administrator',   'created_via',               30),
      ('registrar_staff',        'department',               100),  -- the other staff tables are varchar(100)
      ('system_administrator',   'username',                  50),
      ('department_staff',       'avatar_url',               500),
      ('student_preference',     'load',                      20),
      ('student_preference',     'time_of_day',               20),
      ('subject',                'category',                  50),
      ('subject',                'elective_type',             50)
    ) as v(tbl, col, max_len)
  loop
    execute format('alter table public.%I drop constraint if exists %I',
                   r.tbl, r.tbl || '_' || r.col || '_maxlen');
    execute format('alter table public.%I add constraint %I check (char_length(%I) <= %s)',
                   r.tbl, r.tbl || '_' || r.col || '_maxlen', r.col, r.max_len);
  end loop;
end $$;

commit;

-- To see them:
--   select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid)
--   from pg_constraint where conname like '%\_maxlen' order by 1, 2;
