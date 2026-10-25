// expectedstudents.test.mjs
// The rules of the Admin's EDP student list upload.
//
//   node --test tests/expectedstudents.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../shared/js/accounts/expectedstudents.js');

const PROGRAMS = [{ id: 1, code: 'BSIT' }, { id: 2, code: 'BSN' }];
const row = (over = {}) => ({
    __line: 2, student_id: '2401187', first_name: 'Althea', last_name: 'Villanueva',
    program_code: 'BSIT', email: 'althea@gmail.com', ...over,
});

describe('pickSheet', () => {
    test('chooses the sheet that has the student columns', () => {
        const picked = X.pickSheet([
            { name: 'Notes', aoa: [['hello']] },
            { name: 'List', aoa: [['Student ID', 'First Name', 'Last Name', 'Program Code', 'Email']] },
        ]);
        assert.equal(picked.name, 'List');
        assert.deepEqual(picked.skipped, ['Notes']);
    });
    test('null when no sheet qualifies', () => {
        assert.equal(X.pickSheet([{ name: 'A', aoa: [['first_name', 'last_name']] }]), null);
        assert.equal(X.pickSheet([]), null);
    });
    test('the earlier sheet wins a tie', () => {
        const head = [['student_id', 'email']];
        assert.equal(X.pickSheet([{ name: 'A', aoa: head }, { name: 'B', aoa: head }]).name, 'A');
    });
});

describe('checkRows', () => {
    test('a good row is ready, with the programme resolved', () => {
        const { ok, bad } = X.checkRows([row()], PROGRAMS);
        assert.equal(bad.length, 0);
        assert.equal(ok[0].programId, 1);
        assert.equal(ok[0].programCode, 'BSIT');
        assert.equal(ok[0].isUpdate, false);
    });
    test('programme code ignores case', () => {
        assert.equal(X.checkRows([row({ program_code: 'bsn' })], PROGRAMS).ok[0].programId, 2);
    });
    test('an ID already on the list is an update', () => {
        assert.equal(X.checkRows([row()], PROGRAMS, new Set(['2401187'])).ok[0].isUpdate, true);
    });
    test('spaces and dashes in the ID are dropped', () => {
        assert.equal(X.checkRows([row({ student_id: '24-011 87' })], PROGRAMS).ok[0].studentId, '2401187');
    });
    test('each kind of bad row says why', () => {
        const cases = [
            [{ student_id: '' }, /Missing student ID/],
            [{ student_id: '12345' }, /7 digits/],
            [{ first_name: '' }, /Missing first name/],
            [{ last_name: '' }, /Missing last name/],
            [{ program_code: '' }, /Missing programme/],
            [{ program_code: 'XYZ' }, /Unknown programme "XYZ".*BSIT, BSN/],
            [{ email: '' }, /Missing email/],
            [{ email: 'not-an-email' }, /./],
        ];
        for (const [over, why] of cases) {
            const { ok, bad } = X.checkRows([row(over)], PROGRAMS);
            assert.equal(ok.length, 0, JSON.stringify(over));
            assert.match(bad[0].why, why, JSON.stringify(over));
        }
    });
    test('the same ID twice in a file: the second is rejected', () => {
        const { ok, bad } = X.checkRows([row(), row({ __line: 3 })], PROGRAMS);
        assert.equal(ok.length, 1);
        assert.match(bad[0].why, /Duplicate student ID/);
        assert.equal(bad[0].line, 3);
    });
    test('good and bad rows are sorted apart', () => {
        const { ok, bad } = X.checkRows([row(), row({ student_id: '1', __line: 3 }), row({ student_id: '2401188', __line: 4 })], PROGRAMS);
        assert.equal(ok.length, 2);
        assert.equal(bad.length, 1);
    });
});

describe('search', () => {
    const list = [
        { student_id: '2401187', first_name: 'Althea', last_name: 'Villanueva', email: 'a@x.com', program_code: 'BSIT' },
        { student_id: '2401203', first_name: 'Marco', last_name: 'Deveza', email: 'm@x.com', program_code: 'BSN' },
    ];
    test('matches ID, name, email and programme', () => {
        assert.equal(X.search(list, '1187').length, 1);
        assert.equal(X.search(list, 'marco deveza').length, 1);
        assert.equal(X.search(list, 'M@X').length, 1);
        assert.equal(X.search(list, 'bsn')[0].student_id, '2401203');
    });
    test('empty search returns everything', () => {
        assert.equal(X.search(list, '  ').length, 2);
    });
});

describe('registrationAdvice', () => {
    test('only "no_match" warns, and the warning offers "Submit anyway"', () => {
        const a = X.registrationAdvice('no_match');
        assert.equal(a.warn, true);
        assert.match(a.message, /Submit anyway/);
    });
    test('a match, no list, an error or anything odd says nothing', () => {
        for (const r of ['match', 'no_list', null, undefined, '', 'banana', 42]) {
            assert.deepEqual(X.registrationAdvice(r), { warn: false, message: '' }, String(r));
        }
    });
});

describe('statusBadge', () => {
    test('on the list is a green pill and does not block', () => {
        assert.deepEqual(X.statusBadge('on_list'), { kind: 'ok', label: 'On EDP list', block: false });
    });
    test('not on the list is a red pill and blocks Approve', () => {
        const b = X.statusBadge('not_on_list');
        assert.equal(b.kind, 'bad');
        assert.equal(b.block, true);
    });
    test('no list, nothing fetched, an error or anything odd shows nothing and blocks nothing', () => {
        for (const s of ['no_list', null, undefined, '', 'banana', 7]) {
            assert.deepEqual(X.statusBadge(s), { kind: null, label: '', block: false }, String(s));
        }
    });
    test('the note tells the Registrar what to do', () => {
        assert.match(X.NOT_ON_LIST_NOTE, /ask the Admin/);
        assert.match(X.NOT_ON_LIST_NOTE, /decline/);
    });
});

describe('parseYearLevel', () => {
    test('blank stays blank', () => {
        for (const v of ['', '  ', null, undefined]) assert.deepEqual(X.parseYearLevel(v), { value: null }, String(v));
    });
    test('1 to 4, in the ways people write it', () => {
        for (const [v, n] of [['1', 1], ['2', 2], ['3rd', 3], ['4th', 4], ['3rd Year', 3], ['2nd year', 2], ['1st', 1], [' 3 ', 3]]) {
            assert.deepEqual(X.parseYearLevel(v), { value: n }, v);
        }
    });
    test('anything else is refused', () => {
        for (const v of ['0', '5', '10', 'third', 'two', '3.5', 'year 3', '-1']) assert.match(X.parseYearLevel(v).error, /1 to 4/, v);
    });
});

describe('checkRows with year_level', () => {
    test('the year goes onto the ready row', () => {
        assert.equal(X.checkRows([row({ year_level: '3rd Year' })], PROGRAMS).ok[0].yearLevel, 3);
        assert.equal(X.checkRows([row({ year_level: '' })], PROGRAMS).ok[0].yearLevel, null);
    });
    test('a file without a year_level column leaves the year unset, not blank', () => {
        assert.equal(X.checkRows([row()], PROGRAMS).ok[0].yearLevel, undefined);
    });
    test('a bad year rejects the row and says why', () => {
        const { ok, bad } = X.checkRows([row({ year_level: '7' })], PROGRAMS);
        assert.equal(ok.length, 0);
        assert.match(bad[0].why, /Year level must be 1 to 4/);
    });
});

describe('accountCandidates', () => {
    const l = (id, email) => ({ student_id: id, email, first_name: 'A', last_name: 'B' });
    const list = [l('2400001', 'a@x.com'), l('2400002', 'b@x.com'), l('2400003', 'C@X.com'), l('2400004', 'd@x.com')];

    test('everyone without an account is created', () => {
        const r = X.accountCandidates(list, new Set(), new Set(), 50);
        assert.equal(r.create.length, 4);
        assert.equal(r.skipped.length, 0);
        assert.equal(r.later, 0);
    });
    test('a student ID that already has an account is skipped, with the reason', () => {
        const r = X.accountCandidates(list, new Set(['2400002']), new Set(), 50);
        assert.deepEqual(r.create.map(x => x.student_id), ['2400001', '2400003', '2400004']);
        assert.match(r.skipped[0].why, /student ID/);
    });
    test('an email that is already used is skipped, whatever its case', () => {
        const r = X.accountCandidates(list, new Set(), new Set(['c@x.com']), 50);
        assert.equal(r.create.length, 3);
        assert.match(r.skipped[0].why, /email/);
    });
    test('the limit caps one go and says how many wait', () => {
        const r = X.accountCandidates(list, new Set(), new Set(), 3);
        assert.equal(r.create.length, 3);
        assert.equal(r.later, 1);
    });
    test('skipped students do not count against the limit', () => {
        const r = X.accountCandidates(list, new Set(['2400001']), new Set(), 3);
        assert.deepEqual(r.create.map(x => x.student_id), ['2400002', '2400003', '2400004']);
        assert.equal(r.later, 0);
    });
    test('an empty list is fine', () => {
        assert.deepEqual(X.accountCandidates([], new Set(), new Set(), 50), { create: [], skipped: [], later: 0 });
    });
});
