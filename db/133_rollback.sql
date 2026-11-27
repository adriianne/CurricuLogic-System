-- 133_rollback.sql: removes the two off-semester functions (sections already posted stay: they are ordinary schedule rows)
drop function if exists public.add_offsem_section(integer, integer, text, jsonb);
drop function if exists public.remove_offsem_section(integer, text, integer);
