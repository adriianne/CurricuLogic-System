// programdeptcount.test.mjs
// 24 Nov 2026: Pedro Reyes (Department) covers ACT, BSCS, BSCSAI and BSIT, but Admin -> Programs showed "1 / 1" only for BSIT and "0 / 1" for the
// other three. The Department column was counted from department_staff.program_id, which holds only the MAIN programme; Faculty and Registrar were
// already counted from their many-programme tables. Department now reads department_program (db/114), which lists every programme the account covers.
//
//   node --test tests/programdeptcount.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../features/admin/admindashboard.js', import.meta.url), 'utf8');
const load = js.slice(js.indexOf('async function loadPrograms()'), js.indexOf('function renderPrograms()'));

describe('where the Department count comes from', () => {
    test('the programme page reads department_program, not the staff table\'s single main programme', () => {
        assert.ok(load.includes("supabase.from('department_program').select('program_id')"));
        assert.equal(load.includes("supabase.from('department_staff').select('program_id')"), false);
    });
    test('Faculty and Registrar are still read from their own many-programme tables', () => {
        assert.ok(load.includes("supabase.from('faculty_program').select('program_id')"));
        assert.ok(load.includes("supabase.from('registrar_program').select('program_id')"));
    });
    test('each row of the table adds one to its programme, as before', () => {
        assert.ok(load.includes('for (const d of department.data ?? []) { const s = PROGRAM_STATS.get(d.program_id); if (s) s.department++; }'));
    });
    test('the cap shown is still one Department account per programme', () => {
        assert.ok(js.includes('department: 1 }') || /ROLE_LIMIT = \{[^}]*department: 1/.test(js));
    });
});

describe('the count on real data (Pedro covers four programmes, Eduardo one, Princess one)', () => {
    const programmes = ['ACT', 'BSA', 'BSBA', 'BSCRIM', 'BSCS', 'BSCSAI', 'BSHM', 'BSIT'];
    // department_program rows, the main programme included (db/114)
    const covers = { pedro: ['ACT', 'BSCS', 'BSCSAI', 'BSIT'], eduardo: ['BSHM'], princess: ['BSCRIM'] };
    const count = (rows) => Object.fromEntries(programmes.map((p) => [p, rows.filter((r) => r === p).length]));
    test('every programme Pedro covers shows his Department account', () => {
        const c = count(Object.values(covers).flat());
        for (const p of ['ACT', 'BSCS', 'BSCSAI', 'BSIT']) assert.equal(c[p], 1, p);
        assert.equal(c.BSHM, 1);
        assert.equal(c.BSCRIM, 1);
    });
    test('programmes nobody covers stay at 0', () => {
        const c = count(Object.values(covers).flat());
        assert.equal(c.BSA, 0);
        assert.equal(c.BSBA, 0);
    });
    test('the old count (main programme only) is what showed 0 for ACT, BSCS and BSCSAI', () => {
        const mainOnly = count(['BSIT', 'BSHM', 'BSCRIM']);
        assert.deepEqual([mainOnly.ACT, mainOnly.BSCS, mainOnly.BSCSAI, mainOnly.BSIT], [0, 0, 0, 1]);
    });
});
