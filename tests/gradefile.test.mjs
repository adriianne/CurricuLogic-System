// gradefile.test.mjs
// How the grade upload works out a spreadsheet's shape.
//
//   node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const GF = require('../shared/js/gradefile.js');

const HEADER = ['student_id', 'student_name', 'subject_code', 'grade', 'status'];
const row = (id, name, code, grade = '', status = '') => [id, name, code, grade, status];

describe('normHeader', () => {
    test('lower-cases and joins words', () => {
        assert.equal(GF.normHeader(' Final  Grade '), 'final_grade');
        assert.equal(GF.normHeader('Student No.'), 'student_no');
        assert.equal(GF.normHeader('SUBJECT-CODE'), 'subject_code');
    });
    test('blank and non-string cells become empty', () => {
        assert.equal(GF.normHeader(null), '');
        assert.equal(GF.normHeader(undefined), '');
    });
});

describe('locateHeader', () => {
    test('finds a header in row 1', () => {
        const h = GF.locateHeader([HEADER, row('2401187', 'A', 'X 1')]);
        assert.equal(h.headerIdx, 0);
        assert.deepEqual(h.columns, HEADER);
    });

    test('finds a header under a title and a blank row', () => {
        const h = GF.locateHeader([
            ['BSCRIM grades, 1st Sem'], [], HEADER, row('2401187', 'A', 'X 1'),
        ]);
        assert.equal(h.headerIdx, 2);
    });

    test('accepts common alternative names', () => {
        const h = GF.locateHeader([['Student No', 'Course Code', 'Final Grade', 'Name']]);
        assert.deepEqual(h.columns, ['student_id', 'subject_code', 'grade', 'student_name']);
    });

    test('null when a required column is missing', () => {
        assert.equal(GF.locateHeader([['student_id', 'grade']]), null);
        assert.equal(GF.locateHeader([['subject_code', 'grade']]), null);
        assert.equal(GF.locateHeader([]), null);
    });

    test('a data row far below is not taken for the header', () => {
        const filler = Array.from({ length: 20 }, () => ['x']);
        assert.equal(GF.locateHeader([...filler, HEADER]), null);
    });

    test('a repeated name keeps the first column', () => {
        const h = GF.locateHeader([['student_id', 'subject_code', 'Subject']]);
        assert.deepEqual(h.columns, ['student_id', 'subject_code', null]);
    });

    test('"remarks", "result", "year" and "semester" are not silently taken as status, year or term', () => {
        const h = GF.locateHeader([['student_id', 'subject_code', 'remarks', 'result', 'year', 'semester']]);
        assert.deepEqual(h.columns, ['student_id', 'subject_code', null, null, null, null]);
    });
});

describe('pickSheet', () => {
    test('skips a sheet with no grade header', () => {
        const picked = GF.pickSheet([
            { name: 'Notes', aoa: [['read me'], ['nothing here']] },
            { name: 'Grades', aoa: [HEADER, row('1', 'A', 'X 1')] },
        ]);
        assert.equal(picked.name, 'Grades');
    });

    test('takes the sheet with the most grade rows, like a workbook with a stray import sheet', () => {
        const big = [HEADER, ...Array.from({ length: 39 }, (_, i) => row(`24011${i}`, 'N', 'X 1', '2'))];
        const small = [HEADER, row('1', 'A', 'X 1'), row('2', 'B', 'X 1'), row('3', 'C', 'X 1')];
        const picked = GF.pickSheet([
            { name: 'student_id,student_name,subject', aoa: big },
            { name: 'Grades', aoa: small },
        ]);
        assert.equal(picked.name, 'student_id,student_name,subject');
        assert.equal(picked.dataRows, 39);
    });

    test('a tie goes to the earlier sheet', () => {
        const a = [HEADER, row('1', 'A', 'X 1')];
        const picked = GF.pickSheet([{ name: 'first', aoa: a }, { name: 'second', aoa: a }]);
        assert.equal(picked.name, 'first');
    });

    test('null when no sheet has a usable header', () => {
        assert.equal(GF.pickSheet([{ name: 'a', aoa: [['x', 'y']] }]), null);
        assert.equal(GF.pickSheet([]), null);
        assert.equal(GF.pickSheet(undefined), null);
    });
});

describe('readRows', () => {
    test('rows use canonical names and Excel row numbers', () => {
        const picked = GF.pickSheet([{
            name: 's',
            aoa: [['title'], [], ['Student No', 'Course Code', 'Final Grade'],
                  ['2401187', 'CC-COMPROG12', '2.25'], [], ['2401188', 'SOCIO101', '']],
        }]);
        const rows = GF.readRows(picked);
        assert.equal(rows.length, 2);
        assert.equal(rows[0].student_id, '2401187');
        assert.equal(rows[0].subject_code, 'CC-COMPROG12');
        assert.equal(rows[0].grade, '2.25');
        assert.equal(rows[0].__line, 4);    // row 4 in Excel
        assert.equal(rows[1].__line, 6);    // the blank row 5 was skipped
    });

    test('every canonical column exists on every row', () => {
        const picked = GF.pickSheet([{ name: 's', aoa: [['student_id', 'subject_code'], ['1', 'X 1']] }]);
        const [r] = GF.readRows(picked);
        assert.equal(r.status, '');
        assert.equal(r.grade, '');
        assert.equal(r.term, '');
    });

    test('cell text is trimmed', () => {
        const picked = GF.pickSheet([{ name: 's', aoa: [['student_id', 'subject_code'], [' 24 ', ' X 1 ']] }]);
        const [r] = GF.readRows(picked);
        assert.equal(r.student_id, '24');
        assert.equal(r.subject_code, 'X 1');
    });
});

describe('normCode', () => {
    test('ignores spaces and case', () => {
        assert.equal(GF.normCode(' hum 101 '), 'HUM101');
    });
    test('reads en dash, em dash and minus as a hyphen', () => {
        assert.equal(GF.normCode('HUM – REP 101'), 'HUM-REP101');
        assert.equal(GF.normCode('HUM — REP 101'), 'HUM-REP101');
        assert.equal(GF.normCode('HUM − REP 101'), 'HUM-REP101');
        assert.equal(GF.normCode('HUM-REP 101'), GF.normCode('HUM – REP 101'));
    });
    test('null and undefined are empty', () => {
        assert.equal(GF.normCode(null), '');
        assert.equal(GF.normCode(undefined), '');
    });
});

describe('header spellings seen in real files', () => {
    const cols = (h) => GF.locateHeader([h, ['1', 'A', '1.0']])?.columns;
    test('Student ID Number / Student # / Stud. No.', () => {
        assert.equal(cols(['Student ID Number', 'Subject Code', 'Grade'])[0], 'student_id');
        assert.equal(cols(['Student #', 'Subject Code', 'Grade'])[0], 'student_id');
        assert.equal(cols(['Stud. No.', 'Subj. Code', 'Final Grade'])[0], 'student_id');
    });
    test('Subj. Code / Sub Code / Course Number find the subject', () => {
        assert.equal(cols(['Student ID', 'Subj. Code', 'Grade'])[1], 'subject_code');
        assert.equal(cols(['Student ID', 'Sub Code', 'Grade'])[1], 'subject_code');
        assert.equal(cols(['Student Number', 'Course Number', 'Grade'])[1], 'subject_code');
    });
    test('S.Y. becomes academic_year; Semester is left alone', () => {
        const c = cols(['Student ID', 'Subject Code', 'Grade', 'Semester', 'S.Y.']);
        assert.equal(c[3], null);
        assert.equal(c[4], 'academic_year');
    });
    test('a lone "Course" column is not taken as the subject (it is the programme)', () => {
        assert.equal(GF.locateHeader([['Student No', 'Course', 'Grade'], ['1', 'BSIT', '1.0']]), null);
    });
    test('a plain "Student" column is still the name', () => {
        assert.equal(cols(['Student', 'Student No', 'Subject Code'])[0], 'student_name');
    });
});

describe('looseCode', () => {
    test('hyphen, dot, space and case all reach one key', () => {
        const k = GF.looseCode('CRIM 111');
        assert.equal(GF.looseCode('CRIM-111'), k);
        assert.equal(GF.looseCode('crim.111'), k);
        assert.equal(GF.looseCode('CRIM – 111'), k);
    });
});

describe('parseGrade', () => {
    test('plain, padded and blank', () => {
        assert.deepEqual(GF.parseGrade('1.75'), { points: 1.75 });
        assert.deepEqual(GF.parseGrade(' 2 '), { points: 2 });
        assert.deepEqual(GF.parseGrade(''), { points: null });
        assert.deepEqual(GF.parseGrade('-'), { points: null });
    });
    test('a comma decimal is 1.75, not 1', () => {
        assert.deepEqual(GF.parseGrade('1,75'), { points: 1.75 });
    });
    test('out of range and junk are errors', () => {
        assert.ok(GF.parseGrade('6').error);
        assert.ok(GF.parseGrade('0.5').error);
        assert.ok(GF.parseGrade('1.75abc').error);
        assert.ok(GF.parseGrade('INC').error);
    });
    test('dropped spellings set the status', () => {
        assert.equal(GF.parseGrade('DRP').status, 'DROPPED');
        assert.equal(GF.parseGrade('w').status, 'DROPPED');
    });
});

describe('normStatus', () => {
    test('common spellings', () => {
        assert.equal(GF.normStatus('Pass'), 'PASSED');
        assert.equal(GF.normStatus('failed'), 'FAILED');
        assert.equal(GF.normStatus('Drop'), 'DROPPED');
        assert.equal(GF.normStatus('In Progress'), 'ENROLLED');
        assert.equal(GF.normStatus(''), '');
    });
    test('unknown text comes back upper-cased for reporting', () => {
        assert.equal(GF.normStatus('Honors'), 'HONORS');
    });
});

describe('parseTerm and parseYear', () => {
    test('terms', () => {
        assert.equal(GF.parseTerm('1', 9), 1);
        assert.equal(GF.parseTerm('1st Sem', 9), 1);
        assert.equal(GF.parseTerm('2nd Semester', 9), 2);
        assert.equal(GF.parseTerm('Sem 2', 9), 2);
        assert.equal(GF.parseTerm('First', 9), 1);
        assert.equal(GF.parseTerm('Summer', 9), 3);
        assert.equal(GF.parseTerm('', 9), 9);
        assert.ok(Number.isNaN(GF.parseTerm('Fall', 9)));
    });
    test('years', () => {
        assert.equal(GF.parseYear('2025', 1), 2025);
        assert.equal(GF.parseYear('2025-2026', 1), 2025);
        assert.equal(GF.parseYear('AY 2025-2026', 1), 2025);
        assert.equal(GF.parseYear('S.Y. 2025–26', 1), 2025);
        assert.equal(GF.parseYear('', 2024), 2024);
        assert.ok(Number.isNaN(GF.parseYear('last year', 1)));
    });
});

describe('nameMatches', () => {
    test('order, commas, middle initials and accents do not matter', () => {
        assert.ok(GF.nameMatches('Villanueva, Althea', 'Althea', 'Villanueva'));
        assert.ok(GF.nameMatches('Althea M. Villanueva', 'Althea', 'Villanueva'));
        assert.ok(GF.nameMatches('ALTHEA VILLANUEVA', 'Althea', 'Villanueva'));
        assert.ok(GF.nameMatches('Peña, José', 'Jose', 'Pena'));
    });
    test('a blank name matches', () => {
        assert.ok(GF.nameMatches('', 'Althea', 'Villanueva'));
    });
    test('a different person does not', () => {
        assert.ok(!GF.nameMatches('Marco Deveza', 'Althea', 'Villanueva'));
    });
});

// ---- class lists: the subject is chosen on the page, not written on each row ----

describe('class list (no subject column)', () => {
    // A class record the way a teacher prints it: a title, then ID, name, grade.
    const classList = [{
        name: 'Sheet1',
        aoa: [
            ['CC-INTCOM11 - Introduction to Computing'],
            [],
            ['Student No', 'Student Name', 'Final Grade'],
            ['2401187', 'Athena Po', '1.75'],
            ['2411400', 'Rachel New', '2.25'],
        ],
    }];

    test('without a chosen subject, the sheet is not accepted', () => {
        assert.equal(GF.pickSheet(classList), null);
    });

    test('with a chosen subject, the class list is accepted and its rows read', () => {
        const picked = GF.pickSheet(classList, { subjectChosen: true });
        assert.equal(picked.headerIdx, 2);
        const rows = GF.readRows(picked);
        assert.equal(rows.length, 2);
        assert.equal(rows[0].student_id, '2401187');
        assert.equal(rows[0].grade, '1.75');
        assert.equal(rows[0].subject_code, '', 'the page supplies the subject, not the row');
        assert.equal(rows[0].__line, 4);
    });

    test('a file that does have a subject column reads as it always did', () => {
        const withSubject = [{ name: 'S', aoa: [['student_id', 'subject_code', 'grade'], ['2401187', 'X1', '2']] }];
        assert.equal(GF.pickSheet(withSubject, { subjectChosen: true }).columns.includes('subject_code'), true);
        assert.equal(GF.pickSheet(withSubject).dataRows, 1);
    });

    test('a list with an ID but nothing grade-like is not mistaken for a grade table', () => {
        const idsOnly = [{ name: 'S', aoa: [['ID', 'Room', 'Seat'], ['2401187', 'R1', '4']] }];
        assert.equal(GF.pickSheet(idsOnly, { subjectChosen: true }), null);
    });

    test('the class list wins on the sheet that has the subject, if another sheet has none', () => {
        const mixed = [
            { name: 'Class list', aoa: [['student_id', 'student_name', 'grade'], ['1', 'A B', '2'], ['2', 'C D', '2'], ['3', 'E F', '2']] },
            { name: 'Grades', aoa: [['student_id', 'subject_code', 'grade'], ['2401187', 'X1', '2']] },
        ];
        assert.equal(GF.pickSheet(mixed, { subjectChosen: true }).name, 'Grades');
    });
});

describe('classListRows', () => {
    const subject = { code: 'CC-INTCOM11' };

    test('a header, then one row per student with the grade left blank', () => {
        const rows = GF.classListRows(subject, [
            { student_id: '2401187', first_name: 'Athena', last_name: 'Po' },
        ]);
        assert.deepEqual(rows[0], ['student_id', 'student_name', 'subject_code', 'grade', 'status']);
        assert.deepEqual(rows[1], ['2401187', 'Athena Po', 'CC-INTCOM11', '', '']);
    });

    test('sorted by last name, then first name', () => {
        const rows = GF.classListRows(subject, [
            { student_id: '3', first_name: 'Zed', last_name: 'Reyes' },
            { student_id: '1', first_name: 'Ana', last_name: 'Reyes' },
            { student_id: '2', first_name: 'Bea', last_name: 'Abad' },
        ]);
        assert.deepEqual(rows.slice(1).map(r => r[0]), ['2', '1', '3']);
    });

    test('a student listed twice appears once', () => {
        const rows = GF.classListRows(subject, [
            { student_id: '1', first_name: 'A', last_name: 'B' },
            { student_id: '1', first_name: 'A', last_name: 'B' },
        ]);
        assert.equal(rows.length, 2);
    });

    test('nobody enrolled still gives a usable header', () => {
        assert.equal(GF.classListRows(subject, []).length, 1);
        assert.equal(GF.classListRows(subject, null).length, 1);
    });

    test('the sheet it makes is read back by the upload', () => {
        const aoa = GF.classListRows(subject, [{ student_id: '2401187', first_name: 'Athena', last_name: 'Po' }]);
        const picked = GF.pickSheet([{ name: 'S', aoa }]);
        assert.equal(GF.readRows(picked)[0].subject_code, 'CC-INTCOM11');
    });
});

// ---- re-uploading: what is already recorded ----

describe('compareWithRecords', () => {
    const row = (over = {}) => ({
        student: { id: 'S1' }, subject: { id: 7 }, term: 1, academic_year: 2023,
        grade_points: 1.75, status: 'PASSED', ...over,
    });
    const rec = (over = {}) => ({
        student_id: 'S1', subject_id: 7, taken_term: 1, taken_year: 2023,
        grade_points: 1.75, status: 'PASSED', ...over,
    });

    test('nothing recorded for the attempt: new', () => {
        const [r] = GF.compareWithRecords([row()], []);
        assert.equal(r.change, 'new');
        assert.equal(r.prev, undefined);
    });

    test('recorded exactly as the file says: unchanged, so a re-upload saves nothing', () => {
        const [r] = GF.compareWithRecords([row()], [rec()]);
        assert.equal(r.change, 'unchanged');
    });

    test('a different grade for the same attempt is a correction and remembers the old one', () => {
        const [r] = GF.compareWithRecords([row({ grade_points: 2.0 })], [rec()]);
        assert.equal(r.change, 'changed');
        assert.deepEqual(r.prev, { grade_points: 1.75, status: 'PASSED' });
    });

    test('a different status is a correction too', () => {
        const [r] = GF.compareWithRecords([row({ status: 'DROPPED', grade_points: null })], [rec()]);
        assert.equal(r.change, 'changed');
    });

    test('the database hands numbers back as text and that still counts as the same grade', () => {
        const [r] = GF.compareWithRecords([row()], [rec({ grade_points: '1.75' })]);
        assert.equal(r.change, 'unchanged');
    });

    test('no grade yet on both sides is unchanged', () => {
        const [r] = GF.compareWithRecords(
            [row({ grade_points: null, status: 'ENROLLED' })],
            [rec({ grade_points: null, status: 'ENROLLED' })]);
        assert.equal(r.change, 'unchanged');
    });

    test('a retake in another term is a new attempt, not a correction', () => {
        const [r] = GF.compareWithRecords([row({ term: 2 })], [rec()]);
        assert.equal(r.change, 'new');
    });

    test('another student or subject is a different attempt', () => {
        assert.equal(GF.compareWithRecords([row({ student: { id: 'S2' } })], [rec()])[0].change, 'new');
        assert.equal(GF.compareWithRecords([row({ subject: { id: 8 } })], [rec()])[0].change, 'new');
    });

    test('every row is judged on its own', () => {
        const out = GF.compareWithRecords(
            [row(), row({ subject: { id: 8 } }), row({ subject: { id: 9 }, grade_points: 3 })],
            [rec(), rec({ subject_id: 9 })]);
        assert.deepEqual(out.map(r => r.change), ['unchanged', 'new', 'changed']);
    });
});

describe('summarizeChanges', () => {
    test('counts each kind and how many would actually be written', () => {
        const s = GF.summarizeChanges([
            { change: 'new' }, { change: 'new' }, { change: 'changed' }, { change: 'unchanged' },
        ]);
        assert.deepEqual(s, { new: 2, changed: 1, unchanged: 1, toSave: 3 });
    });
    test('a file uploaded twice has nothing to save', () => {
        assert.equal(GF.summarizeChanges([{ change: 'unchanged' }, { change: 'unchanged' }]).toSave, 0);
    });
    test('no rows', () => {
        assert.deepEqual(GF.summarizeChanges([]), { new: 0, changed: 0, unchanged: 0, toSave: 0 });
    });
});

describe('attemptKey', () => {
    test('the same student, subject, term and year always give the same key', () => {
        assert.equal(GF.attemptKey('S1', 7, 1, 2023), GF.attemptKey('S1', 7, 1, 2023));
        assert.notEqual(GF.attemptKey('S1', 7, 1, 2023), GF.attemptKey('S1', 7, 2, 2023));
    });
});

// ---- a new grade for a subject the student already passed ----

describe('flagRepeats', () => {
    const row = (over = {}) => ({
        student: { id: 'S1' }, subject: { id: 7 }, term: 1, academic_year: 2024,
        grade_points: 1.5, status: 'PASSED', change: 'new', ...over,
    });
    const saved = (over = {}) => ({
        student_id: 'S1', subject_id: 7, taken_term: 1, taken_year: 2023,
        grade_points: '1.50', status: 'PASSED', ...over,
    });

    test('a new attempt at a subject already passed is flagged, with when and how', () => {
        const [r] = GF.flagRepeats([row()], [saved()]);
        assert.deepEqual(r.repeat, { year: 2023, term: 1, grade_points: 1.5 });
    });

    test('a retake of a FAILED subject is normal and not flagged', () => {
        const [r] = GF.flagRepeats([row()], [saved({ status: 'FAILED', grade_points: '5.00' })]);
        assert.equal(r.repeat, undefined);
    });

    test('a dropped or still-enrolled earlier attempt is not a pass', () => {
        assert.equal(GF.flagRepeats([row()], [saved({ status: 'DROPPED' })])[0].repeat, undefined);
        assert.equal(GF.flagRepeats([row()], [saved({ status: 'ENROLLED', grade_points: null })])[0].repeat, undefined);
    });

    test('a correction or an already-recorded row is not flagged: it is not a new attempt', () => {
        assert.equal(GF.flagRepeats([row({ change: 'changed' })], [saved()])[0].repeat, undefined);
        assert.equal(GF.flagRepeats([row({ change: 'unchanged' })], [saved()])[0].repeat, undefined);
    });

    test('another student or another subject is not a repeat', () => {
        assert.equal(GF.flagRepeats([row({ student: { id: 'S2' } })], [saved()])[0].repeat, undefined);
        assert.equal(GF.flagRepeats([row({ subject: { id: 8 } })], [saved()])[0].repeat, undefined);
    });

    test('with several earlier passes the most recent one is named', () => {
        const [r] = GF.flagRepeats([row({ academic_year: 2026 })], [
            saved({ taken_year: 2021 }), saved({ taken_year: 2024, taken_term: 2, grade_points: '2.00' }), saved({ taken_year: 2023 }),
        ]);
        assert.deepEqual(r.repeat, { year: 2024, term: 2, grade_points: 2 });
    });

    test('a row that is only flagged is still an ordinary new row', () => {
        const [r] = GF.flagRepeats([row()], [saved()]);
        assert.equal(r.change, 'new');
        assert.equal(GF.summarizeChanges([r]).toSave, 1);
    });

    test('works on the output of compareWithRecords', () => {
        const rows = [{ student: { id: 'S1' }, subject: { id: 7 }, term: 1, academic_year: 2024, grade_points: 1.5, status: 'PASSED' }];
        const existing = [saved()];
        const [r] = GF.flagRepeats(GF.compareWithRecords(rows, existing), existing);
        assert.equal(r.change, 'new');
        assert.equal(r.repeat.year, 2023);
    });
});
