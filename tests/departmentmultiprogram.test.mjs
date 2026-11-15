// departmentmultiprogram.test.mjs
// A Department account (a "dean") can cover several programmes of ONE college (db/114, Admin edit, Department header).
// These tests read the migration and the pages, and run the small pure helpers. The migration is DRAFTED here; it is
// applied to the live database only after a backup and the owner's yes.
//
//   node --test tests/departmentmultiprogram.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PS = require('../shared/js/app/programswitch.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('db/114_department_multi_program.sql');
const snapshot = read('db/schema-snapshot-2026-11-06.sql');
const admin = read('features/admin/admindashboard.js');
const dept = read('features/department/departmentdashboard.js');
const deptHtml = read('features/department/departmentdashboard.html');

function lift(src, name) {
    const at = src.indexOf('function ' + name + '(');
    assert.ok(at >= 0, name + ' not found');
    let depth = 0, end = src.indexOf('{', at);
    for (let j = end; j < src.length; j++) {
        if (src[j] === '{') depth++;
        if (src[j] === '}' && --depth === 0) { end = j; break; }
    }
    return src.slice(at, end + 1);
}

describe('db/114: the list', () => {
    test('a link table keyed by Department account and programme, filled from the existing main programme', () => {
        assert.match(sql, /create table if not exists public\.department_program/);
        assert.match(sql, /primary key \(department_id, program_id\)/);
        assert.match(sql, /insert into public\.department_program \(department_id, program_id\)\s+select id, program_id from public\.department_staff where program_id is not null/);
    });
    test('the main programme is always in the list, through a trigger on the staff row', () => {
        assert.match(sql, /create trigger department_main_program_link\s+after insert or update of program_id on public\.department_staff/);
    });
    test('one Department account per programme, counted across everyone who covers it, by trigger', () => {
        assert.match(sql, /create trigger department_program_cap\s+before insert on public\.department_program/);
        assert.match(sql, /where program_id = new\.program_id and department_id <> new\.department_id/);
    });
    test('a row that already exists never trips the cap, so the two existing BSIT Department accounts stay editable', () => {
        const cap = sql.slice(sql.indexOf('create or replace function public.department_program_cap'), sql.indexOf('drop trigger if exists department_program_cap'));
        const skip = cap.indexOf('department_id = new.department_id');
        const claim = cap.indexOf('department_id <> new.department_id');
        assert.ok(skip > 0 && claim > skip, 'the "already there" check comes first');
        assert.match(cap.slice(skip, claim), /return new;/);
    });
    test('related programmes only: one college, by trigger', () => {
        assert.match(sql, /create trigger department_program_college\s+before insert on public\.department_program/);
        assert.match(sql, /only cover programmes from one college/);
    });
    test('only an administrator changes the list, through set_department_programs; no write policy exists', () => {
        assert.match(sql, /create or replace function public\.set_department_programs\(p_department_id uuid, p_program_ids integer\[\]\)/);
        assert.match(sql, /if not public\.is_system_admin\(\) then/);
        assert.doesNotMatch(sql, /create policy[^;]*on public\.department_program\s+for (insert|update|delete|all)/i);
        assert.match(sql, /revoke all on function public\.set_department_programs\(uuid, integer\[\]\) from public, anon, authenticated, service_role/);
    });
    test('who can read the list goes through a definer function, so no rule can loop (the db/109 mistake)', () => {
        assert.match(sql, /using \(public\.is_my_department_row\(department_id\)\)/);
        assert.match(sql, /create or replace function public\.is_my_department_row[\s\S]*?security definer/);
    });
});

describe('db/114: every Department rule now means "any of my programmes"', () => {
    test('department_covers_program is false for null and for anything outside the list', () => {
        assert.match(sql, /select p_program_id is not null and p_program_id = any \(public\.my_department_programs\(\)\)/);
    });
    test('no rule written in this file still says "equals my one programme"', () => {
        // comment lines (like the check queries at the end) are not rules
        const body = sql.split('-- 9a. functions (9)')[1].split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
        // the two section functions keep it only to check "is this an approved Department account at all"
        const uses = body.match(/my_department_program\(\)/g) || [];
        assert.equal(uses.length, 2);
        // ("v := my_department_program()" is an assignment, the null check above, not a comparison)
        assert.doesNotMatch(body, /(?<!:)(=|is distinct from) (public\.)?my_department_program\(\)/i);
    });
    test('every policy and function that used the one-programme helper in the schema snapshot is rewritten', () => {
        const names = ['activate_prospectus', 'copy_prospectus', 'delete_draft_prospectus', 'retire_subject', 'section_demand', 'section_demand_students',
            'set_section_all_open', 'set_section_open', 'update_subject'];
        for (const n of names) assert.match(sql, new RegExp('CREATE OR REPLACE FUNCTION public\\.' + n + '\\('), n);
        const policies = ['department_manage_elective_groups', 'department_manage_elective_members', 'department_manage_prerequisites',
            'department_manage_prospectus', 'department_manage_subjects', 'department_manage_offerings'];
        for (const p of policies) {
            assert.match(sql, new RegExp('drop policy if exists ' + p + ' on '), p + ' dropped');
            assert.match(sql, new RegExp('create policy ' + p + ' on '), p + ' re-created');
        }
        // and nothing else in the snapshot used the helper that this file forgot
        const users = new Set((snapshot.match(/CREATE OR REPLACE FUNCTION public\.(\w+)\([^$]*?\$function\$[\s\S]*?\$function\$/g) || [])
            .filter(b => /my_department_program\(\)/.test(b)).map(b => b.match(/public\.(\w+)\(/)[1]));
        for (const n of users) {
            if (['my_department_program', 'is_department_of_student'].includes(n)) continue;
            assert.ok(names.includes(n), n + ' uses my_department_program() but is not rewritten');
        }
    });
    test('copying a curriculum version works for any covered programme and creates the copy under the source programme', () => {
        const copy = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.copy_prospectus'));
        assert.match(copy, /v_prog := v_src\.program_id;/);
        assert.match(copy, /not public\.department_covers_program\(v_prog\)/);
    });
    test('the helper that decides which students a Department sees uses the list', () => {
        assert.match(sql, /public\.department_covers_program\(s\.program_id\)/);
        assert.match(sql, /p_program_id = any \(public\.my_department_programs\(\)\)/);
    });
    test('a Registrar sees every Department account that covers any of their programmes', () => {
        assert.match(sql, /select distinct dp\.department_id from public\.department_program dp\s+where dp\.program_id = any \(public\.my_registrar_programs\(\)\)/);
    });
    test('it states that it is drafted and how to undo it', () => {
        assert.match(sql, /STATUS: DRAFTED, NOT APPLIED/);
        assert.match(sql, /TO UNDO/);
    });
});

describe('Admin', () => {
    test('reads the list and shows every covered programme for a Department account', () => {
        assert.match(admin, /from\('department_program'\)\.select\('department_id, program_id'\)/);
        assert.match(admin, /role: 'department', programs: departmentCoverage\.get\(s\.id\)/);
    });
    test('Department is edited in the same dialog as Faculty: several programmes, one college, set_department_programs', () => {
        assert.match(admin, /department: \{ rpc: 'set_department_programs', idArg: 'p_department_id', table: 'department_staff', oneCollege: true/);
        assert.doesNotMatch(admin, /single: true/);
    });
    test('a Department account shows all its programmes, main first', () => {
        const MULTI_ROLES = { faculty: {}, registrar: {}, department: {} };
        const staffProgramIds = new Function('PROGRAMS', 'MULTI_ROLES', lift(admin, 'staffProgramIds') + '; return staffProgramIds;');
        const programs = [{ id: 1, code: 'BSIT' }, { id: 2, code: 'BSIS' }];
        assert.deepEqual(staffProgramIds(programs, MULTI_ROLES)({ role: 'department', program_id: 2, programs: [1, 2] }), [2, 1]);
    });
    test('the cap in the dialog is 1 Department account per programme', () => {
        assert.match(admin, /const ROLE_LIMIT = \{ faculty: 10, registrar: 2, department: 1 \}/);
    });
});

describe('the shared switch can leave out "All"', () => {
    const options = [{ id: 7, code: 'BSIT' }, { id: 14, code: 'BSIS' }];
    test('with All allowed nothing changes', () => {
        assert.equal(PS.resolveChoice(undefined, options), 'all');
        assert.equal(PS.resolveChoice('14', options), 14);
        assert.equal(PS.resolveChoice('99', options, true), 'all');
    });
    test('without All, nothing or a stale choice falls back to the first programme', () => {
        assert.equal(PS.resolveChoice(undefined, options, false), 7);
        assert.equal(PS.resolveChoice('all', options, false), 7);
        assert.equal(PS.resolveChoice('99', options, false), 7);
        assert.equal(PS.resolveChoice('14', options, false), 14);
        assert.equal(PS.resolveChoice(undefined, [], false), 'all');
    });
    test('the menu has no "All" row when it is not allowed, and setOptions takes the page\'s own choice', () => {
        const src = read('shared/js/app/programswitch.js');
        assert.match(src, /\(allowAll \? row\(ALL, 'All my programmes', '', choice === ALL\) : ''\)/);
        assert.match(src, /setOptions\(list, initial\)/);
        assert.match(src, /initial != null \? initial : read\(\)/);
    });
});

describe('Department page', () => {
    test('loads the programmes it covers, falling back to the main programme if the list cannot be read', () => {
        assert.match(dept, /from\('department_program'\)\.select\('program_id'\)\.eq\('department_id', STAFF\.id\)/);
        const coveredIds = new Function(lift(dept, 'coveredIds') + '; return coveredIds;')();
        assert.deepEqual(coveredIds([{ program_id: 2 }, { program_id: 3 }], 2), [2, 3]);
        assert.deepEqual(coveredIds([], 5), [5]);
        assert.deepEqual(coveredIds(null, null), []);
        assert.deepEqual(coveredIds([{ program_id: 3 }, { program_id: 3 }], 2), [3, 2]);   // the main one is always included
    });
    test('boot passes the list to initPrograms and the list narrows the programmes on offer', () => {
        assert.match(dept, /initPrograms\(await loadCovered\(\)\)/);
        assert.match(dept, /PROGRAM_LIST = PROGRAM_LIST\.filter\(p => ids\.includes\(p\.id\)\)/);
    });
    test('a dean starts on the main programme until they choose another', () => {
        assert.match(dept, /pickProgram\(PROGRAM_LIST, savedProgramId\(\) \?\? STAFF\?\.program_id \?\? null, ALL_VERSIONS\)/);
    });
    test('with several programmes the header gets a switch without "All"; choosing saves and reloads', () => {
        assert.match(dept, /PROGRAM_LIST\.length > 1 && window\.CurriculogicProgramSwitch/);
        assert.match(dept, /allowAll: false/);
        assert.match(dept, /saveProgramId\(value\);\s+window\.location\.reload\(\)/);
        assert.match(deptHtml, /<script src="\.\.\/\.\.\/shared\/js\/app\/programswitch\.js"><\/script>/);
    });
    test('the students list and counts follow the chosen programme, since the database now allows several', () => {
        assert.match(dept, /function inChosenProgram\(query\)/);
        assert.match(dept, /programScoped\(\) && PROGRAM \? query\.eq\('program_id', PROGRAM\.id\) : query/);
        assert.match(dept, /let q = inChosenProgram\(supabase\.from\('university_student'\)\.select\(STUDENT_COLS/);
        assert.match(dept, /const head = \(\) => inChosenProgram\(/);
    });
    test('setup counts describe the chosen programme, not the main one', () => {
        assert.match(dept, /const myProgramId = PROGRAM\?\.id \?\? STAFF\?\.program_id \?\? null/);
    });
});
