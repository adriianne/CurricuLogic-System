-- 108_faculty_one_college.sql
--
-- A faculty member can cover several programmes (db/107), but only RELATED ones: an IT adviser may also cover IS, AI
-- or Animation, never Nursing or Accounting. "Related" here means the same college (program.college), which every
-- programme already has, so there is nothing to set up.
--
-- The rule is a trigger on faculty_program, so it holds however a row gets in (set_faculty_programs, or anything
-- else). To move an adviser to another college, Admin replaces the whole list: set_faculty_programs removes the
-- old rows first, so the new college's rows pass.
--
-- Programmes with no college are treated as one group of their own.
--
-- TO UNDO:  drop trigger faculty_program_college on public.faculty_program;
--           drop function public.faculty_program_college();
--
-- Safe to re-run.

create or replace function public.faculty_program_college()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_college text;
    v_clash   boolean;
begin
    select lower(btrim(coalesce(college, ''))) into v_college from public.program where id = new.program_id;

    select exists (
        select 1
        from public.faculty_program fp
        join public.program p on p.id = fp.program_id
        where fp.faculty_id = new.faculty_id
          and fp.program_id <> new.program_id
          and lower(btrim(coalesce(p.college, ''))) <> coalesce(v_college, '')
    ) into v_clash;

    if v_clash then
        raise exception 'A faculty member can only cover programmes from one college.'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists faculty_program_college on public.faculty_program;
create trigger faculty_program_college
    before insert on public.faculty_program
    for each row execute function public.faculty_program_college();
