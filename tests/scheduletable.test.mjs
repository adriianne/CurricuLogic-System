// The schedule table under Cura's answer about when subjects meet.
//   node --test tests/scheduletable.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('../shared/engine/engine.js');
const P = require('../shared/engine/preferences.js');
const explain = require('../ai-assist/eligibility-explanation.js');
const T = require('../shared/js/scheduletable.js');

let id = 1;
const subj = (code) => ({ id: id++, code, title: `${code} title`, units: '3.00', year_level: 1, term: 1, is_elective: false, elective_type: null });
const meet = (s, section, type, days, start, end) => ({ subject_id: s.id, section, meeting_type: type, schedule_days: days, start_time: start, end_time: end });
const summaryOf = (subjects, offerings) => {
    const result = engine.assess({ id: 's', year_level: 1 }, [], { subjects, rules: [], offerings }, { maxUnits: 24, maxUnitsGraduating: 27, term: 1 });
    return explain.summarizeForExplanation(P.apply(result, {}), 'Ann');
};

test('each suggested subject gets its section, days and times, with the lab on its own line', () => {
    const a = subj('AA');
    const s = summaryOf([a], [meet(a, '2A', 'LEC', 'TTH', '08:00', '09:30'), meet(a, '2A', 'LAB', 'F', '13:00', '16:00')]);
    const t = T.build(s);
    assert.equal(t.rows.length, 1);
    const r = t.rows[0];
    assert.equal(r.code, 'AA');
    assert.equal(r.section, '2A');
    assert.deepEqual(r.meetings.map(m => m.kind), ['LEC', 'LAB']);
    assert.equal(r.meetings[0].text, 'TTH 8:00 AM–9:30 AM');
    assert.equal(r.meetings[1].text, 'LAB F 1:00 PM–4:00 PM');
    assert.equal(r.when, 'TTH 8:00 AM–9:30 AM + LAB F 1:00 PM–4:00 PM');
});

test('the section shown is the one the planner chose, not just the first', () => {
    const a = subj('BA'), b = subj('BB');
    // BA in 1-A clashes with BB's only section, so BA goes in 1-B
    const s = summaryOf([a, b], [
        meet(a, '1-A', 'LEC', 'MW', '08:00', '09:30'), meet(a, '1-B', 'LEC', 'TTH', '08:00', '09:30'),
        meet(b, '1-A', 'LEC', 'MW', '08:30', '10:00'),
    ]);
    const t = T.build(s);
    assert.equal(t.rows.find(r => r.code === 'BA').section, '1-B');
    assert.equal(t.rows.find(r => r.code === 'BB').section, '1-A');
    assert.deepEqual(t.notInPlan, []);
});

test('a subject that did not fit is listed with what it clashes with', () => {
    const a = subj('CA'), b = subj('CB');
    const s = summaryOf([a, b], [meet(a, '1-A', 'LEC', 'MW', '08:00', '09:30'), meet(b, '1-A', 'LEC', 'MW', '08:30', '10:00')]);
    const t = T.build(s);
    assert.equal(t.rows.length, 1);
    assert.equal(t.notInPlan.length, 1);
    assert.match(t.notInPlan[0].reason, /^clashes with C[AB] \(1-A\)$/);
});

test('a subject with no schedule yet has no times but still appears', () => {
    const a = subj('DA');
    const t = T.build(summaryOf([a], []));
    assert.equal(t.rows.length, 1);
    assert.equal(t.rows[0].section, null);
    assert.deepEqual(t.rows[0].meetings, []);
    assert.equal(t.rows[0].when, '');
});

test('an empty or missing summary gives an empty table, not an error', () => {
    for (const s of [null, {}]) {
        const t = T.build(s);
        assert.deepEqual([t.rows, t.notInPlan], [[], []]);
    }
});

test('nothing in the table is markup: text is plain strings for the page to escape', () => {
    const a = subj('<img src=x onerror=1>');
    const t = T.build(summaryOf([a], [meet(a, '<b>', 'LEC', 'MW', '08:00', '09:00')]));
    assert.equal(typeof t.rows[0].code, 'string');
    assert.equal(t.rows[0].code, '<img src=x onerror=1>');
    assert.equal(t.rows[0].section, '<b>');
});

// ---- alternative plans ----
const withAlternatives = () => {
    const a = subj('XA'), b = subj('XB'), c = subj('XC');
    const offerings = [
        meet(a, '1A', 'LEC', 'MW', '08:00', '09:30'), meet(a, '1B', 'LEC', 'MW', '14:00', '15:30'),
        meet(b, '1A', 'LEC', 'TTH', '08:00', '09:30'), meet(b, '1B', 'LEC', 'TTH', '14:00', '15:30'),
        meet(c, '1A', 'LEC', 'MW', '09:00', '10:30'),
    ];
    return summaryOf([a, b, c], offerings);
};

test('the summary offers a named alternative with how it differs', () => {
    const s = withAlternatives();
    assert.ok(s.alternatives.length >= 1);
    const alt = s.alternatives[0];
    assert.equal(typeof alt.label, 'string');
    assert.ok(Array.isArray(alt.placed) && alt.placed.length === 3);
    assert.ok(alt.changes.length >= 1, 'says what changes');
});

test('a named alternative is drawn with its own sections', () => {
    const s = withAlternatives();
    const alt = s.alternatives[0];
    const t = T.build(s, alt.label);
    assert.equal(t.label, alt.label);
    assert.equal(t.rows.length, alt.placed.length);
    for (const p of alt.placed) {
        assert.equal(t.rows.find(r => r.code === p.code).section, p.section);
    }
    // and it differs from the current plan in at least one section
    const main = T.build(s);
    assert.notDeepEqual(t.rows.map(r => r.section), main.rows.map(r => r.section));
});

test('the label is matched without regard to case or spacing', () => {
    const s = withAlternatives();
    const label = s.alternatives[0].label;
    assert.equal(T.build(s, '  ' + label.toUpperCase() + ' ').label, label);
});

test('an unknown or stale option gives an empty table, never the wrong one', () => {
    const t = T.build(withAlternatives(), 'Weekend classes');
    assert.deepEqual([t.rows, t.notInPlan, t.label], [[], [], null]);
});

test('with no real alternative the list is empty', () => {
    const a = subj('YA');
    const s = summaryOf([a], [meet(a, '1A', 'LEC', 'MW', '08:00', '09:30')]);
    assert.deepEqual(s.alternatives, []);
});

test('the plan table rows carry the section and when each subject meets', () => {
    const a = subj('PA'), b = subj('PB');
    const s = summaryOf([a, b], [
        meet(a, '2A', 'LEC', 'TTH', '08:00', '09:30'), meet(a, '2A', 'LAB', 'F', '13:00', '16:00'),
        meet(b, '1B', 'LEC', 'MW', '10:00', '11:30'),
    ]);
    const rows = T.planRows(s);
    assert.deepEqual(rows.map(r => r.code), s.recommended.map(r => r.code));
    const ra = rows.find(r => r.code === 'PA');
    assert.equal(ra.section, '2A');
    assert.equal(ra.when, 'TTH 8:00 AM–9:30 AM + LAB F 1:00 PM–4:00 PM');
    assert.deepEqual(ra.meetings.map(m => m.kind), ['LEC', 'LAB']);
    // the summary's own figures are untouched
    assert.equal(ra.units, s.recommended.find(r => r.code === 'PA').units);
    assert.equal(ra.title, 'PA title');
});

test('before a schedule is published the plan table rows have no times', () => {
    const a = subj('NA');
    const rows = T.planRows(summaryOf([a], []));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].section, null);
    assert.equal(rows[0].when, '');
    assert.deepEqual(rows[0].meetings, []);
});

test('an empty or missing summary gives no plan rows', () => {
    assert.deepEqual(T.planRows(null), []);
    assert.deepEqual(T.planRows({}), []);
});

test('by day: Monday to Saturday in order, each day in time order, a "MW" meeting under both days', () => {
    const a = subj('DA'), b = subj('DB'), c = subj('DC');
    const s = summaryOf([a, b, c], [
        meet(a, '1', 'LEC', 'MW', '10:00', '11:30'),
        meet(b, '1', 'LEC', 'MW', '08:00', '09:30'), meet(b, '1', 'LAB', 'SAT', '13:00', '16:00'),
        meet(c, '1', 'LEC', 'TTH', '08:00', '09:30'),
    ]);
    const { days, unscheduled } = T.byDay(T.build(s).rows);
    assert.deepEqual(days.map(d => d.name), ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    assert.deepEqual(days[0].items.map(i => i.code), ['DB', 'DA']);          // Monday, 8:00 before 10:00
    assert.deepEqual(days[2].items.map(i => i.code), ['DB', 'DA']);          // Wednesday too
    assert.deepEqual(days[1].items.map(i => i.code), ['DC']);                // Tuesday
    assert.deepEqual(days[4].items, []);                                     // Friday is free
    assert.equal(days[5].items[0].kind, 'LAB');                              // "SAT" is Saturday only
    assert.equal(days[5].items[0].span, '1:00 PM–4:00 PM');
    assert.deepEqual(unscheduled, []);
});

test('by day: Sunday appears only when something meets on it, and subjects with no time are kept aside', () => {
    const a = subj('EA');
    const s = summaryOf([a], [meet(a, '1', 'LEC', 'SUN', '09:00', '10:00')]);
    const rows = [...T.build(s).rows, { code: 'EB', title: 'EB title', section: null, meetings: [] }];
    const withSunday = T.byDay(rows);
    assert.equal(withSunday.days.at(-1).name, 'Sunday');
    assert.deepEqual(withSunday.unscheduled.map(u => u.code), ['EB']);

    const none = T.byDay([]);
    assert.equal(none.days.length, 6);
    assert.deepEqual(none.unscheduled, []);
});
