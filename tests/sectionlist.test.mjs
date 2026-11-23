// sectionlist.test.mjs
// "Sections this term" on the Department Schedule tab (22 Nov 2026): one line per section with saved offerings, how complete it is,
// a View button that loads it into the build table and a Print button for its timetable.
//
//   node --test tests/sectionlist.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SL = require('../shared/js/schedule/sectionlist.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const SUBJECTS = {
    1: { id: 1, code: 'CC-COMPROG12', title: 'Computer Programming 2', units: 3 },
    2: { id: 2, code: 'ENGL 101', title: 'Purposive Communication', units: 3 },
    3: { id: 3, code: 'PE 102', title: 'Fitness <Activities> & "more"', units: 2 },
};
const subjectOf = (id) => SUBJECTS[id];
const row = (section, subject_id, meeting_type, days, start, end, extra = {}) =>
    ({ section, subject_id, meeting_type, schedule_days: days, start_time: start, end_time: end, room: '218', edp_code: '1' + subject_id, ...extra });

describe('summarize', () => {
    test('one line per section, counted from its rows', () => {
        const out = SL.summarize([
            row('ACT-1A', 1, 'LEC', 'TTh', '07:30', '09:00'),
            row('ACT-1A', 1, 'LAB', 'S', '07:30', '10:30'),
            row('ACT-1A', 2, 'LEC', 'MW', '09:00', '10:30'),
        ], subjectOf);
        assert.equal(out.length, 1);
        const s = out[0];
        assert.equal(s.section, 'ACT-1A');
        assert.equal(s.rows, 3);
        assert.equal(s.subjects, 2);
        assert.equal(s.lectures, 2);
        assert.equal(s.labs, 1);
        assert.equal(s.level, 1);
        assert.equal(s.letter, 'A');
    });

    test('units count the lecture row only, so a lab does not double a subject', () => {
        const out = SL.summarize([
            row('ACT-1A', 1, 'LEC', 'TTh', '07:30', '09:00'),
            row('ACT-1A', 1, 'LAB', 'S', '07:30', '10:30'),
            row('ACT-1A', 3, 'LEC', 'F', '10:00', '12:00'),
        ], subjectOf);
        assert.equal(out[0].units, 5);
    });

    test('state: complete, some times missing, none yet', () => {
        const out = SL.summarize([
            row('ACT-1A', 1, 'LEC', 'TTh', '07:30', '09:00'),
            row('ACT-1B', 1, 'LEC', 'TTh', '07:30', '09:00'),
            row('ACT-1B', 2, 'LEC', '', '', ''),
            row('ACT-1C', 1, 'LEC', '', null, null),
        ], subjectOf);
        const by = Object.fromEntries(out.map(s => [s.section, s.state]));
        assert.deepEqual(by, { 'ACT-1A': 'ready', 'ACT-1B': 'partial', 'ACT-1C': 'empty' });
    });

    test('sorted by year level, then letter, not as plain text', () => {
        const out = SL.summarize([
            row('ACT-2A', 1, 'LEC', 'M', '07:30', '09:00'),
            row('ACT-1B', 1, 'LEC', 'M', '07:30', '09:00'),
            row('ACT-1A', 1, 'LEC', 'M', '07:30', '09:00'),
            row('ACT-10A', 1, 'LEC', 'M', '07:30', '09:00'),
        ], subjectOf);
        // ACT-10A is not a real section name (one digit only), so it goes last
        assert.deepEqual(out.map(s => s.section), ['ACT-1A', 'ACT-1B', 'ACT-2A', 'ACT-10A']);
    });

    test('nothing in, nothing out; a row without a section is ignored', () => {
        assert.deepEqual(SL.summarize([], subjectOf), []);
        assert.deepEqual(SL.summarize(null, subjectOf), []);
        assert.deepEqual(SL.summarize([{ subject_id: 1 }], subjectOf), []);
    });

    test('a subject the curriculum no longer has counts as 0 units, not NaN', () => {
        const out = SL.summarize([row('ACT-1A', 99, 'LEC', 'M', '07:30', '09:00')], subjectOf);
        assert.equal(out[0].units, 0);
    });
});

describe('parts', () => {
    test('reads the year level and letter of any programme prefix', () => {
        assert.deepEqual(SL.parts('ACT-1A'), { level: 1, letter: 'A' });
        assert.deepEqual(SL.parts('BSCS-3b'), { level: 3, letter: 'B' });
    });
    test('answers null for a name it does not recognise', () => {
        assert.equal(SL.parts('ACT'), null);
        assert.equal(SL.parts(''), null);
        assert.equal(SL.parts(null), null);
    });
});

describe('timetableHtml', () => {
    const html = SL.timetableHtml({
        section: 'ACT-1A',
        termText: '2nd Sem · AY 2024–2025',
        programName: 'Associate in Computer Technology',
        subjectOf,
        rows: [
            row('ACT-1A', 3, 'LEC', 'TTh', '10:30', '11:30'),
            row('ACT-1A', 1, 'LAB', 'S', '07:30', '10:30', { room: '803', edp_code: '66592' }),
            row('ACT-1A', 1, 'LEC', 'TTh', '07:30', '09:00', { edp_code: '54123' }),
        ],
    });
    test('names the section, the programme and the term', () => {
        assert.ok(html.includes('<h1>ACT-1A</h1>'));
        assert.ok(html.includes('Associate in Computer Technology'));
        assert.ok(html.includes('2nd Sem'));
    });
    test('times are written the way students read them', () => {
        assert.ok(html.includes('7:30 AM – 9:00 AM'));
        assert.ok(html.includes('10:30 AM – 11:30 AM'));
    });
    test('a subject lists its lecture before its lab, subjects in code order', () => {
        const lec = html.indexOf('54123'), lab = html.indexOf('66592'), pe = html.indexOf('PE 102');
        assert.ok(lec > 0 && lab > lec, 'lecture first');
        assert.ok(pe > lab, 'PE 102 sorts after CC-COMPROG12');
    });
    test('text from the data cannot break the page', () => {
        assert.ok(html.includes('Fitness &lt;Activities&gt; &amp; &quot;more&quot;'));
        assert.ok(!html.includes('<Activities>'));
    });
    test('counts the meetings', () => {
        assert.ok(html.includes('3 meetings.'));
    });
});

describe('wiring on the Schedule tab', () => {
    const html = read('features/department/departmentdashboard.html');
    const js = read('features/department/departmentdashboard.js');

    test('the card sits above Build schedule and the module is loaded before the page script', () => {
        assert.ok(html.indexOf('id="sections-card"') > 0);
        assert.ok(html.indexOf('id="sections-card"') < html.indexOf('id="build-card"'));
        const mod = html.indexOf('shared/js/schedule/sectionlist.js');
        assert.ok(mod > 0 && mod < html.search(/src="departmentdashboard\.js"/));
    });
    test('the list is redrawn with the table, and also when no term is chosen', () => {
        assert.ok(/function renderOfferings\(\)[\s\S]*?renderSectionList\(\);/.test(js));
        assert.ok(/OFFERINGS = \[\];\s*PENDING = \[\];\s*renderSectionList\(\);/.test(js));
    });
    test('View selects the section below and scrolls to it; Print opens a window', () => {
        assert.ok(js.includes('function viewSection('));
        assert.ok(js.includes("$('build-card')?.scrollIntoView"));
        assert.ok(js.includes('function printSection('));
        assert.ok(js.includes('data-section-view'));
        assert.ok(js.includes('data-section-print'));
    });
    test('unsaved edits are flagged and the numbers come from saved rows', () => {
        assert.ok(js.includes('DIRTY.has(s.section)'));
        assert.ok(js.includes('SL.summarize(OFFERINGS, subjectById)'));
    });
    test('ids are unique on the page', () => {
        const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
        for (const id of ['sections-card', 'sections-body', 'sections-note', 'build-card'])
            assert.equal(ids.filter(i => i === id).length, 1, id);
    });
});
