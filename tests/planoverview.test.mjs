// planoverview.test.mjs
// The "Overview" under a request: passed subjects mapped to requested ones (shared/js/enrolment/planoverview.js).
// Runs against the REAL engine, so the map cannot draw a rule differently from the system.
//
//   node --test tests/planoverview.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PO = require('../shared/js/enrolment/planoverview.js');
const SC = require('../shared/js/enrolment/systemcheck.js');
const engine = require('../shared/engine/engine.js');
const clash = require('../shared/js/schedule/scheduleconflicts.js').meetingsClash;
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// A small curriculum.
const subjects = [
    { id: 1, code: 'IT 111',   title: 'Intro to Computing',   units: 3, year_level: 1, term: 1 },
    { id: 2, code: 'IT 121',   title: 'Computer Programming 2', units: 3, year_level: 1, term: 2 },
    { id: 3, code: 'MATH 100', title: 'College Math',         units: 3, year_level: 1, term: 1 },
    { id: 4, code: 'MATH 101', title: 'Math in the Modern World', units: 3, year_level: 1, term: 2 },
    { id: 5, code: 'PE 101',   title: 'Physical Fitness',     units: 2, year_level: 1, term: 1 },
    { id: 6, code: 'STAT 1',   title: 'Statistics',           units: 3, year_level: 2, term: 1 },
    { id: 7, code: 'IT 201',   title: 'Data Structures',      units: 3, year_level: 2, term: 1 },
    { id: 8, code: 'IT 201L',  title: 'Data Structures Lab',  units: 1, year_level: 2, term: 1 },
    { id: 9, code: 'CAPSTONE', title: 'Capstone',             units: 3, year_level: 3, term: 1 },
];
const rules = [
    { subject_id: 2, prerequisite_subject_id: 1, requirement_type: 'prerequisite', rule_type: 'and', rule_group: 1 },
    { subject_id: 4, prerequisite_subject_id: 3, requirement_type: 'prerequisite', rule_type: 'and', rule_group: 1 },
    { subject_id: 6, prerequisite_subject_id: 3, requirement_type: 'prerequisite', rule_type: 'and', rule_group: 1 },   // any of MATH 100 / MATH 101
    { subject_id: 6, prerequisite_subject_id: 4, requirement_type: 'prerequisite', rule_type: 'and', rule_group: 1 },
    { subject_id: 7, prerequisite_subject_id: 2, requirement_type: 'prerequisite', rule_type: 'and', rule_group: 1 },   // needs IT 121 and MATH 101
    { subject_id: 7, prerequisite_subject_id: 4, requirement_type: 'prerequisite', rule_type: 'and', rule_group: 2 },
    { subject_id: 8, prerequisite_subject_id: 7, requirement_type: 'co_requisite',  rule_type: 'and', rule_group: 1 },
    { subject_id: 9, prerequisite_subject_id: null, requirement_type: 'standing', rule_type: 'and', rule_group: 1, threshold_value: 22 },
];
const kb = { subjects, rules, offerings: [] };

const rec = (subject_id, status, grade, taken_term, taken_year) => ({ subject_id, status, grade, taken_term, taken_year });
const item = (id, subject_id, status, remarks, offering) => {
    const s = subjects.find(x => x.id === subject_id);
    return { id, subject_id, status, remarks, subject: { code: s.code, title: s.title, units: s.units }, offering: offering || null };
};
const sched = (days, a, b, section = 'BSIT-1A') => ({ schedule_days: days, start_time: a, end_time: b, section });

function model(items, records, request = { term: 1, year: 2023 }) {
    const undecided = items.filter(i => i.status !== 'approved' && i.status !== 'rejected');
    return PO.build({ items, records, kb, engine, blocked: SC.blocked(items, clash), pairs: SC.clashPairs(undecided, clash), request, yearLevel: 1 });
}

describe('a requested subject whose prerequisite is passed', () => {
    const m = model([item(1, 2, 'valid', null)], [rec(1, 'PASSED', '1.75', 1, 2024)]);
    test('draws the passed subject with its grade and semester, linked to the requested one', () => {
        const node = m.rows[0].groups[0].nodes[0];
        assert.equal(node.code, 'IT 111');
        assert.equal(node.state, 'passed');
        assert.equal(node.grade, '1.75');
        assert.equal(node.when, '1st Sem 2024');
    });
    test('the note says good to take, and which semester it counts for', () => {
        const n = m.rows[0].note;
        assert.equal(n.kind, 'good');
        assert.equal(n.title, 'Good to take this semester');
        assert.equal(n.counts, 'Counts for 1st Sem 2023');
        assert.match(n.text, /IT 111 passed/);
    });
    test('the drawing shows the passed subject on top and the requested one below it, on a connector, with the note', () => {
        const h = PO.html(m);
        assert.match(h, /IT 111<\/div>|IT 111 <span/);
        assert.match(h, /Passed · 1\.75 · 1st Sem 2024/);
        assert.match(h, /Good to take this semester/);
        assert.match(h, /Counts for 1st Sem 2023/);
        assert.match(h, /class="po-to has-link"/);
        assert.match(h, /Requested for 1st Sem 2023/);
        // top to bottom: the passed subject comes before the requested one in each row
        assert.ok(h.indexOf('class="po-from"') < h.indexOf('class="po-to has-link"'));
        assert.ok(h.indexOf('IT 111') < h.indexOf('IT 121'));
        assert.doesNotMatch(h, /po-arrow|po-cols/);
    });
});

describe('a requested subject with no prerequisite', () => {
    const m = model([item(1, 5, 'valid', null)], []);
    test('says so and is good to take', () => {
        assert.equal(m.rows[0].note.kind, 'good');
        assert.equal(m.rows[0].note.text, 'No prerequisite.');
        assert.match(PO.html(m), /No prerequisite<\/div>/);
        assert.match(PO.html(m), /class="po-to has-link is-none"/);
    });
});

describe('a requested subject whose prerequisite is not passed', () => {
    test('the flag the system gave is shown, with the missing subject drawn as not passed', () => {
        const m = model([item(1, 2, 'flagged', 'IT 111 must be passed first.')], []);
        const node = m.rows[0].groups[0].nodes[0];
        assert.equal(node.state, 'missing');
        const n = m.rows[0].note;
        assert.equal(n.kind, 'warn');
        assert.equal(n.title, 'Needs attention');
        assert.equal(n.text, 'IT 111 must be passed first.');
        assert.equal(n.stop, 'Cannot be approved: reject it');
        const h = PO.html(m);
        assert.match(h, /Not passed yet/);
        assert.match(h, /class="po-to has-link is-broken"/);
        assert.match(h, /po-link-label">missing</);
        assert.match(h, /Cannot be approved: reject it/);
    });
    test('a failed prerequisite says it must be retaken, with the failing grade', () => {
        const m = model([item(1, 2, 'flagged', 'IT 111 was not passed. It must be retaken.')], [rec(1, 'FAILED', '3.25', 2, 2024)]);
        const node = m.rows[0].groups[0].nodes[0];
        assert.equal(node.state, 'failed');
        assert.match(PO.html(m), /Failed · 3\.25 · 2nd Sem 2024 · must be retaken/);
    });
    test('a prerequisite still in progress says it must be passed first', () => {
        const m = model([item(1, 2, 'flagged', 'IT 111 is in progress.')], [rec(1, 'ENROLLED', null, 1, 2026)]);
        assert.equal(m.rows[0].groups[0].nodes[0].state, 'inprogress');
        assert.match(PO.html(m), /In progress · 1st Sem 2026 · must be passed first/);
    });
});

describe('the same verdict as the System check note', () => {
    test('a subject in a schedule clash shows needs attention, and a clash strip names both', () => {
        const items = [
            item(1, 4, 'valid', null, sched('MW', '10:00:00', '11:30:00')),
            item(2, 5, 'valid', null, sched('MW', '11:00:00', '12:30:00')),
        ];
        const m = model(items, [rec(3, 'PASSED', '2.00', 1, 2024)]);
        for (const r of m.rows) {
            assert.equal(r.note.kind, 'warn');
            assert.equal(r.note.stop, 'Cannot be approved until one of them is rejected');
        }
        assert.match(m.rows[0].note.text, /Schedule clash with PE 101/);
        assert.equal(m.pairs.length, 1);
        assert.match(PO.html(m), /Schedule clash: <strong>MATH 101<\/strong> ⟷ <strong>PE 101<\/strong>/);
    });
    test('rejecting one of the two clashing subjects frees the other to be good to take', () => {
        const items = [
            item(1, 4, 'valid', null, sched('MW', '10:00:00', '11:30:00')),
            item(2, 5, 'rejected', 'This section clashes.', sched('MW', '11:00:00', '12:30:00')),
        ];
        const m = model(items, [rec(3, 'PASSED', '2.00', 1, 2024)]);
        assert.equal(m.rows[0].note.kind, 'good');
        assert.equal(m.rows[1].note.kind, 'bad');
        assert.equal(m.rows[1].note.text, 'This section clashes.');
        assert.equal(m.pairs.length, 0);
    });
    test('a plan the system calls all passed shows no warning anywhere on the map', () => {
        const items = [item(1, 2, 'valid', null), item(2, 4, 'valid', null), item(3, 5, 'valid', null)];
        const m = model(items, [rec(1, 'PASSED', '1.75', 1, 2024), rec(3, 'PASSED', '2.00', 1, 2024)]);
        assert.match(SC.noteHtml(items.map(i => ({ ...i, offering: null })), clash), /all passed/);
        assert.deepEqual(m.rows.map(r => r.note.kind), ['good', 'good', 'good']);
    });
    test('if the record changed after submission, the map warns instead of showing a green note', () => {
        const m = model([item(1, 2, 'valid', null)], []);     // submitted as valid, but IT 111 is no longer passed
        assert.equal(m.rows[0].note.kind, 'warn');
        assert.match(m.rows[0].note.text, /Requirements are no longer met/);
    });
});

describe('the rules the engine knows', () => {
    test('"any one of": both choices are drawn, and passing one is enough', () => {
        const m = model([item(1, 6, 'valid', null)], [rec(3, 'PASSED', '2.00', 1, 2024)]);
        const g = m.rows[0].groups[0];
        assert.equal(g.kind, 'any_of');
        assert.deepEqual(g.nodes.map(n => n.state), ['passed', 'missing']);
        assert.equal(m.rows[0].note.kind, 'good');
        assert.match(PO.html(m), /any one of/);
    });
    test('"and": two groups are drawn, and both must be met', () => {
        const m = model([item(1, 7, 'valid', null)], [rec(2, 'PASSED', '2.00', 2, 2024)]);   // IT 121 passed, MATH 101 not
        assert.equal(m.rows[0].groups.length, 2);
        assert.equal(m.rows[0].note.kind, 'warn');
        assert.match(PO.html(m), /po-and/);
    });
    test('a co-requisite taken together in the same request counts', () => {
        const m = model([item(1, 7, 'valid', null), item(2, 8, 'valid', null)], [rec(2, 'PASSED', '2.00', 2, 2024), rec(4, 'PASSED', '2.00', 2, 2024)]);
        const lab = m.rows.find(r => r.code === 'IT 201L');
        assert.equal(lab.groups[0].nodes[0].state, 'together');
        assert.equal(lab.note.kind, 'good');
        assert.match(PO.html(m), /Taken together, in this request/);
    });
    test('a standing rule is drawn as a pill, met or not', () => {
        const met = model([item(1, 9, 'valid', null)], subjects.filter(s => s.year_level <= 2 && s.id !== 9).map(s => rec(s.id, 'PASSED', '2.00', 1, 2024)));
        assert.equal(met.rows[0].groups[0].nodes[0].relation, 'standing');
        assert.match(PO.html(met), /po-pill is-met/);
        const unmet = model([item(1, 9, 'valid', null)], []);
        assert.match(PO.html(unmet), /po-pill is-unmet/);
        assert.equal(unmet.rows[0].note.kind, 'warn');
    });
});

describe('decided subjects and edge cases', () => {
    test('an approved subject says approved (with its note); a rejected one says why', () => {
        const m = model([item(1, 5, 'approved', 'Take with NCM 105'), item(2, 2, 'rejected', 'Prerequisite not met.')], []);
        assert.equal(m.rows[0].note.title, 'Approved');
        assert.match(m.rows[0].note.text, /Take with NCM 105/);
        assert.equal(m.rows[1].note.title, 'Rejected');
        assert.equal(m.rows[1].note.text, 'Prerequisite not met.');
    });
    test('the latest pass is the one drawn, even if an earlier attempt failed', () => {
        const r = PO.recordFor([rec(1, 'FAILED', '3.25', 1, 2023), rec(1, 'PASSED', '2.50', 2, 2023)], 1);
        assert.equal(r.status, 'PASSED');
        assert.equal(r.grade, '2.50');
    });
    test('no semester on the request: no "Counts for" line, and nothing breaks', () => {
        const m = model([item(1, 5, 'valid', null)], [], {});
        assert.equal(m.rows[0].note.counts, '');
        assert.doesNotMatch(PO.html(m), /Counts for/);
    });
    test('an empty plan draws nothing', () => {
        assert.equal(PO.html(model([], [])), '');
        assert.equal(PO.html(null), '');
    });
    test('reasons and subject names are escaped, never injected as markup', () => {
        const m = model([{ ...item(1, 2, 'flagged', '<img src=x onerror=alert(1)>'), subject: { code: '<b>X</b>', title: '<script>y</script>', units: 3 } }], []);
        const h = PO.html(m);
        assert.doesNotMatch(h, /<img|<script>|<b>X/);
        assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
    });
    test('only the subjects that matter are drawn: a passed subject nobody asked about is not', () => {
        const m = model([item(1, 5, 'valid', null)], [rec(1, 'PASSED', '1.75', 1, 2024), rec(3, 'PASSED', '2.00', 1, 2024)]);
        assert.doesNotMatch(PO.html(m), /IT 111|MATH 100/);
    });
});

describe('the Faculty page', () => {
    const js = read('features/faculty/facultydashboard.js');
    test('reads what the map needs: the curriculum, the student\'s record and each subject\'s id', () => {
        assert.match(js, /id, subject_id, status, remarks, offering_id,/);
        assert.match(js, /created_at, updated_at, prospectus_id,/);
        assert.match(js, /fetchRecords\(req\.student\.id\), kbFor\(req\.prospectus_id\)/);
    });
    test('draws it under the table, after the table, and never lets a failure hold up the review', () => {
        assert.match(js, /\(withdrawn \? Promise\.resolve\(''\) : planOverviewHtml\(req, items\)\)\.then\(/);
        assert.match(js, /catch \(e\) \{\s*console\.warn\('plan overview failed:'/);
        assert.match(js, /bodyEl\.querySelectorAll\('\.po'\)\.forEach\(el => el\.remove\(\)\)/);
    });
    test('the script is loaded after the system check it uses', () => {
        const html = read('features/faculty/facultydashboard.html');
        assert.ok(html.indexOf('systemcheck.js') < html.indexOf('planoverview.js'));
    });
});

describe('the layout fills the width', () => {
    test('the subject groups sit in one grid container, so a wide screen can use two columns', () => {
        const items = [item(1, 2, 'valid', null), item(2, 5, 'valid', null), item(3, 4, 'valid', null)];
        const h = PO.html(model(items, [rec(1, 'PASSED', '1.75', 1, 2024), rec(3, 'PASSED', '2.00', 1, 2024)]));
        assert.equal((h.match(/class="po-rows"/g) || []).length, 1);
        assert.equal((h.match(/class="po-row"/g) || []).length, 3);
        // every group is inside the grid; the footer and clash strips are not
        assert.ok(h.indexOf('class="po-rows"') < h.indexOf('class="po-row"'));
        assert.ok(h.lastIndexOf('class="po-row"') < h.indexOf('class="po-foot"'));
    });
    test('the grid is responsive: columns of at least 25rem, one column when narrow', () => {
        const css = read('shared/css/dashboard.css');
        assert.match(css, /\.po-rows \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 25rem\), 1fr\)\)/);
    });
});

describe("the student's own overview (My requests)", () => {
    const stu = (items, records, request = { term: 1, year: 2024 }) =>
        PO.build({ items, records, kb, engine, request, yearLevel: 2, audience: 'student' });

    test('never shows a grade: Passed with the semester only, even for a failed subject', () => {
        const m = stu([item(1, 2, 'valid', null), item(2, 4, 'valid', null)],
            [rec(1, 'PASSED', '1.75', 1, 2023), rec(3, 'FAILED', '3.25', 2, 2023)]);
        const h = PO.html(m);
        assert.doesNotMatch(h, /1\.75|3\.25/);
        assert.match(h, /Passed \u00b7 1st Sem 2023/);
        assert.match(h, /Failed \u00b7 2nd Sem 2023 \u00b7 must be retaken/);
        for (const r of m.rows) for (const g of r.groups) for (const n of g.nodes) assert.equal(n.grade || '', '');
    });
    test('the adviser version still shows the grade', () => {
        const m = model([item(1, 2, 'valid', null)], [rec(1, 'PASSED', '1.75', 1, 2023)]);
        assert.match(PO.html(m), /Passed \u00b7 1\.75/);
    });

    test('a subject waiting for the adviser says so, and why the record meets the requirement', () => {
        const m = stu([item(1, 2, 'valid', null)], [rec(1, 'PASSED', '1.75', 1, 2023)]);
        const n = m.rows[0].note;
        assert.equal(n.kind, 'wait');
        assert.equal(n.title, 'In review by your adviser');
        assert.match(n.text, /Your record meets the requirement: IT 111 passed/);
        assert.doesNotMatch(PO.html(m), /Good to take|Cannot be approved|final approver/);
    });
    test('a subject with no prerequisite says so', () => {
        assert.match(stu([item(1, 5, 'valid', null)], []).rows[0].note.text, /no prerequisite/i);
    });
    test('a flagged subject says it will be sent back, with the reason and what to do', () => {
        const m = stu([item(1, 2, 'flagged', 'IT 111 was not passed. It must be retaken.')], [rec(1, 'FAILED', '3.25', 1, 2023)]);
        const n = m.rows[0].note;
        assert.equal(n.kind, 'warn');
        assert.equal(n.title, 'Will be sent back');
        assert.equal(n.text, 'IT 111 was not passed. It must be retaken.');
        assert.match(n.todo, /Retake that subject first/);
        assert.match(PO.html(m), /What to do:<\/strong> Retake that subject first/);
    });
    test('a sent-back subject shows the adviser\'s reason and a next step', () => {
        const n = stu([item(1, 2, 'rejected', 'This section clashes with another subject in the plan.')], []).rows[0].note;
        assert.equal(n.title, 'Sent back');
        assert.match(n.text, /clashes/);
        assert.match(n.todo, /different section/);
    });
    test('a sent-back subject with no reason still says so', () => {
        assert.equal(stu([item(1, 2, 'rejected', null)], []).rows[0].note.text, 'Your adviser sent this one back.');
    });
    test('an approved subject says approved, with the adviser\'s note', () => {
        const n = stu([item(1, 5, 'approved', 'Take with NCM 105')], []).rows[0].note;
        assert.equal(n.title, 'Approved');
        assert.match(n.text, /Note from your adviser: Take with NCM 105/);
    });
    test('the page title, the legend and the footer speak to the student', () => {
        const h = PO.html(stu([item(1, 5, 'valid', null)], []));
        assert.match(h, /What you have passed, and what you asked to take/);
        assert.match(h, /Your adviser makes the final decision/);
        assert.match(h, /Requested for 1st Sem 2024/);
    });
    test('student wording is escaped', () => {
        const h = PO.html(stu([item(1, 2, 'rejected', '<img src=x onerror=alert(1)>')], []));
        assert.doesNotMatch(h, /<img/);
    });
});

describe('"What to do": a plain next step from the system\'s own reason', () => {
    const cases = [
        ['This subject is already passed.',                          /already passed this subject/],
        ['This subject is already in progress.',                     /already taking/],
        ['Subject not found in the current curriculum.',             /not in your curriculum/],
        ['The chosen section is not offered for this subject this term.', /another section/],
        ['IT 111 was not passed. It must be retaken.',               /Retake that subject first/],
        ['IT 111 is in progress. It must be passed first.',          /Finish and pass that subject first/],
        ['IT 111 has not been taken.',                               /Take and pass that subject first/],
        ['CC-INTCOM11 must be passed first.',                        /Take and pass that subject first/],
        ['IT 201L must be taken together with IT 201. Add it to the same request.', /Add the other subject to the same request/],
        ['This section clashes with another subject in the plan. Please choose a different section.', /different section/],
        ['something nobody wrote a rule for',                        /Ask your adviser/],
        ['', /Ask your adviser/],
        [null, /Ask your adviser/],
    ];
    for (const [reason, expected] of cases) {
        test('"' + String(reason).slice(0, 48) + '"', () => assert.match(PO.todoFor(reason), expected));
    }
    test('a subject the adviser sent back, with a reason of their own words, points at Build your plan (as the banner does)', () => {
        for (const reason of ['basta', 'not complete', '', null]) {
            const todo = PO.todoFor(reason, true);
            assert.match(todo, /Open Build your plan/);
            assert.match(todo, /ask your adviser/);
        }
    });
    test('a sent-back subject with a reason the system knows keeps its own, more exact advice', () => {
        assert.match(PO.todoFor('CC-INTCOM11 must be passed first.', true), /Take and pass that subject first/);
        assert.match(PO.todoFor('This subject is already passed.', true), /already passed this subject/);
    });
    test('a subject that is only flagged has not been sent back yet, so it still says to ask the adviser', () => {
        assert.equal(PO.todoFor('basta'), 'Ask your adviser what to do next.');
        assert.equal(PO.todoFor('basta', false), 'Ask your adviser what to do next.');
    });
    test('the Overview uses the sent-back wording for rejected subjects only', () => {
        const src = read('shared/js/enrolment/planoverview.js');
        assert.match(src, /title: 'Sent back', text: reason \|\| 'Your adviser sent this one back\.', todo: todoFor\(reason, true\)/);
        assert.match(src, /title: 'Will be sent back', text: reason \|\| 'The system flagged this subject\.', todo: todoFor\(reason\)/);
    });
    test('covers every sentence the engine can give', () => {
        const core = read('supabase/functions/submit-advising-request/core.js');
        for (const sentence of ['This subject is already passed.', 'This subject is already in progress.',
            'Subject not found in the current curriculum.', 'The chosen section is not offered for this subject this term.']) {
            assert.ok(core.includes(sentence));
            assert.doesNotMatch(PO.todoFor(sentence), /Ask your adviser what to do next/);
        }
    });
});

describe('the Student page', () => {
    const js = read('features/student/studentdashboard.js');
    test('loads the overview module and builds one per request on My requests', () => {
        assert.match(read('features/student/studentdashboard.html'), /planoverview\.js/);
        assert.match(js, /const overviews = await studentOverviews\(requests\);/);
        assert.match(js, /\$\{overviews\.get\(r\.id\) \?\? ''\}/);
    });
    test('uses the student\'s own wording (no grades), their own record and the curriculum already loaded', () => {
        assert.match(js, /audience: 'student'/);
        assert.match(js, /records: RECORDS/);
        assert.match(js, /await loadKnowledgeBase\(STUDENT\)/);
    });
    test('a failed lookup only means no map: the request is still shown', () => {
        assert.match(js, /catch \(e\) \{\s*console\.warn\('request overview failed:'/);
    });
});
