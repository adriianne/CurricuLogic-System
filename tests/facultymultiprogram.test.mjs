// facultymultiprogram.test.mjs
// A faculty adviser can cover more than one programme (db/107, Admin edit, Faculty header). These tests read the
// files and run the small ordering helpers; the migration itself was dry-run against the live database inside a
// transaction that rolled back (7 faculty -> 7 link rows, a non-admin call refused).
//
//   node --test tests/facultymultiprogram.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('db/107_faculty_multi_program.sql');
const admin = read('features/admin/admindashboard.js');
const faculty = read('features/faculty/facultydashboard.js');

/* Pull one top-level function out of a dashboard script so it can run on its own. */
function lift(src, name, deps = '') {
    const at = src.indexOf('function ' + name + '(');
    assert.ok(at >= 0, name + ' not found');
    let depth = 0, i = src.indexOf('{', at);
    for (let j = i; j < src.length; j++) {
        if (src[j] === '{') depth++;
        if (src[j] === '}' && --depth === 0) { i = j; break; }
    }
    return src.slice(at, i + 1);
}

describe('db/107', () => {
    test('a link table keyed by faculty and programme, filled from the existing main programme', () => {
        assert.match(sql, /create table if not exists public\.faculty_program/);
        assert.match(sql, /primary key \(faculty_id, program_id\)/);
        assert.match(sql, /insert into public\.faculty_program[\s\S]*?from public\.faculty_staff where program_id is not null/);
    });
    test('the main programme always has a link row', () => {
        assert.match(sql, /after insert or update of program_id on public\.faculty_staff/);
    });
    test('the cap of 10 per programme is a trigger, counting everyone who covers the programme', () => {
        assert.match(sql, /before insert on public\.faculty_program/);
        assert.match(sql, /v_count >= 10/);
        assert.match(sql, /faculty_id <> new\.faculty_id/);
    });
    test('only Admin writes: no write policy on the table, and the function checks for an administrator', () => {
        assert.doesNotMatch(sql, /create policy[^;]*for (insert|update|delete|all)[^;]*faculty_program/i);
        assert.match(sql, /if not public\.is_system_admin\(\) then/);
        assert.match(sql, /revoke all on function public\.set_faculty_programs/);
    });
    test('a faculty member must keep at least one programme, and the main one moves only if it was removed', () => {
        assert.match(sql, /must cover at least one programme/);
        assert.match(sql, /if v_main is null or not \(v_main = any \(v_ids\)\) then\s*v_main := v_ids\[1\]/);
    });
    test('the access rules read the list, not the single programme', () => {
        const adviser = sql.match(/function public\.is_adviser_of_student[\s\S]*?\$\$;/)[0];
        assert.match(adviser, /join faculty_program fp on fp\.program_id = s\.program_id/);
        assert.doesNotMatch(adviser, /f\.program_id/);
        assert.match(sql, /p_program_id = any \(public\.my_faculty_programs\(\)\)/);
        assert.match(sql, /create policy "registrar reads faculty" on public\.faculty_staff/);
    });
    test('Registrar and Department are untouched', () => {
        assert.doesNotMatch(sql, /create table[^;]*registrar_program/i);
        assert.doesNotMatch(sql, /create table[^;]*department_program/i);
    });
});

describe('Admin screen', () => {
    test('reads every programme a faculty member covers and shows them all, main first', () => {
        assert.match(admin, /from\('faculty_program'\)\.select\('faculty_id, program_id'\)/);
        const MULTI_ROLES = { faculty: {}, registrar: {} };
        const staffProgramIds = new Function('PROGRAMS', 'MULTI_ROLES', lift(admin, 'staffProgramIds') + '; return staffProgramIds;');
        const programs = [{ id: 1, code: 'BSIT' }, { id: 2, code: 'IS' }, { id: 3, code: 'AI' }];
        const ids = staffProgramIds(programs, MULTI_ROLES)({ role: 'faculty', program_id: 2, programs: [1, 2, 3] });
        assert.deepEqual(ids, [2, 3, 1]);           // main first, the rest by code (AI before BSIT)
    });
    test('a registrar shows all their programmes too; a department head shows only their one', () => {
        const MULTI_ROLES = { faculty: {}, registrar: {} };
        const staffProgramIds = new Function('PROGRAMS', 'MULTI_ROLES', lift(admin, 'staffProgramIds') + '; return staffProgramIds;');
        const programs = [{ id: 1, code: 'BSIT' }, { id: 2, code: 'BSED' }];
        assert.deepEqual(staffProgramIds(programs, MULTI_ROLES)({ role: 'registrar', program_id: 1, programs: [2, 1] }), [1, 2]);
        assert.deepEqual(staffProgramIds(programs, MULTI_ROLES)({ role: 'department', program_id: 1, programs: [1, 2] }), [1]);
    });
    test('editing a faculty member opens the programmes dialog and saves through set_faculty_programs', () => {
        assert.match(admin, /MULTI_ROLES\[edit\.dataset\.role\]\) return openProgramDialog\(/);
        assert.match(admin, /rpc: 'set_faculty_programs'/);
        assert.match(admin, /Choose at least one programme/);
        const html = read('features/admin/admindashboard.html');
        assert.match(html, /<dialog id="prog-dialog" class="prog-dlg"/);
        assert.match(html, /id="prog-dlg-search"/);
    });
    test('the dialog groups by college, greys out a full programme, and stars the main one', () => {
        assert.match(admin, /const full = !on && !otherCollege && PD\.staff\.is_approved !== false && used >= cap/);   // db/130: a stopped person takes no seat
        assert.match(admin, /data-pd-main=/);
        assert.match(admin, /Full \\u00b7 \$\{used\} of \$\{cap\}/);
    });
    test('Save stays off until something changed and at least one programme is ticked', () => {
        assert.match(admin, /\$\('prog-dlg-save'\)\.disabled = PD\.busy \|\| n === 0 \|\| pdKey\(\) === PD\.start/);
    });
    test('the main programme moves with a second update only when it differs from what the function kept', () => {
        assert.match(admin, /const keptMain = ids\.includes\(staff\.program_id\) \? staff\.program_id : ids\[0\]/);
        assert.match(admin, /if \(wantMain !== keptMain\)/);
        assert.match(admin, /from\(cfg\.table\)\.update\(\{ program_id: wantMain \}\)\.eq\('id', staffId\)/);
    });
    test('the row shows at most three pills and counts the rest', () => {
        assert.match(admin, /const SHOWN = 3/);
        assert.match(admin, /class="pill-more"/);
    });
    test('the cap message from the database is shown as it is', () => {
        assert.match(admin, /\/maximum of\/\.test\(error\.message\)/);
    });
    test('programme counts on the Programs tab count faculty by every programme they cover', () => {
        assert.match(admin, /supabase\.from\('faculty_program'\)\.select\('program_id, faculty_staff\(is_approved\)'\)/);   // active accounts only (db/130)
    });
});

describe('Faculty screen', () => {
    test('loads its own programmes and shows several as a short list', () => {
        assert.match(faculty, /from\('faculty_program'\)\.select\('program_id'\)\.eq\('faculty_id', FACULTY\.id\)/);
        assert.match(faculty, /await loadOwnPrograms\(\);\s*paintProgramField\(\);/);
        assert.match(faculty, /codes\.join\(', '\)/);
    });
    test('main programme first, and a faculty member with no list falls back to the main programme', () => {
        const run = (FACULTY, list) => new Function('FACULTY', 'FACULTY_PROGRAM_IDS',
            lift(faculty, 'coveredProgramIds') + '; return coveredProgramIds();')(FACULTY, list);
        assert.deepEqual(run({ program_id: 2 }, [1, 2, 3]), [2, 1, 3]);
        assert.deepEqual(run({ program_id: 7 }, []), [7]);
        assert.deepEqual(run({ program_id: null }, []), []);
    });
});

describe('one college only (db/108)', () => {
    const sql108 = read('db/108_faculty_one_college.sql');
    test('a trigger refuses a programme from another college than the ones already covered', () => {
        assert.match(sql108, /before insert on public\.faculty_program/);
        assert.match(sql108, /only cover programmes from one college/);
        assert.match(sql108, /lower\(btrim\(coalesce\(p\.college, ''\)\)\) <> coalesce\(v_college, ''\)/);
    });
    test('the dialog greys out other colleges once a programme is ticked, and frees them when nothing is ticked', () => {
        assert.match(admin, /const otherCollege = !on && lock !== null && collegeKey\(p\) !== lock/);
        assert.match(admin, /Different college/);
        const pdCollege = lift(admin, 'pdCollege');
        const collegeKey = (p) => String(p?.college ?? '').trim().toLowerCase();
        const run = (chosen, programs) => new Function('PD', 'PROGRAMS', 'collegeKey', pdCollege + '; return pdCollege();')({ chosen: new Set(chosen) }, programs, collegeKey);
        const programs = [{ id: 1, college: 'College of Computer Studies' }, { id: 2, college: ' college of computer studies ' }, { id: 5, college: 'College of Nursing' }];
        assert.equal(run([], programs), null);
        assert.equal(run([2], programs), 'college of computer studies');
    });
    test('the dialog tells Admin the rule', () => {
        assert.match(read('features/admin/admindashboard.html'), /all from one college/);
    });
});

describe('policy recursion hotfix (db/109)', () => {
    const sql109 = read('db/109_fix_faculty_policy_recursion.sql');
    test('the two cross-table checks go through SECURITY DEFINER functions, so the rules cannot loop', () => {
        assert.match(sql109, /function public\.is_my_faculty_row[\s\S]*?security definer/);
        assert.match(sql109, /function public\.registrar_covers_faculty[\s\S]*?security definer/);
        assert.match(sql109, /using \(public\.is_my_faculty_row\(faculty_id\)\)/);
        assert.match(sql109, /using \(public\.registrar_covers_faculty\(id\)\)/);
    });
    test('no policy on faculty_staff or faculty_program reads the other table directly', () => {
        const policies = sql109.match(/create policy[\s\S]*?;/g).join('\n');
        assert.doesNotMatch(policies, /from public\.faculty_(staff|program)/);
    });
});

describe('Registrar: any programmes, no college rule (db/110)', () => {
    const sql110 = read('db/110_registrar_multi_program.sql');
    const registrar = read('features/registrar/registrardashboard.js');
    test('a link table, the main programme always in it, filled from the existing accounts', () => {
        assert.match(sql110, /create table if not exists public\.registrar_program/);
        assert.match(sql110, /insert into public\.registrar_program[\s\S]*?from public\.registrar_staff where program_id is not null/);
        assert.match(sql110, /after insert or update of program_id on public\.registrar_staff/);
    });
    test('cap of 2 per programme as a trigger, and no college trigger', () => {
        assert.match(sql110, /before insert on public\.registrar_program/);
        assert.match(sql110, /v_count >= 2/);
        assert.doesNotMatch(sql110.replace(/--[^\n]*/g, ''), /college/i);
    });
    test('only Admin writes; the policies cannot loop (cross-table checks go through definer functions)', () => {
        assert.doesNotMatch(sql110, /create policy[^;]*for (insert|update|delete|all)[^;]*registrar_program/i);
        assert.match(sql110, /if not public\.is_system_admin\(\) then/);
        assert.match(sql110, /using \(public\.is_my_registrar_row\(registrar_id\)\)/);
        const policies = sql110.match(/create policy[\s\S]*?;/g).join('\n');
        assert.doesNotMatch(policies, /from public\.(registrar_staff|faculty_staff|registrar_program|faculty_program)/);
    });
    test('the rules that said "the registrar\'s programme" now accept any of them', () => {
        assert.match(sql110, /function public\.is_registrar_of_student[\s\S]*?registrar_program rp where rp\.registrar_id = r\.id and rp\.program_id = s\.program_id/);
        assert.match(sql110, /program_id = any \(public\.my_registrar_programs\(\)\)/);
        assert.match(sql110, /p_program_id = any \(public\.my_registrar_programs\(\)\)/);
    });
    test('Admin edits a Registrar in the same dialog, with the cap of 2 and no college lock', () => {
        assert.match(admin, /registrar: \{ rpc: 'set_registrar_programs', idArg: 'p_registrar_id', table: 'registrar_staff', oneCollege: false/);
        assert.match(admin, /faculty:   \{ rpc: 'set_faculty_programs',   idArg: 'p_faculty_id',   table: 'faculty_staff',   oneCollege: true/);
        assert.match(admin, /supabase\.rpc\(cfg\.rpc, \{ \[cfg\.idArg\]: staffId, p_program_ids: ids \}\)/);
        assert.match(admin, /const lock = MULTI_ROLES\[PD\.staff\.role\]\.oneCollege \? pdCollege\(\) : null/);
        assert.match(admin, /const cap = ROLE_LIMIT\[PD\.staff\.role\]/);
        assert.match(admin, /supabase\.from\('registrar_program'\)\.select\('program_id, registrar_staff\(is_approved\)'\)/);   // active accounts only (db/130)
    });
    test('Registrar page: shows every programme in the header and in the profile', () => {
        assert.match(registrar, /from\('registrar_program'\)\.select\('program_id'\)\.eq\('registrar_id', REGISTRAR\.id\)/);
        assert.match(registrar, /codes\.join\(', '\)/);
    });
    test('Registrar page refreshes every minute, quietly, only while the list is on screen', () => {
        assert.match(registrar, /ADVISING_REFRESH_MS = 60 \* 1000/);
        assert.match(registrar, /setInterval\(refreshAdvising, ADVISING_REFRESH_MS\)/);
        assert.match(registrar, /PREVIEW \|\| !supabase \|\| !REGISTRAR \|\| document\.hidden \|\| ADVISING_REFRESH_BUSY/);
        assert.match(registrar, /name === 'advising' && !param && \$\('adv-sub-detail'\)\?\.hidden/);
        assert.match(registrar, /if \(quiet\) return;/);
        assert.match(registrar, /if \(!quiet\) ADV_PAGE = 1;/);
        assert.match(registrar, /startAdvisingRefresh\(\);\s*route\(\);/);
    });
});

describe('Registrar: the Approved plans count follows the programme switch', () => {
    const registrar = read('features/registrar/registrardashboard.js');
    test('the "N of M" total and the partly-approved count are taken from the plans in the selected programme', () => {
        assert.match(registrar, /const inScope = PROGRAM_SCOPE === 'all' \? ADV_PLANS : ADV_PLANS\.filter\(r => Number\(r\.student\?\.program_id\) === PROGRAM_SCOPE\);/);
        assert.match(registrar, /const partial = inScope\.filter\(r => r\.status === 'partially_approved'\)\.length;/);
        assert.match(registrar, /\$\{list\.length\} of \$\{inScope\.length\} · \$\{partial\} partly approved/);
    });
});
