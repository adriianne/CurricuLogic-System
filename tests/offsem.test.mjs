// offsem.test.mjs
// Off-semester sections (db/133, shared/js/schedule/offsem.js): the helpers, and where the panel is wired in.
//
//   node --test tests/offsem.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const O = require('../shared/js/schedule/offsem.js');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const lec = { type: 'LEC', days: 'MW', start: '07:30', end: '09:00', room: 'Room 305', instructor: '', edp_code: '62001' };
const lab = { type: 'LAB', days: 'F', start: '13:00', end: '16:00', room: 'Comp Lab 4', instructor: '', edp_code: '62002' };
const draft = (over = {}) => ({ programCode: 'BSIT', section: 'BSIT-1R', hasLab: false, meetings: [lec], ...over });

describe('validateDraft', () => {
    test('a lecture with days, times, a room and an EDP code is fine', () => assert.deepEqual(O.validateDraft(draft()), []));
    test('a lecture and a laboratory are fine when the subject has a laboratory', () => assert.deepEqual(O.validateDraft(draft({ hasLab: true, meetings: [lec, lab] })), []));
    test('a laboratory is refused for a subject without one', () => assert.match(O.validateDraft(draft({ meetings: [lec, lab] })).join(' '), /no laboratory/));
    test('the lecture is required', () => assert.match(O.validateDraft(draft({ hasLab: true, meetings: [lab] })).join(' '), /lecture/i));
    test('the section must carry the programme code, the year and a letter', () => {
        assert.match(O.validateDraft(draft({ section: 'ACT-1R' }))[0], /BSIT/);
        assert.match(O.validateDraft(draft({ section: 'BSIT-R' }))[0], /BSIT/);
        assert.equal(O.validateDraft(draft({ section: 'bsit-3s' })).length, 0, 'lower case is accepted, the server upper-cases it');
    });
    test('days must be M T W TH F S letters; TH counts as one', () => {
        assert.ok(O.daysValid('TTH') && O.daysValid('mw') && O.daysValid('Th') && O.daysValid('MWF') && O.daysValid('S'));
        assert.ok(!O.daysValid('XY') && !O.daysValid('') && !O.daysValid('H'));
        assert.match(O.validateDraft(draft({ meetings: [{ ...lec, days: 'XY' }] })).join(' '), /days/);
    });
    test('the start must be before the end, inside 07:00 to 21:00', () => {
        assert.match(O.validateDraft(draft({ meetings: [{ ...lec, start: '10:00', end: '09:00' }] })).join(' '), /before the end/);
        assert.match(O.validateDraft(draft({ meetings: [{ ...lec, start: '06:00', end: '08:00' }] })).join(' '), /07:00 and 21:00/);
        assert.match(O.validateDraft(draft({ meetings: [{ ...lec, start: '', end: '' }] })).join(' '), /start and end/);
    });
    test('a room and a five-digit EDP code are required, and the two meetings need different codes', () => {
        assert.match(O.validateDraft(draft({ meetings: [{ ...lec, room: '' }] })).join(' '), /room/);
        assert.match(O.validateDraft(draft({ meetings: [{ ...lec, edp_code: '123' }] })).join(' '), /five digits/);
        assert.match(O.validateDraft(draft({ hasLab: true, meetings: [lec, { ...lab, edp_code: '62001' }] })).join(' '), /different EDP/);
    });
});

describe('the other helpers', () => {
    test('nextSectionName starts at R and takes the next free letter', () => {
        assert.equal(O.nextSectionName('BSIT', 1, []), 'BSIT-1R');
        assert.equal(O.nextSectionName('BSIT', 1, ['BSIT-1R']), 'BSIT-1S');
        assert.equal(O.nextSectionName('BSIT', 2, ['BSIT-1R', 'BSIT-2R', 'BSIT-2S']), 'BSIT-2T');
        assert.equal(O.nextSectionName('bsn', 3, []), 'BSN-3R');
    });
    test('isOffSem is true when the subject belongs to another semester than the term', () => {
        assert.equal(O.isOffSem({ term: 1 }, 2), true);
        assert.equal(O.isOffSem({ term: 2 }, 2), false);
        assert.equal(O.isOffSem({ term: null }, 2), false);
        assert.equal(O.isOffSem({ term: '1' }, 2), true);
    });
    test('describeError says it in words', () => {
        assert.equal(O.describeError({ message: 'Meeting 1: room Room 1 is already in use at that time.' }), 'Meeting 1: room Room 1 is already in use at that time.');
        assert.match(O.describeError({ message: 'new row violates row-level security policy' }), /not allowed/);
        assert.match(O.describeError({ message: 'duplicate key value violates unique constraint "uq_offering_edp"' }), /already used/);
        assert.match(O.describeError(null), /Nothing was changed/);
    });
});

describe('the database part (db/133)', () => {
    const sql = read('../db/133_offsem_sections.sql');
    test('two functions, no new table or column', () => {
        assert.equal((sql.match(/create or replace function/g) ?? []).length, 2);
        assert.doesNotMatch(sql, /create table|alter table/i);
    });
    test('only the System administrator or a Department Staff of the programme may call them', () => {
        assert.match(sql, /public\.is_system_admin\(\)/);
        assert.match(sql, /public\.department_covers_program\(p_program_id\)/);
        assert.match(sql, /grant\s+execute on function public\.add_offsem_section\(integer, integer, text, jsonb\) to authenticated/);
        assert.match(sql, /revoke execute on function public\.add_offsem_section[^;]*from public, anon/);
    });
    test('it checks clashes in the room, with the instructor and within the section, and the EDP code', () => {
        assert.match(sql, /is already in use at that time/);
        assert.match(sql, /is already teaching at that time/);
        assert.match(sql, /overlaps another meeting of section/);
        assert.match(sql, /is already used this term/);
    });
    test('it writes an audit row, and removal never touches a regular section or a section a student chose', () => {
        assert.match(sql, /ADD_OFFSEM_SECTION/);
        assert.match(sql, /REMOVE_OFFSEM_SECTION/);
        assert.match(sql, /s\.term is distinct from o\.term/);
        assert.match(sql, /request_item ri where ri\.offering_id = any/);
    });
    test('there is a rollback file', () => assert.match(read('../db/133_rollback.sql'), /drop function if exists public\.add_offsem_section/));
});

describe('where the panel is wired in', () => {
    test('the Admin page has a nav link, a view, the script, and mounts it for every programme', () => {
        const html = read('../features/admin/admindashboard.html');
        const js = read('../features/admin/admindashboard.js');
        assert.match(html, /data-view="offsem"/);
        assert.match(html, /id="view-offsem"/);
        assert.ok(html.indexOf('shared/js/schedule/offsem.js') > 0);
        assert.match(js, /offsem:\s+'Off-semester sections'/);
        assert.match(js, /if \(name === 'offsem'\)\s+initOffsem\(\)/);
        assert.match(js, /from\('program'\)\.select\('id, code, name'\)/);
    });
    test('the Department page has a card under Sections this term, and mounts it for its own programme only', () => {
        const html = read('../features/department/departmentdashboard.html');
        const js = read('../features/department/departmentdashboard.js');
        assert.ok(html.indexOf('id="offsem-card"') > html.indexOf('id="sections-card"') && html.indexOf('id="offsem-card"') < html.indexOf('id="build-card"'));
        assert.ok(html.indexOf('shared/js/schedule/offsem.js') > 0);
        assert.match(js, /if \(name === 'schedule'\) \{ initSchedule\(\); initOffsemCard\(\); \}/);
        assert.match(js, /programs: \[\{ id: PROGRAM\.id, code: PROGRAM\.code, name: PROGRAM\.name \}\]/);
    });
    test('the existing schedule builder and its "wrong term" check are untouched', () => {
        const js = read('../features/department/departmentdashboard.js');
        assert.match(js, /wrong_term/);
        assert.match(js, /sectionSubjects\(section, term\)/);
    });
});
