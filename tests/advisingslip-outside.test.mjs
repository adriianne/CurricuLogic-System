// advisingslip-outside.test.mjs
// The enrolment advising slip lists every subject the adviser approved, even one that is not in the printed
// semester (shared/js/enrolment/advisingslip.js). Found 29 Oct 2026: Athena's plan (STS 101 and LIT 101, taken from other
// year levels) printed a first-year semester with no "Approved" mark at all.
//
//   node --test tests/advisingslip-outside.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Slip = require('../shared/js/enrolment/advisingslip.js');

let id = 100;
const subj = (code, year, term, o = {}) => ({
    id: id++, code, title: o.title ?? `${code} title`, units: o.units ?? 3,
    lec_units: o.lec ?? 3, lab_units: o.lab ?? 0, year_level: year, term, is_elective: false, is_active: true,
});

// A first-year, first-semester curriculum, as Athena's slip showed it.
const ENTREP = subj('ENTREP 101', 1, 1);
const MATH = subj('MATH 101', 1, 1);
const PE = subj('PE 101', 1, 1, { units: 2, lec: 2 });
const STS_SECOND_YEAR = subj('STS 101', 2, 2);          // taken from another year level
const curriculum = [ENTREP, MATH, PE, STS_SECOND_YEAR];
const current = { number: 1, year: 2023 };

const student = { first_name: 'Athena', last_name: 'Po', student_id: '2401187', year_level: 1 };
const item = (code, over = {}) => ({ id: 9000 + id++, code, title: `${code} title`, units: 3, lec: 3, lab: 0, section: '', note: '', ...over });

const html = (over = {}) => Slip.html({
    student, subjects: curriculum, rules: [], records: [], term: current, adviser: 'Jay Darga',
    program: { name: 'BS Information Technology', code: 'BSIT', college: 'College of Computer Studies' }, ref: 'CL-2026-000021',
    ...over,
});

const STS = item('STS 101', { title: 'Science, Technology & Society', section: 'BSIT-2B · MW · 10:00–11:30' });
const LIT = item('LIT 101', { title: 'Literatures of the World', section: 'BSIT-4B · MW · 08:00–09:30' });

describe('approved subjects outside the printed semester (the Athena case)', () => {
    test('they are listed in their own block, with title, units and section', () => {
        const h = html({ approvedItems: [STS, LIT] });
        assert.match(h, /APPROVED SUBJECTS OUTSIDE THIS SEMESTER/);
        for (const text of ['STS 101', 'Science, Technology &amp; Society', 'BSIT-2B · MW · 10:00–11:30', 'LIT 101', 'BSIT-4B · MW · 08:00–09:30']) {
            assert.ok(h.includes(text), `${text} is on the slip`);
        }
        assert.match(h, /Units approved on this plan: <strong>6<\/strong>/);
    });

    test('each one is marked Approved', () => {
        const h = html({ approvedItems: [STS, LIT] });
        const block = h.slice(h.indexOf('APPROVED SUBJECTS OUTSIDE'));
        assert.equal((block.match(/<strong>Approved<\/strong>/g) ?? []).length, 2);
    });

    test('the semester block is unchanged and still has no Approved mark when none of its subjects was approved', () => {
        const h = html({ approvedItems: [STS, LIT] });
        const main = h.slice(0, h.indexOf('APPROVED SUBJECTS OUTSIDE'));
        for (const code of ['ENTREP 101', 'MATH 101', 'PE 101']) assert.ok(main.includes(code));
        assert.doesNotMatch(main, /<strong>Approved<\/strong>/);
        assert.match(main, /Total units<\/td><td class="n">8<\/td>/);
    });

    test('the reference is still printed under the term', () => {
        assert.match(html({ approvedItems: [STS, LIT] }), /Ref\. <strong>CL-2026-000021<\/strong>/);
    });

    test('a subject with no section posted shows a dash, and a note is printed under Approved', () => {
        const h = html({ approvedItems: [item('LIT 101', { section: '', note: 'See me first' })] });
        assert.match(h, /<td class="req"><span class="ln none-dash">—<\/span><\/td>/);
        assert.match(h, /<span class="note">See me first<\/span>/);
    });

    test('what a person typed cannot break the page', () => {
        const h = html({ approvedItems: [item('X <b>1', { title: '<script>alert(1)</script>', section: '"><img src=x>', note: '<i>hi</i>' })] });
        assert.ok(!h.includes('<script>alert(1)'));
        assert.ok(!h.includes('<img src=x>'));
        assert.ok(!h.includes('<i>hi</i>'));
    });
});

describe('approved subjects that ARE in the printed semester', () => {
    test('they are marked in the semester block and are not repeated outside it (matched by id)', () => {
        const h = html({ approvedItems: [item('MATH 101', { id: MATH.id })] });
        assert.doesNotMatch(h, /APPROVED SUBJECTS OUTSIDE THIS SEMESTER/);
        assert.equal((h.match(/<strong>Approved<\/strong>/g) ?? []).length, 1);
    });

    test('a plan written against another version of the curriculum is matched by code, whatever its letter case', () => {
        const h = html({ approvedItems: [item(' math 101 ', { id: 987654 })] });
        assert.doesNotMatch(h, /APPROVED SUBJECTS OUTSIDE THIS SEMESTER/);
        assert.match(h, /<td class="rem"><strong>Approved<\/strong><\/td>/);
    });

    test('a note given with a code-matched approval is printed in the semester block', () => {
        const h = html({ approvedItems: [item('PE 101', { id: 555, note: 'Bring the form' })] });
        assert.match(h, /<td class="rem"><strong>Approved<\/strong><span class="note">Bring the form<\/span><\/td>/);
    });
});

describe('a plan with both kinds', () => {
    const h = html({ approvedItems: [item('MATH 101', { id: MATH.id }), LIT] });

    test('the semester subject is marked, the outside one is listed, nothing is lost', () => {
        const main = h.slice(0, h.indexOf('APPROVED SUBJECTS OUTSIDE'));
        const outside = h.slice(h.indexOf('APPROVED SUBJECTS OUTSIDE'));
        assert.equal((main.match(/<strong>Approved<\/strong>/g) ?? []).length, 1);
        assert.ok(outside.includes('LIT 101'));
        assert.ok(!outside.includes('MATH 101'));
    });

    test('the total is the approved units of both: 3 in the semester and 3 outside', () => {
        assert.match(h, /Units approved on this plan: <strong>6<\/strong>/);
        assert.match(h, /Total units<\/td><td class="n">3<\/td><td colspan="2"><\/td>/);   // the outside block's own total
    });
});

describe('when there is nothing to add', () => {
    test('with no approved list, the slip is as it always was', () => {
        const h = html();
        assert.doesNotMatch(h, /APPROVED SUBJECTS OUTSIDE/);
        assert.doesNotMatch(h, /Units approved on this plan/);
    });

    test('an empty approved list adds nothing', () => {
        assert.doesNotMatch(html({ approvedItems: [] }), /APPROVED SUBJECTS OUTSIDE/);
    });

    test('with no year level every approved subject is listed, so the form is never blank of them', () => {
        const h = html({ student: { ...student, year_level: null }, approvedItems: [STS, LIT] });
        assert.match(h, /year level is not set/);
        assert.match(h, /APPROVED SUBJECTS OUTSIDE THIS SEMESTER/);
        assert.ok(h.includes('STS 101') && h.includes('LIT 101'));
    });
});

describe('outsideSemester', () => {
    const rows = [{ code: 'ENTREP 101' }, { code: 'MATH 101' }];

    test('keeps the order the adviser approved them in, and ignores letter case and spaces', () => {
        const out = Slip.outsideSemester(rows, [{ code: 'zzz 1' }, { code: ' math 101' }, { code: 'AAA 2' }]);
        assert.deepEqual(out.map(i => i.code), ['zzz 1', 'AAA 2']);
    });

    test('an item with no code, a missing list or no rows never throws', () => {
        assert.deepEqual(Slip.outsideSemester(rows, [null, {}, { code: '' }]), []);
        assert.deepEqual(Slip.outsideSemester(rows, undefined), []);
        assert.deepEqual(Slip.outsideSemester(undefined, [{ code: 'A 1' }]).map(i => i.code), ['A 1']);
    });
});

describe('semesterRows marks by approvedItems too', () => {
    test('by id and by code, with the item\'s note', () => {
        const rows = Slip.semesterRows({
            subjects: curriculum, rules: [], records: [], yearLevel: 1, term: current,
            approvedItems: [{ id: ENTREP.id, code: 'ENTREP 101', note: 'ok' }, { id: 1, code: 'math 101', note: '' }],
        });
        assert.deepEqual(rows.map(r => r.approved), [true, true, false]);
        assert.equal(rows[0].note, 'ok');
    });
});
