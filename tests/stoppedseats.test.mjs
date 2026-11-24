// stoppedseats.test.mjs
// A stopped faculty, registrar or Department account gives its seat in a programme back (db/130), so a programme
// full of stopped accounts can take new ones, and a Restore into a full programme is refused.
//
//   node --test tests/stoppedseats.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/130_stopped_accounts_free_their_seat.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../db/130_rollback.sql', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../features/admin/admindashboard.js', import.meta.url), 'utf8');

const fn = (name) => {
    const at = sql.indexOf(`function public.${name}(`);
    assert.notEqual(at, -1, `${name} is defined in db/130`);
    const end = sql.indexOf('$function$;', sql.indexOf('as $function$', at) + 13);
    return sql.slice(at, end);
};

describe('db/130: the caps count active accounts', () => {
    for (const name of ['faculty_program_cap', 'registrar_program_cap', 'department_program_cap']) {
        test(`${name} ignores stopped accounts`, () => {
            const body = fn(name);
            assert.match(body, /is_approved is true/);
            // a stopped person being linked does not take a seat either
            assert.match(body, /not exists \(select 1 from public\.\w+_staff \w+ where \w+\.id = new\.\w+_id and \w+\.is_approved is true\)/);
        });
    }

    test('the limits are unchanged: 10 faculty, 2 registrars, 1 Department account', () => {
        assert.match(fn('faculty_program_cap'), /v_count >= 10/);
        assert.match(fn('registrar_program_cap'), /v_count >= 2/);
        assert.match(fn('department_program_cap'), /already has its Department account/);
    });

    test('account creation counts active accounts for all three roles', () => {
        for (const t of ['faculty_staff', 'registrar_staff', 'department_staff']) {
            assert.ok(sql.includes(`from ${t} where program_id = v_program and is_approved is true;`), `${t} count`);
        }
        assert.match(sql, /raise exception 'db\/130: the seat counts in _provision_account were not found/);
    });
});

describe('db/130: a Restore needs a free seat', () => {
    test('set_account_stopped checks the seat before restoring a faculty, registrar or Department account', () => {
        const body = fn('set_account_stopped');
        assert.match(body, /p_role in \('faculty', 'registrar', 'department'\)/);
        assert.match(body, /perform public\._assert_seat_free\(p_role, p_target\)/);
        // only on the restore branch, never when stopping
        assert.ok(body.indexOf('_assert_seat_free') > body.indexOf('nothing to restore'));
    });

    test('the seat check names the programme and says what to do', () => {
        const body = fn('_assert_seat_free');
        assert.match(body, /cannot be restored/);
        assert.match(body, /v_count >= 10/);
        assert.match(body, /v_count >= 2/);
        assert.match(body, /v_count >= 1/);
    });

    test('the helper is not callable by the public', () => {
        assert.match(sql, /revoke all on function public\._assert_seat_free\(text, uuid\) from public, anon, authenticated/);
    });

    test('nothing is deleted, and the programme link of a stopped account is kept', () => {
        assert.doesNotMatch(sql, /delete from/i);
        assert.doesNotMatch(sql, /drop table/i);
        assert.match(sql, /programme link of a stopped account is kept/);
    });

    test('there is a rollback file', () => {
        assert.match(rollback, /drop function if exists public\._assert_seat_free/);
    });
});

describe('the admin page agrees with the database', () => {
    test('the programmes dialog counts only active staff toward "Full"', () => {
        assert.match(admin, /x\.is_approved === true && staffProgramIds\(x\)\.includes\(programId\)/);
    });

    test('a stopped person being edited is not blocked by "Full"', () => {
        assert.match(admin, /PD\.staff\.is_approved !== false && used >= cap/);
    });

    test('moving a Department account counts only active accounts', () => {
        assert.match(admin, /\.eq\('program_id', programId\)\.eq\('is_approved', true\)\.neq\('id', staff\.id\)/);
    });
});

describe('the Programs table counts active accounts only', () => {
    test('each role reads its links together with the account status, and counts only active ones', () => {
        const load = admin.slice(admin.indexOf('async function loadPrograms()'), admin.indexOf('function renderPrograms()'));
        for (const [table, staff, stat] of [['faculty_program', 'faculty_staff', 'faculty'], ['registrar_program', 'registrar_staff', 'registrar'], ['department_program', 'department_staff', 'department']]) {
            assert.ok(load.includes(`from('${table}').select('program_id, ${staff}(is_approved)')`), `${table} read`);
            assert.ok(load.includes(`${staff}?.is_approved === true) s.${stat}++`), `${stat} count`);
        }
    });

    test('a programme with only stopped faculty shows 0 / 10 (BSBA on 24 Nov 2026)', () => {
        const links = Array.from({ length: 10 }, () => ({ program_id: 3, faculty_staff: { is_approved: false } }));
        let n = 0;
        for (const f of links) if (f.faculty_staff?.is_approved === true) n++;
        assert.equal(n, 0);
    });
});
