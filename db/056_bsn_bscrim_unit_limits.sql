    -- 056_bsn_bscrim_unit_limits.sql
    --
    -- BSN and BSCRIM were still on the BSIT defaults (24 per term, 27 when
    -- graduating, 176 expected total), which are smaller than their own curricula:
    --   BSN     heaviest real term 31 units, whole curriculum 200
    --   BSCRIM  heaviest real term 33 units, whole curriculum 215
    -- With the BSIT numbers Cura trimmed their plans to 24 units and pushed eligible
    -- subjects to later terms, and the curriculum builder warned on every edit.
    --
    -- These values come from the curricula themselves, not from school policy. If
    -- the college states official limits, change them here or in the admin
    -- Programmes screen (program.max_units / max_units_graduating / target_units).
    --
    -- BSIT is unchanged (24 / 27 / 176). Safe to re-run.

    update public.program set max_units = 31, max_units_graduating = 34, target_units = 200
    where code = 'BSN';

    update public.program set max_units = 33, max_units_graduating = 36, target_units = 215
    where code = 'BSCRIM';
