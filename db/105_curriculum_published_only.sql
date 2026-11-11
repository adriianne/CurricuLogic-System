-- 105_curriculum_published_only.sql
--
-- A curriculum that is still a draft can no longer be given to a student.
--
--   * curriculum_for(program, year): a year now matches only a PUBLISHED curriculum (published_at is set). With no
--     year it still returns the programme's active one. Before this, an unpublished draft (no subjects yet) could be
--     picked by year.
--   * Everything that pins a student to a year goes through curriculum_for: set_student_curriculum (Admin forms,
--     the Registrar's Change curriculum control) and the registration trigger of db/102. A listed year that is a
--     draft falls back to the active curriculum there, with the note db/102 already writes.
--
-- TO UNDO: re-run db/102 (it recreates curriculum_for without the published test).
-- Safe to re-run.

create or replace function public.curriculum_for(p_program integer, p_year integer default null)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select pr.id
  from public.prospectus pr
  where pr.program_id = p_program
    and (
         (p_year is not null and pr.academic_year = p_year and pr.published_at is not null)
      or (p_year is null and pr.is_active)
    )
  order by pr.is_active desc, pr.academic_term, pr.id
  limit 1;
$$;
