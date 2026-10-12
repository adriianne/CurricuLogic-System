-- 067_small_db_fixes.sql
--
-- Two small findings from the 9 Oct 2026 database scan (Supabase advisors):
--
--   * audit_log_append_only() had no fixed search_path. It only raises an
--     error (it reads no table), so pinning the path changes nothing it does;
--     it just closes the "mutable search_path" warning.
--   * academic_record had two identical indexes on (student_id):
--     academic_record_student_idx and idx_academic_record_student. Neither
--     backs a constraint, so one copy is dropped (the idx_ one is kept).
--
-- Safe to re-run.

alter function public.audit_log_append_only() set search_path = public, pg_temp;

drop index if exists public.academic_record_student_idx;
