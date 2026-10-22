// curriculumprint.test.mjs
// The one-page printable curriculum: what is on it and that nothing a person types can break the page.
//
//   node --test tests/curriculumprint.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../shared/js/curriculum/curriculumprint.js');

const sub = (id, code, title, year, term, lec, lab, extra = {}) =>
    ({ id, code, title, year_level: year, term, lec_units: lec, lab_units: lab, units: lec + lab, ...extra });

const subjects = [
    sub(1, 'ENGL 100', 'Communication Arts', 1, 1, 3, 0),
    sub(2, 'COMP 100', 'Computer Application', 1, 1, 2, 1),
    sub(3, 'CRIM 121', 'Intro to Justice', 1, 2, 3, 0),
    sub(4, 'LIT 11', 'Literature', 2, 1, 3, 0),
    sub(5, 'CLJ 311', 'Procedure', 3, 1, 3, 0),
    sub(6, 'SUM 1', 'Summer thing', 1, 3, 3, 0),
    sub(7, 'ELEC 1', 'Pick one', 3, 2, 3, 0, { is_elective: true, elective_type: null }),
    sub(8, 'FREE 1', 'Pick any', 4, 1, 3, 0, { is_elective: true, elective_type: 'FREE' }),
    sub(9, 'CAT 1', 'Catalogue course', null, null, 3, 0, { is_elective: true }),
];
const rules = new Map([
    [3, [{ code: 'ENGL 100' }]],
    [5, [{ mark: '**' }, { code: 'LIT 11' }]],
    [4, [{ label: 'Through 1st Yr, 2nd Sem' }]],
]);

describe('build', () => {
    test('orders the years and keeps only placed subjects in them', () => {
        const b = P.build({ subjects, rules });
        assert.deepEqual(b.years.map(y => y.year), [1, 2, 3, 4]);
        assert.equal(b.catalogue.length, 1);
    });

    test('splits each year into its semesters, with summer last', () => {
        const y1 = P.build({ subjects, rules }).years[0];
        assert.deepEqual(y1.terms.map(t => t.term), [1, 2, 3]);
        assert.deepEqual(y1.terms[0].rows.map(r => r.code), ['ENGL 100', 'COMP 100']);
    });

    test('the programme total counts placed subjects only, not the catalogue', () => {
        assert.equal(P.build({ subjects, rules }).totalUnits, 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3);
    });
});

describe('preText', () => {
    test('prerequisite codes, standing marks and standing text are joined', () => {
        assert.equal(P.preText(subjects[4], rules), '**, LIT 11');
        assert.equal(P.preText(subjects[3], rules), 'Through 1st Yr, 2nd Sem');
    });

    test('an elective slot shows its bullet instead of a prerequisite', () => {
        assert.equal(P.preText(subjects[6], rules), '●');
        assert.equal(P.preText(subjects[7], rules), '●●');
    });

    test('a subject with no rules is blank', () => {
        assert.equal(P.preText(subjects[0], rules), '');
    });
});

describe('html', () => {
    const page = P.html({ subjects, rules }, {
        program: 'BS Criminology', college: 'College of Criminal Justice', effective: '2019–2020',
    });

    test('has the header, every year bar and the total', () => {
        assert.match(page, /College of Criminal Justice/);
        assert.match(page, /BS Criminology/);
        assert.match(page, /Effective School Year 2019.2020/);
        for (const name of ['I - FIRST YEAR', 'II - SECOND YEAR', 'III - THIRD YEAR', 'IV - FOURTH YEAR']) assert.match(page, new RegExp(name));
        assert.match(page, /24 UNITS/);
    });

    test('has blank lines for the student, and a blank Grade column', () => {
        for (const label of ['Student'+"'"+'s ID Number', 'Student'+"'"+'s Full Name', 'Date Started / First Enrolled', 'Expected Date of Graduation']) {
            assert.match(page, new RegExp(label.replace(/[/]/g, '\/')));
        }
        assert.match(page, /<th[^>]*>Grade<\/th>/);
        assert.match(page, /<td class="gr"><\/td>/);
        assert.doesNotMatch(page, /<td class="gr">[^<]/);
    });

    test('each year has its own colour', () => {
        assert.match(page, /class="bar" style="background:#556b2f"/);
        assert.match(page, /class="bar" style="background:#b45309"/);
        assert.match(page, /class="bar" style="background:#6b2230"/);
        assert.match(page, /class="bar" style="background:#24456f"/);
    });

    test('numbers the semesters 1 to 8 and labels them sideways', () => {
        assert.match(page, /side-head"[^>]*>1<\/th>/);
        assert.match(page, /side-head"[^>]*>2<\/th>/);
        assert.match(page, /side-head"[^>]*>5<\/th>/);
        assert.match(page, /<span>1st Semester<\/span>/);
    });

    test('shows lec, lab and total per subject, and only the total units in the Total row', () => {
        assert.match(page, /<td class="code">COMP 100<\/td>[\s\S]*?<td class="n">2<\/td>\s*<td class="n">1<\/td>\s*<td class="n">3<\/td>/);
        assert.match(page, /<td colspan="6" class="r tintbg">Total<\/td><td class="n tintbg">6<\/td>/);
    });

    test('an unfilled elective slot is a blank code and a numbered elective', () => {
        assert.match(page, /<td class="code">ELEC_____<\/td>/);
        assert.match(page, /IT Elective 1/);
        assert.match(page, /Free Elective 1/);
    });

    test('pads the shorter semester so the two sit level', () => {
        // year 1: semester 1 has 2 subjects, semester 2 has 1
        assert.match(page, /<tr class="blank">/);
    });

    test('colours titles by kind of course and sums them in the summary', () => {
        const kinds = [
            sub(1, 'G 1', 'Gen', 1, 1, 3, 0, { category: 'GE' }),
            sub(2, 'PE 1', 'Fit', 1, 1, 2, 0, { category: 'OTHER' }),
            sub(3, 'C 1', 'Core', 1, 2, 3, 0, { category: 'COMMON_COMPUTING' }),
            sub(4, 'P 1', 'Prof', 1, 2, 4, 0, { category: 'PROFESSIONAL_IT' }),
            sub(5, 'EL1', 'x', 2, 1, 3, 0, { is_elective: true }),
        ];
        const b = P.build({ subjects: kinds, rules: new Map() });
        assert.deepEqual(b.summary, [
            { label: 'General Education Courses', units: 5 },
            { label: 'Core Computing Courses', units: 3 },
            { label: 'Professional IT Courses', units: 4 },
            { label: 'IT Electives / Free Electives', units: 3 },
        ]);
        const html = P.html({ subjects: kinds, rules: new Map() }, {});
        assert.match(html, /color:#2e7d32">Gen</);
        assert.match(html, /color:#c62828">Core</);
        assert.match(html, /color:#1d3fbf">Prof</);
        assert.match(html, /SUMMARY OF COURSES/);
        assert.match(html, /15 UNITS/);
    });

    test('prints the elective lists and only the remarks the programme needs', () => {
        const withCat = P.html({ subjects: [...subjects, sub(10, 'FRE 1', 'Free choice', null, null, 3, 0, { is_elective: true, elective_type: 'FREE' })], rules }, {});
        assert.match(withCat, /IT ELECTIVE COURSES/);
        assert.match(withCat, /FREE ELECTIVE COURSES/);
        assert.match(withCat, /CAT 1/);
        assert.match(page, /choose from the IT elective courses/);
        assert.match(page, /choose from the free elective courses/);
        const none = P.html({ subjects: subjects.slice(0, 5), rules }, {});
        assert.doesNotMatch(none, /choose from the IT elective courses/);
        assert.doesNotMatch(none, /IT ELECTIVE COURSES/);
    });

    test('is set to print on one A4 page', () => {
        assert.match(page, /@page { size: A4 portrait/);
    });

    test('text typed into a title or programme cannot inject markup', () => {
        const evil = P.html({
            subjects: [sub(1, '<b>X</b>', '<img src=x onerror=alert(1)>', 1, 1, 3, 0)],
            rules: new Map(),
        }, { program: '<script>alert(1)</script>', college: '<i>c</i>' });
        assert.doesNotMatch(evil, /<img src=x/);
        assert.doesNotMatch(evil, /<script>alert/);
        assert.doesNotMatch(evil, /<i>c<\/i>/);
        assert.match(evil, /&lt;img src=x/);
    });

    test('works with no subjects and no info', () => {
        assert.doesNotThrow(() => P.html({ subjects: [], rules: new Map() }));
    });
});

describe('paper', () => {
    test('a page that fits A4 stays on A4, a taller one moves to long bond', () => {
        assert.equal(P.paperFor(800), 'a4');
        assert.equal(P.paperFor(P.PAPER.a4.usable), 'a4');
        assert.equal(P.paperFor(P.PAPER.a4.usable + 1), 'long');
    });

    test('long bond is 8.5 x 13 inches and holds more than A4', () => {
        assert.equal(P.PAPER.long.css, '8.5in 13in');
        assert.ok(P.PAPER.long.usable > P.PAPER.a4.usable);
    });

    test('the printed page starts on A4 and has a style the page can switch', () => {
        const page = P.html({ subjects, rules }, {});
        assert.match(page, /<style id="paper">@page { size: A4 portrait/);
    });

    test('the page has no inline script (the Content-Security-Policy would block it)', () => {
        assert.doesNotMatch(P.html({ subjects, rules }, {}), /<script/i);
    });

    const fakeWindow = (height) => {
        const paper = { textContent: '@page { size: A4 portrait; margin: 7mm; }' };
        const body = { style: { width: '' }, get scrollHeight() { return height; } };
        return { paper, win: { document: { body, getElementById: (id) => (id === 'paper' ? paper : null) } } };
    };

    test('fitPaper leaves a short curriculum on A4', () => {
        const { paper, win } = fakeWindow(800);
        assert.equal(P.fitPaper(win), 'a4');
        assert.match(paper.textContent, /A4 portrait/);
    });

    test('fitPaper moves a tall curriculum to long bond and restores the width', () => {
        const { paper, win } = fakeWindow(1500);
        assert.equal(P.fitPaper(win), 'long');
        assert.match(paper.textContent, /size: 8.5in 13in/);
        assert.equal(win.document.body.style.width, '');
    });
});

describe('order', () => {
    test('subjects print in curriculum (saved) order, not by code', () => {
        const mixed = [
            sub(30, 'ZZZ 1', 'Third', 1, 1, 3, 0),
            sub(10, 'MMM 1', 'First', 1, 1, 3, 0),
            sub(20, 'AAA 1', 'Second', 1, 1, 3, 0),
        ];
        const rows = P.build({ subjects: mixed, rules: new Map() }).years[0].terms[0].rows;
        assert.deepEqual(rows.map(r => r.code), ['MMM 1', 'AAA 1', 'ZZZ 1']);
        const page = P.html({ subjects: mixed, rules: new Map() }, {});
        assert.ok(page.indexOf('MMM 1') < page.indexOf('AAA 1'));
        assert.ok(page.indexOf('AAA 1') < page.indexOf('ZZZ 1'));
    });
});

describe('degree audit (grades and student filled in)', () => {
    const audit = P.html({ subjects, rules }, {
        program: 'BS Criminology', college: 'College of Criminal Justice', effective: '2019\u20132020',
        student: { name: 'Althea <b>Villanueva</b>', id: '2401187' },
        grades: { 1: '1.75', 2: 'Taking', 4: '5.00' },
    });

    test('the student lines carry the name and ID, escaped', () => {
        assert.match(audit, /Student's ID Number: <i>2401187<\/i>/);
        assert.match(audit, /Student's Full Name: <i>Althea &lt;b&gt;Villanueva&lt;\/b&gt;<\/i>/);
        assert.doesNotMatch(audit, /<b>Villanueva<\/b>/);
    });

    test('the Grade column shows each subject\u2019s grade and is blank for the rest', () => {
        assert.match(audit, /<td class="gr">1\.75<\/td>/);
        assert.match(audit, /<td class="gr">Taking<\/td>/);
        assert.match(audit, /<td class="gr">5\.00<\/td>/);
        // subject 3 has no grade: its Grade cell is still empty
        assert.match(audit, /<td class="gr"><\/td>\s*<td class="code">CRIM 121/);
    });

    test('a Map of grades works the same as an object', () => {
        const page = P.html({ subjects, rules }, { grades: new Map([[1, 'PASSED']]) });
        assert.match(page, /<td class="gr">PASSED<\/td>/);
    });

    test('with no student and no grades the page stays blank to write in', () => {
        const blank = P.html({ subjects, rules }, {});
        assert.match(blank, /Student's ID Number: <i><\/i>/);
        assert.doesNotMatch(blank, /<td class="gr">[^<]/);
    });

    test('a grade typed by a person cannot inject markup', () => {
        const page = P.html({ subjects, rules }, { grades: { 1: '<img src=x onerror=alert(1)>' } });
        assert.doesNotMatch(page, /<img src=x/);
        assert.match(page, /&lt;img src=x/);
    });
});
