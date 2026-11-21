// samecurriculum.test.mjs
// One curriculum per programme and year (db/130), and the same subjects under another year are refused (21 Nov 2026).
//
//   node --test tests/samecurriculum.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../shared/js/curriculum/samecurriculum.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const builder = read('features/department/curriculum-builder.js');

const s = (code, year = 1, term = 1, lec = 3, lab = 0) => ({ code, year, term, lec, lab });
const set = (n) => Array.from({ length: n }, (_, i) => s(`SUBJ${100 + i}`, 1 + (i % 4), 1 + (i % 2)));

describe('compare', () => {
    test('the same subjects are identical, in any order', () => {
        const a = set(20);
        const r = S.compare(a, [...a].reverse());
        assert.equal(r.identical, true);
        assert.equal(r.similarity, 1);
        assert.equal(r.differing, 0);
    });
    test('codes are compared by letters and digits only: ENGL 101, engl-101 and ENGL101 are one subject', () => {
        assert.equal(S.compare([s('ENGL 101')], [s('engl-101')]).identical, true);
        assert.equal(S.compare([s('ENGL 101')], [s('ENGL101')]).identical, true);
    });
    test('titles and prerequisites are not part of it', () => {
        assert.equal(S.compare([{ ...s('A1'), title: 'One' }], [{ ...s('A1'), title: 'Uno', prereqs: ['X'] }]).identical, true);
    });
    test('one subject moved to another semester, or with different units, is a difference', () => {
        assert.equal(S.compare([s('A1', 1, 1)], [s('A1', 1, 2)]).identical, false);
        assert.equal(S.compare([s('A1', 1, 1, 3, 0)], [s('A1', 1, 1, 2, 1)]).identical, false);
        assert.equal(S.compare([s('A1', 1, 1)], [s('A1', 2, 1)]).identical, false);
    });
    test('one extra subject is not identical, and is counted as one difference', () => {
        const a = set(20);
        const r = S.compare(a, [...a, s('EXTRA1')]);
        assert.equal(r.identical, false);
        assert.equal(r.differing, 1);
        assert.ok(r.similarity > 0.95 && r.similarity < 1);
    });
    test('null units count as zero, and electives with no year or semester compare by their code', () => {
        assert.equal(S.compare([s('EL1', null, null, null, null)], [s('EL1', null, null, 0, 0)]).identical, true);
    });
    test('an empty list is never identical to anything, and garbage does not crash', () => {
        assert.equal(S.compare([], []).identical, false);
        assert.equal(S.compare(null, undefined).identical, false);
        assert.equal(S.compare([{}, { code: '' }], [{}]).identical, false);
    });
    test('db rows and builder rows read into the same shape', () => {
        const db = { code: 'CC-X1', year_level: 2, term: 1, lec_units: '2', lab_units: '1' };
        assert.equal(S.compare([S.fromDbRow(db)], [S.fromBuilderRow({ code: 'cc x1', year: 2, term: 1, lec: 2, lab: 1 })]).identical, true);
    });
});

describe('findSame', () => {
    const v = (year, active = false) => ({ id: year, academic_year: year, is_active: active });
    test('lists identical and near versions, most alike first, and leaves different ones out', () => {
        const mine = set(40);
        const near = [...mine.slice(0, 39), s('OTHER1')];
        const r = S.findSame(mine, [
            { version: v(2020), subjects: set(40).map((x, i) => s(`ZZ${i}`)) },
            { version: v(2023), subjects: near },
            { version: v(2024, true), subjects: [...mine] },
        ]);
        assert.deepEqual(r.map((x) => x.version.academic_year), [2024, 2023]);
        assert.equal(r[0].result.identical, true);
        assert.equal(r[1].result.identical, false);
    });
    test('a stub (an empty or tiny draft) is never a match', () => {
        const r = S.findSame(set(4), [{ version: v(2024), subjects: set(4) }, { version: v(2025), subjects: [] }]);
        assert.equal(r.length, 0);
    });
    test('below 90 percent alike is not reported', () => {
        const mine = set(20);
        const r = S.findSame(mine, [{ version: v(2023), subjects: [...mine.slice(0, 17), s('N1'), s('N2'), s('N3')] }]);   // 17 of 20 alike: 85 percent
        assert.equal(r.length, 0);
    });
    test('garbage in gives nothing', () => {
        assert.deepEqual(S.findSame(set(10), null), []);
        assert.deepEqual(S.findSame(set(10), [null, {}, { version: v(1), subjects: 'x' }]), []);
    });
});

describe('the builder uses it', () => {
    test('Create reads the other versions together with the codes, and the check gets both', () => {
        assert.ok(builder.includes('const [taken, others, elsewhere] = await Promise.all([existingCodes(), otherVersions(), otherProgrammes()]);'));
        assert.ok(builder.includes('confirmCreate(preflight(taken, others, elsewhere));'));
    });
    test('only OTHER versions are compared, and only their live subjects', () => {
        const fn = builder.slice(builder.indexOf('async function otherVersions'), builder.indexOf('function yearTaken'));
        assert.ok(fn.includes('v.id !== OPTS.prospectusId'));
        assert.ok(fn.includes(".eq('is_active', true)"));
        assert.ok(fn.includes('return null;'), 'a failed read is "could not check", never "no match"');
    });
    test('an identical set is a blocker that names the year and points to the copy action; a near one is only a warning', () => {
        const pf = builder.slice(builder.indexOf('function preflight'), builder.indexOf('const years = [1, 2, 3, 4]'));
        assert.match(pf, /if \(result\.identical\) \{\s+blockers\.push\(/);
        assert.ok(pf.includes('This is the same curriculum as ${label}'));
        assert.ok(pf.includes('New version (copy)'));
        assert.match(pf, /warnings\.push\(\s+`\$\{Math\.round\(result\.similarity \* 100\)\}% the same as/);
        assert.ok(pf.includes('Could not compare this with the programme'));
    });
    test('a database one-per-year refusal is explained in plain words at every place a year is created', () => {
        assert.equal((builder.match(/yearTaken\(/g) || []).length, 4);          // the definition and three uses
        assert.ok(read('features/department/departmentdashboard.js').includes('prospectus_program_year_key'));
    });
    test('the page loads the module before the builder', () => {
        const html = read('features/department/departmentdashboard.html');
        assert.ok(html.indexOf('samecurriculum.js') > 0);
        assert.ok(html.indexOf('samecurriculum.js') < html.indexOf('curriculum-builder.js'));
    });
});

describe('db/130', () => {
    const sql = read('db/130_prospectus_one_per_year.sql');
    test('a unique index on programme and year', () => {
        assert.match(sql, /create unique index if not exists prospectus_program_year_key\s+on public\.prospectus \(program_id, academic_year\);/);
    });
});
