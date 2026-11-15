// schedulecards.test.mjs
// The Department schedule as cards: each subject's lecture on top, its laboratory below on a connector
// (shared/js/schedule/schedulecards.js and the page that draws them). Same data fields as the old table row.
//
//   node --test tests/schedulecards.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SCd = require('../shared/js/schedule/schedulecards.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const subjects = {
    1: { id: 1, code: 'IT 201',  lab_units: 1 },
    2: { id: 2, code: 'IT 211',  lab_units: 1 },
    3: { id: 3, code: 'PE 102',  lab_units: 0 },
};
const subjectOf = (id) => subjects[id] || null;
const row = (key, subject_id, meeting_type, days = '', start = '', end = '') =>
    ({ __key: key, subject_id, meeting_type, schedule_days: days, start_time: start, end_time: end });

describe('grouping: one group per subject, lecture on top, laboratory below', () => {
    test('a lecture and its lab land in the same group, in that order, wherever they were in the list', () => {
        const gs = SCd.groups([row('a', 1, 'LAB'), row('b', 3, 'LEC'), row('c', 1, 'LEC')], subjectOf);
        assert.equal(gs.length, 2);
        assert.deepEqual(gs[0].lec.map(r => r.__key), ['c']);
        assert.deepEqual(gs[0].lab.map(r => r.__key), ['a']);
        assert.deepEqual(gs[1].lec.map(r => r.__key), ['b']);
    });
    test('groups keep the order their subject first appears', () => {
        const gs = SCd.groups([row('a', 3, 'LEC'), row('b', 1, 'LEC'), row('c', 2, 'LEC')], subjectOf);
        assert.deepEqual(gs.map(g => g.subjectId), [3, 1, 2]);
    });
    test('a subject with a lab is marked as needing one; one without is not', () => {
        const gs = SCd.groups([row('a', 1, 'LEC'), row('b', 3, 'LEC')], subjectOf);
        assert.equal(gs[0].needsLab, true);
        assert.equal(gs[1].needsLab, false);
    });
    test('a row with no subject chosen yet stands alone, and several of them do not merge', () => {
        const gs = SCd.groups([row('a', null, 'LEC'), row('b', '', 'LEC'), row('c', undefined, 'LEC')], subjectOf);
        assert.equal(gs.length, 3);
        assert.ok(gs.every(g => g.subjectId === null));
    });
    test('an unknown meeting type is kept, not dropped', () => {
        const gs = SCd.groups([row('a', 1, 'REC')], subjectOf);
        assert.deepEqual(gs[0].other.map(r => r.__key), ['a']);
    });
    test('no rows, no groups', () => {
        assert.deepEqual(SCd.groups([], subjectOf), []);
        assert.deepEqual(SCd.groups(null, subjectOf), []);
    });
});

describe('ready: days, start and end filled in', () => {
    test('timed means all three, and blank days do not count', () => {
        assert.equal(SCd.isTimed(row('a', 1, 'LEC', 'MW', '08:00', '09:30')), true);
        assert.equal(SCd.isTimed(row('a', 1, 'LEC', '  ', '08:00', '09:30')), false);
        assert.equal(SCd.isTimed(row('a', 1, 'LEC', 'MW', '', '09:30')), false);
        assert.equal(SCd.isTimed(null), false);
    });
    test('a subject with a lab is ready only when the lecture AND the lab are timed', () => {
        const only = SCd.groups([row('a', 1, 'LEC', 'MW', '08:00', '09:30')], subjectOf)[0];
        assert.equal(SCd.state(only), 'partial');
        const both = SCd.groups([row('a', 1, 'LEC', 'MW', '08:00', '09:30'), row('b', 1, 'LAB', 'MW', '09:30', '12:30')], subjectOf)[0];
        assert.equal(SCd.state(both), 'ready');
    });
    test('a lab subject whose lab row is missing is not ready, even with a timed lecture', () => {
        const g = SCd.groups([row('a', 1, 'LEC', 'MW', '08:00', '09:30')], subjectOf)[0];
        assert.equal(g.lab.length, 0);
        assert.notEqual(SCd.state(g), 'ready');
    });
    test('a subject with no lab is ready on its lecture alone', () => {
        assert.equal(SCd.state(SCd.groups([row('a', 3, 'LEC', 'F', '13:00', '15:00')], subjectOf)[0]), 'ready');
    });
    test('nothing filled in is empty', () => {
        assert.equal(SCd.state(SCd.groups([row('a', 1, 'LEC'), row('b', 1, 'LAB')], subjectOf)[0]), 'empty');
    });
    test('progress counts finished subjects, ignoring rows with no subject', () => {
        const gs = SCd.groups([
            row('a', 1, 'LEC', 'MW', '08:00', '09:30'), row('b', 1, 'LAB', 'MW', '09:30', '12:30'),   // ready
            row('c', 2, 'LEC', 'TTh', '08:00', '09:30'),                                               // lab missing
            row('d', 3, 'LEC', 'F', '13:00', '15:00'),                                                 // ready
            row('e', null, 'LEC'),
        ], subjectOf);
        assert.deepEqual(SCd.progress(gs), { done: 2, total: 3 });
    });
    test('it agrees with the progress line the page already shows', () => {
        const js = read('features/department/departmentdashboard.js');
        // the page's own rule: LEC, and LAB where the subject has one, both with days and times
        assert.match(js, /const need = Number\(s\.lab_units\) > 0 \? \['LEC', 'LAB'\] : \['LEC'\];/);
    });
});

describe('the page', () => {
    const js = read('features/department/departmentdashboard.js');
    const html = read('features/department/departmentdashboard.html');
    test('loads the grouping script before the page script', () => {
        const tag = (name) => html.indexOf(`<script src="${name}"></script>`);
        assert.ok(tag('../../shared/js/schedule/schedulecards.js') > 0);
        assert.ok(tag('../../shared/js/schedule/schedulecards.js') < tag('departmentdashboard.js'));
    });
    test('the table is gone: cards, with the buttons in a bar under them', () => {
        assert.doesNotMatch(js, /sched-edit-table|sched-add-row/);
        assert.match(js, /class="sched-cards"/);
        assert.match(js, /class="sched-add-bar"/);
    });
    test('every field keeps the name it had in the table row, so loading and saving are unchanged', () => {
        const card = js.match(/function rowHtmlFor[\s\S]*?\n\}/)[0];
        for (const f of ['meeting_type', 'subject_id', 'edp_code', 'schedule_days', 'start_time', 'end_time', 'room']) {
            assert.ok(card.includes(`data-field="${f}"`), f + ' missing from the card');
        }
        assert.match(card, /data-row="\$\{o\.__key\}"/);
        assert.match(card, /data-drop="\$\{o\.__key\}"/);
    });
    test('typing and choosing find the row from the card, not from a table row', () => {
        assert.equal((js.match(/e\.target\.closest\('\[data-row\]'\)/g) || []).length, 2);
        assert.doesNotMatch(js, /closest\('tr\[data-row\]'\)/);
    });
    test('the clash note and the ready mark are repainted on the card as the department types', () => {
        const refresh = js.match(/function refreshScheduleChecks\(\) \{[\s\S]*?\n\}/)[0];
        assert.match(refresh, /card\.classList\.toggle\('sched-clash'/);
        assert.match(refresh, /card\.querySelector\('\[data-clash-for\]'\)/);
        assert.match(refresh, /card\.classList\.toggle\('is-ready', ready\)/);
    });
    test('a lab subject with no lab row yet shows a placeholder, so the missing half is visible', () => {
        assert.match(js, /Laboratory not added yet/);
        assert.match(js, /g\.needsLab && !g\.lab\.length && g\.lec\.length/);
    });
    test('the lab hangs below its lecture on a connector; a subject with no lab says so', () => {
        assert.match(js, /class="sched-under has-link">/);
        assert.match(js, /No laboratory/);
    });
    test('free text in a card is escaped', () => {
        const card = js.match(/function rowHtmlFor[\s\S]*?\n\}/)[0];
        assert.match(card, /escapeHtml\(o\.edp_code/);
        assert.match(card, /escapeHtml\(o\.schedule_days/);
        assert.match(card, /escapeHtml\(o\.room/);
    });
});

describe('warnings under a card: said once, short, with the full list on hover', () => {
    test('a row is named by its subject, else its EDP code, else what it is', () => {
        assert.equal(SCd.meetingLabel('CC-COMPROG11', { meeting_type: 'LAB' }), 'CC-COMPROG11 LAB');
        assert.equal(SCd.meetingLabel(null, { meeting_type: 'LAB', edp_code: ' SAMPLE-57A-LAB ' }), 'SAMPLE-57A-LAB');
        assert.equal(SCd.meetingLabel(undefined, { meeting_type: 'LAB' }), 'an unassigned LAB');
        assert.equal(SCd.meetingLabel('', { edp_code: '' }), 'an unassigned LEC');
    });
    test('the same sentence is kept once, in order, and blanks are dropped', () => {
        assert.deepEqual(SCd.uniqueReasons(['a.', 'b.', 'a.', ' ', null, 'b.', 'c.']), ['a.', 'b.', 'c.']);
        assert.deepEqual(SCd.uniqueReasons(null), []);
    });
    test('one warning shows as it is; several show the first and "+N more"; the hover text has them all', () => {
        assert.deepEqual(SCd.clashSummary(['Overlaps X on F.']), { text: 'Overlaps X on F.', title: 'Overlaps X on F.', count: 1 });
        const s = SCd.clashSummary(['Overlaps X on F.', 'Overlaps X on F.', 'Room 4 is in use.', 'Room 5 is in use.']);
        assert.equal(s.text, 'Overlaps X on F. +2 more');
        assert.equal(s.title, 'Overlaps X on F.\nRoom 4 is in use.\nRoom 5 is in use.');
        assert.equal(s.count, 3);
    });
    test('no warning gives nothing', () => {
        assert.deepEqual(SCd.clashSummary([]), { text: '', title: '', count: 0 });
        assert.deepEqual(SCd.clashSummary(undefined), { text: '', title: '', count: 0 });
    });
});

describe('the Department page draws the compact rows', () => {
    const js = read('features/department/departmentdashboard.js');
    const css = read('shared/css/prospectus.css');
    test('the page uses the shared label, the shared summary, and never repeats a sentence', () => {
        assert.match(js, /const rowLabel = \(r\) => window\.CurriculogicScheduleCards\.meetingLabel\(subjectById\(r\.subject_id\)\?\.code, r\);/);
        assert.match(js, /const sum = window\.CurriculogicScheduleCards\.clashSummary\(reasons\);/);
        assert.match(js, /note\.title = sum\.title;/);
        assert.match(js, /if \(!out\.get\(r\.__key\)\.includes\(text\)\) out\.get\(r\.__key\)\.push\(text\);/);
    });
    test('a column header row is drawn once above the cards, and is hidden from screen readers', () => {
        assert.match(js, /<div class="sched-colhead" aria-hidden="true">/);
        assert.match(js, /return colHead \+ window\.CurriculogicScheduleCards\.groups/);
    });
    test('the units note and the "No lab" chip share one slot; the full words stay on the chip as its title', () => {
        assert.match(js, /<span class="sched-meta">/);
        assert.match(js, /<span class="sched-chip" title="No laboratory">No lab<\/span>/);
    });
    test('wide cards are one line, decided by the cards\' own width, with a sticky header', () => {
        assert.match(css, /\.sched-cards \{ container-type: inline-size; container-name: sched; \}/);
        assert.match(css, /@container sched \(min-width: 1090px\) \{/);
        assert.match(css, /position: sticky; top: var\(--topbar, 4rem\)/);
        assert.match(css, /\.sched-card > \*, \.sched-card-head > \*, \.sched-card-fields input \{ grid-row: 1; \}/);
        assert.match(css, /\.sched-card \.sched-card-clash \{ grid-column: 1 \/ -1; grid-row: 2;/);
    });
    test('the form clips its corners without becoming a scroll box, or the header could not stick', () => {
        assert.match(css, /\.sched-form \{[^}]*overflow: clip;/);
    });
    test('the field names stay for screen readers when they are hidden on a wide row', () => {
        assert.match(css, /\.sched-card-fields label span \{\s*position: absolute; width: 1px; height: 1px;/);
    });
});

describe('on a phone the cards stay inside their box', () => {
    // At 390 px a one-column grid kept its auto minimum width, set by the longest subject name in the drop-down, so each
    // card measured 441 px inside a 291 px box and the Days and End fields were cut off (seen 14 Nov).
    const css = read('shared/css/prospectus.css');
    test('the list of groups and each group are columns that may shrink to the box', () => {
        assert.match(css, /\.sched-cards \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
        assert.match(css, /\.sched-group \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
    });
});
