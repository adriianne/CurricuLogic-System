// enrollmentform.test.mjs
// The university's UC-Form 1A printed from an approved plan (shared/js/enrolment/enrollmentform.js).
//
//   node --test tests/enrollmentform.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Form = require('../shared/js/enrolment/enrollmentform.js');

const student = { first_name: 'Athena', last_name: 'Po', student_id: '2401187', year_level: 1, email: 'athena@example.com', phone: '09171234567' };
const lec = { edp_code: '5001', section: 'BSIT-1A', schedule_days: 'MW', start_time: '08:00:00', end_time: '09:30:00', room: 'Room 101', meeting_type: 'LEC' };
const lab = { edp_code: '5002', section: 'BSIT-1A', schedule_days: 'F', start_time: '13:00:00', end_time: '16:00:00', room: 'Lab 2', meeting_type: 'LAB' };
const items = [
    { code: 'CC-COMPROG11', units: 5, meetings: [lec, lab] },
    { code: 'MATH 101', units: 3, meetings: [{ ...lec, edp_code: '5003', start_time: '10:00:00', end_time: '11:30:00', room: 'Room 105' }] },
];
const html = (over = {}) => Form.html({
    student, items, term: { number: 1, year: 2026 }, program: { name: 'BS Information Technology' },
    ref: 'CL-2026-000021', ...over,
});

describe('build: the table rows', () => {
    test('one row per meeting, with EDP code, subject code, days and room', () => {
        const { rows } = Form.build({ items });
        assert.equal(rows.length, 3);
        assert.deepEqual(rows.map(r => r.edp), ['5001', '5002', '5003']);
        assert.deepEqual(rows.map(r => r.code), ['CC-COMPROG11', 'CC-COMPROG11', 'MATH 101']);
        assert.equal(rows[1].days, 'F');
        assert.equal(rows[1].room, 'Lab 2');
    });

    test('a subject\'s units are written once, so a lecture with a lab is not counted twice', () => {
        const { rows, totalUnits } = Form.build({ items });
        assert.deepEqual(rows.map(r => r.units), [5, null, 3]);
        assert.equal(totalUnits, 8);
    });

    test('the header section is the one most subjects are in', () => {
        const other = { ...lec, section: 'BSIT-2B' };
        const { section } = Form.build({ items: [...items, { code: 'X 1', units: 1, meetings: [other] }] });
        assert.equal(section, 'BSIT-1A');
    });

    test('a subject with no section posted still gets a row, and no input throws', () => {
        const { rows, section } = Form.build({ items: [{ code: 'PE 101', units: 2, meetings: [] }] });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].edp, '');
        assert.equal(section, '');
        assert.deepEqual(Form.build({ items: undefined }).rows, []);
    });
});

describe('page 1', () => {
    const h = html();

    test('has the university name, form number and the reference', () => {
        assert.match(h, /UNIVERSITY OF CEBU/);
        assert.match(h, /UC-FORM 1A/);
        assert.match(h, /Ref\. CL-2026-000021/);
    });

    test('has the logo, in the upper left before the university name', () => {
        assert.match(h, /<img src="\.\.\/\.\.\/assets\/UC_Logo\.png"/);
        assert.ok(h.indexOf('UC_Logo.png') < h.indexOf('UNIVERSITY OF CEBU</div>'));
    });

    test('ticks the semester, writes the school year, programme (also as the major), year level and section', () => {
        assert.match(h, /<span class="box on"><\/span> 1st <span class="box"><\/span> 2nd <span class="box"><\/span> SUMMER/);
        assert.match(h, /2026–2027/);
        assert.equal((h.match(/BS Information Technology/g) ?? []).length, 2);
        assert.match(h, /<span class="lab">SECTION<\/span><span class="val">BSIT-1A<\/span>/);
    });

    test('the second semester and summer tick their own boxes', () => {
        assert.match(html({ term: { number: 2, year: 2026 } }), /<span class="box"><\/span> 1st <span class="box on"><\/span> 2nd/);
        assert.match(html({ term: { number: 3, year: 2026 } }), /<span class="box on"><\/span> SUMMER/);
    });

    test('the ID number goes one digit to a box, in the form\'s 8 boxes', () => {
        const boxes = Form.idBoxes('24011876');
        assert.equal((boxes.match(/class="idbox"/g) ?? []).length, 8);
        assert.ok(boxes.startsWith('<span class="idbox">2</span><span class="idbox">4</span>'));
        assert.ok(boxes.endsWith('<span class="idbox">6</span>'));
    });

    test('a shorter ID leaves the last boxes empty; a longer one gets more boxes and is never cut; no ID draws 8 empty boxes', () => {
        assert.ok(Form.idBoxes('2401187').endsWith('<span class="idbox">7</span><span class="idbox"></span>'));
        assert.equal((Form.idBoxes('240118765').match(/class="idbox"/g) ?? []).length, 9);
        assert.equal((Form.idBoxes('').match(/class="idbox"/g) ?? []).length, 8);
    });

    test('the ID boxes are big (28px wide on page 1, as on the printed form)', () => {
        assert.match(h, /\.idbox \{ width: 28px; height: 36px;/);
    });

    test('the name is three separate boxes under their own captions', () => {
        assert.ok(h.includes('<span class="val">Po</span><small>LAST NAME</small>'));
        assert.ok(h.includes('<span class="val">Athena</span><small>FIRST NAME</small>'));
        assert.ok(h.includes('<span class="val"></span><small>MIDDLE NAME</small>'));
    });

    test('the "Approved by" line is left empty: nobody\'s name is printed there', () => {
        assert.ok(!h.includes('Jay Darga'));
        assert.match(h, /<div class="sig"><\/div>\s*<div class="cap"><span>Dean\/Chairperson\/Head<\/span>/);
    });

    test('the subjects and the total are on the form', () => {
        for (const text of ['CC-COMPROG11', 'MATH 101', '5001', '5002', '5003', 'Room 101', 'Lab 2', 'MW', '8:00']) {
            assert.ok(h.includes(text), `${text} is on the form`);
        }
        assert.match(h, /TOTAL UNITS<\/span><strong>8<\/strong>/);
    });

    test('has the table of at least 16 lines, and grows for a longer plan', () => {
        const rowsOf = (s) => (s.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g) ?? []).length;
        assert.equal(rowsOf(h), 16);
        const many = Array.from({ length: 20 }, (_, i) => ({ code: `S ${i}`, units: 1, meetings: [lec] }));
        assert.equal(rowsOf(html({ items: many })), 20);
    });

    test('keeps the enrolment flow, the acknowledgement and the stub; signatures, dates and fees stay blank', () => {
        for (const text of ['ENROLLMENT FLOW', 'GO TO CASHIER FOR PAYMENT', 'ACKNOWLEDGEMENT', 'Student\'s signature over printed name', 'ENTRANCE', 'OLD ACCOUNTS']) {
            assert.ok(h.includes(text), text);
        }
        assert.match(h, /<span class="lab">ENTRANCE ₱<\/span><span class="val"><\/span>/);
    });
});

describe('page 2 and the paper', () => {
    const h = html();

    test('page 2 holds the supplementary information with the email and mobile filled in', () => {
        assert.match(h, /STUDENT SUPPLEMENTARY INFORMATION/);
        assert.match(h, /<span class="val">athena@example\.com<\/span><small>Email Address<\/small>/);
        assert.match(h, /<span class="val">09171234567<\/span><small>Mobile Number<\/small>/);
        for (const text of ['CITY ADDRESS', 'PROVINCIAL ADDRESS', 'WHO IS SUPPORTING FOR YOUR STUDIES?', 'EDUCATIONAL BACKGROUND']) {
            assert.ok(h.includes(text), text);
        }
    });

    test('the terms and conditions are printed in full', () => {
        assert.match(h, /ENROLLMENT TERMS AND CONDITIONS/);
        assert.equal((h.match(/<ol>[\s\S]*<\/ol>/)[0].match(/<li>/g) ?? []).length, 7 + 4);
        assert.match(h, /After the 2nd week of classes - Full charge/);
    });

    test('both pages are legal size, 8.5 x 14 inches, each on its own sheet', () => {
        assert.match(h, /@page \{ size: 8\.5in 14in;/);
        assert.equal((h.match(/<section class="page/g) ?? []).length, 2);
        assert.match(h, /\.page \{[^}]*page-break-after: always/);
    });

    test('a student with no email or mobile gets blank lines, not "undefined"', () => {
        const blank = html({ student: { ...student, email: null, phone: undefined } });
        assert.ok(!blank.includes('undefined') && !blank.includes('null'));
    });
});

describe('what a person typed cannot break the page', () => {
    test('names, email and programme are escaped', () => {
        const h = html({
            student: { ...student, first_name: '<script>alert(1)</script>', email: '"><img src=x>' },
            program: { name: '<b>BSIT</b>' },
        });
        assert.ok(!h.includes('<script>alert(1)'));
        assert.ok(!h.includes('<img src=x>'));
        assert.ok(!h.includes('<b>BSIT</b>'));
    });
});

describe('wiring', () => {
    const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

    for (const role of ['faculty', 'registrar']) {
        test(`${role} loads the form script and has the button`, () => {
            assert.match(read(`features/${role}/${role}dashboard.html`), /enrolment\/enrollmentform\.js/);
            assert.match(read(`features/${role}/${role}dashboard.js`), /data-print-uc-form/);
        });
    }
});

describe('the approved-plan views print the UC form only (the advising slip button is gone)', () => {
    const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
    for (const role of ['faculty', 'registrar']) {
        test(`${role}: one print button, "Print enrollment form", and no advising slip print on the approved plan`, () => {
            const js = read(`features/${role}/${role}dashboard.js`);
            assert.ok(js.includes('Print enrollment form'));
            assert.ok(!js.includes('Print advising slip'));
            assert.ok(!js.includes('AdvisingSlip.printApprovedRequest'));
            assert.ok(!js.includes('data-print-plan'));
        });
    }
});

describe('the Registrar plan page has the same status bar as the Faculty page', () => {
    const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
    test('the bar is under the subjects card, and the message and print button are rendered in it', () => {
        assert.ok(read('features/registrar/registrardashboard.html').includes('<div class="req-detail-foot" id="adv-detail-foot"></div>'));
        const js = read('features/registrar/registrardashboard.js');
        assert.ok(js.includes("$('adv-detail-foot')"));
        assert.ok(js.includes('Approved for enrollment. Print the enrollment form for the student to sign.'));
    });
});

describe('the Faculty Students tab no longer prints an advising slip', () => {
    const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
    test('no print-slip button, handler or slip data is left on the Faculty page', () => {
        const html = read('features/faculty/facultydashboard.html');
        const js = read('features/faculty/facultydashboard.js');
        assert.ok(!html.includes('print-slip') && !html.includes('Print advising slip'));
        assert.ok(!js.includes('print-slip') && !js.includes('CURRENT_SLIP') && !js.includes('AdvisingSlip.print('));
    });
});

describe('a revised copy after a section switch (db/091)', () => {
    const changed = { ...items[1], changedAt: '2026-10-30T02:15:00Z' };
    const earlier = { ...items[0], changedAt: '2026-10-29T08:00:00Z' };

    test('revisedAt is the latest switch, or null when no section was switched', () => {
        assert.equal(Form.revisedAt(items), null);
        assert.equal(Form.revisedAt([earlier, changed]).toISOString(), '2026-10-30T02:15:00.000Z');
        assert.equal(Form.revisedAt([{ changedAt: 'not a date' }, null, undefined]), null);
        assert.equal(Form.revisedAt(undefined), null);
    });

    test('a plan with a switched section prints "REVISED COPY" with the date, and says it needs a new signature', () => {
        const h = html({ items: [earlier, changed] });
        assert.ok(h.includes('REVISED COPY'));
        assert.ok(h.includes('Section changed October 30, 2026'));
        assert.ok(h.includes('needs a new signature'));
    });

    test('the first copy has no REVISED mark', () => {
        assert.ok(!html().includes('REVISED COPY'));
        assert.ok(!html({ items }).includes('Section changed'));
    });

    test('the mark is part of the page header, before the subject table', () => {
        const h = html({ items: [changed] });
        assert.ok(h.indexOf('REVISED COPY') < h.indexOf('<table class="subj"'));
    });
});

describe('the student can print the form again (lost copy, or after a switch)', () => {
    const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
    test('the student page loads the form script and has a button on every approved request', () => {
        assert.match(read('features/student/studentdashboard.html'), /enrolment\/enrollmentform\.js/);
        const js = read('features/student/studentdashboard.js');
        assert.ok(js.includes('data-uc-form="${r.id}"'));
        assert.ok(js.includes('EnrollmentForm.printApprovedRequest(supabase, btn.dataset.ucForm)'));
    });

    test('after a switch the student is told to print again and get it signed again', () => {
        const js = read('features/student/studentdashboard.js');
        assert.equal((js.match(/Print the enrollment form again and have it signed again/g) ?? []).length, 2);
        assert.ok(!js.includes('Write its EDP code on your form'));
        assert.ok(!js.includes('Write the new EDP code on your form'));
    });

    test('the query falls back when the column is missing, so an old database still prints', () => {
        const js = read('shared/js/enrolment/enrollmentform.js');
        assert.ok(js.includes("/section_changed_at/.test(error.message"));
    });
});

describe('db/091 migration', () => {
    const sql = read091();
    function read091() { return fs.readFileSync(new URL('../db/091_section_changed_at.sql', import.meta.url), 'utf8'); }
    test('adds the column and makes the switch function set it, checked', () => {
        assert.ok(sql.includes('add column if not exists section_changed_at timestamptz'));
        assert.ok(sql.includes("'section_changed_at = now(),'") || sql.includes('section_changed_at = now(),'));
        assert.ok(sql.includes("raise exception 'db/091"));
    });
});

describe('the record of prints (db/092)', () => {
    const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
    const row = (over = {}) => ({ printed_at: '2026-10-30T02:42:00Z', printed_as: 'faculty', printed_by_name: 'Jay Darga', total: 1, ...over });

    test('historyText says how many times, when, and who printed last', () => {
        const t = Form.historyText([row({ total: 3 }), row({ printed_at: '2026-10-29T08:00:00Z', printed_as: 'student', printed_by_name: 'Athena Po', total: 3 })]);
        assert.ok(t.startsWith('Printed 3 times. Last: October 30, 2026'));
        assert.ok(t.includes('10:42 AM'));
        assert.ok(t.endsWith('by Jay Darga (the adviser).'));
    });

    test('once, and each kind of printer is named in words', () => {
        assert.ok(Form.historyText([row()]).startsWith('Printed once.'));
        assert.ok(Form.historyText([row({ printed_as: 'student', printed_by_name: 'Athena Po' })]).includes('Athena Po (the student)'));
        assert.ok(Form.historyText([row({ printed_as: 'registrar', printed_by_name: 'Carl Gralo' })]).includes('Carl Gralo (the Registrar)'));
    });

    test('a missing name still says the role; never printed, bad rows or no rows give an empty line', () => {
        assert.ok(Form.historyText([row({ printed_by_name: '' })]).endsWith('by the adviser.'));
        assert.equal(Form.historyText([]), '');
        assert.equal(Form.historyText(undefined), '');
        assert.equal(Form.historyText([{ printed_at: 'nope' }, null]), '');
    });

    test('the total counts prints beyond the 20 rows the page receives', () => {
        assert.ok(Form.historyText([row({ total: 47 })]).startsWith('Printed 47 times.'));
    });

    test('printing records itself, and a failure to record never blocks the print', () => {
        const js = read('shared/js/enrolment/enrollmentform.js');
        assert.ok(js.includes("supabase.rpc('log_form_print', { p_request_id: req.id })"));
        assert.match(js, /try \{ await supabase\.rpc\('log_form_print'[^\n]*catch \(e\)/);
        assert.ok(js.indexOf('print({') < js.indexOf("rpc('log_form_print'"), 'the form opens first, the record is written after');
    });

    test('Faculty, Registrar and the student page each show the line', () => {
        assert.ok(read('features/faculty/facultydashboard.js').includes('data-print-history'));
        assert.ok(read('features/registrar/registrardashboard.js').includes('data-print-history'));
        assert.ok(read('features/student/studentdashboard.js').includes('data-uc-form-history'));
    });

    test('db/092: a log table nobody can touch directly, and two functions that check who is asking', () => {
        const sql = read('db/092_form_print_log.sql');
        assert.ok(sql.includes('revoke all on public.form_print from public, anon, authenticated'));
        assert.ok(sql.includes("printed_as  text        not null check (printed_as in ('student', 'faculty', 'registrar'))"));
        assert.ok(sql.includes('current_student_id() = v_student'));
        assert.ok(sql.includes('is_adviser_of_request(p_request_id)'));
        assert.ok(sql.includes('is_registrar_of_student(v_student)'));
        assert.ok(sql.includes("'PRINT_ENROLLMENT_FORM'"));
    });
});
