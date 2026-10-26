// enrollmentsheet.test.mjs
// The enrolment sheet a student brings to the EDP office: EDP codes, sections, times, and backups.
//
//   node --test tests/enrollmentsheet.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SC = require('../shared/js/schedule/scheduleconflicts.js');
const S = require('../shared/js/enrolment/enrollmentsheet.js');

const row = (section, days, start, end, edp, extra = {}) => ({
    section, schedule_days: days, start_time: start, end_time: end, edp_code: edp, meeting_type: 'LEC', ...extra,
});
const group = (...rows) => SC.groupSections(rows)[0];

describe('edpCodes and whenText', () => {
    test('a lecture and a lab give two EDP codes, in order, each once', () => {
        const g = group(row('A-1', 'TTH', '08:00', '09:30', '4101'), row('A-1', 'F', '13:00', '16:00', '4102', { meeting_type: 'LAB' }));
        assert.deepEqual(S.edpCodes(g), ['4101', '4102']);
    });

    test('blank, missing and repeated codes are dropped', () => {
        const g = group(row('A-1', 'MW', '08:00', '09:30', '4101'), row('A-1', 'F', '08:00', '09:30', ' 4101 '), row('A-1', 'S', '08:00', '09:30', null));
        assert.deepEqual(S.edpCodes(g), ['4101']);
        assert.deepEqual(S.edpCodes(null), []);
    });

    test('the time reads like the schedule everywhere else', () => {
        const g = group(row('A-1', 'TTH', '08:00', '09:30', '1'), row('A-1', 'F', '13:00', '16:00', '2', { meeting_type: 'LAB' }));
        assert.equal(S.whenText(g), 'TTH 8:00 AM–9:30 AM + LAB F 1:00 PM–4:00 PM');
    });
});

describe('build', () => {
    const items = [
        { code: 'A', title: 'Alpha', units: 3, section: group(row('A-1', 'MW', '08:00', '09:30', '4101')),
          backups: [group(row('A-2', 'TTH', '10:00', '11:30', '4102')), group(row('A-3', 'F', '13:00', '16:00', '4103'))] },
        { code: 'B', title: 'Beta', units: '2', section: group(row('B-1', 'MW', '10:00', '11:30', '4201')), backups: [] },
    ];

    test('one row per subject with its EDP code, section and backups', () => {
        const sheet = S.build({ items });
        assert.equal(sheet.rows.length, 2);
        assert.deepEqual(sheet.rows[0].edp, ['4101']);
        assert.equal(sheet.rows[0].section, 'A-1');
        assert.deepEqual(sheet.rows[0].backups.map(b => b.edp[0]), ['4102', '4103']);
        assert.deepEqual(sheet.rows[1].backups, []);
    });

    test('totals the units even when one arrives as text', () => {
        assert.equal(S.build({ items }).totalUnits, 5);
    });

    test('says so when no section carries an EDP code', () => {
        const none = [{ code: 'A', title: 'Alpha', units: 3, section: group(row('A-1', 'MW', '08:00', '09:30', null)), backups: [] }];
        assert.equal(S.build({ items: none }).missingEdp, true);
        assert.equal(S.build({ items }).missingEdp, false);
        assert.equal(S.build({ items: [] }).missingEdp, false);
    });
});

describe('text and html', () => {
    const sheet = S.build({ items: [
        { code: 'A', title: 'Alpha & <Beta>', units: 3, section: group(row('A-1', 'MW', '08:00', '09:30', '4101')),
          backups: [group(row('A-2', 'TTH', '10:00', '11:30', '4102'))] },
        { code: 'B', title: 'Beta', units: 3, section: group(row('B-1', 'MW', '10:00', '11:30', '4201')), backups: [] },
    ] });
    const info = { student: { name: 'Athena Po', id: '2401187' }, program: 'BSIT', term: { number: 1, year: 2023 } };

    test('the plain text lists EDP codes and backups, and the reminder that the EDP office confirms seats', () => {
        const t = S.text(sheet, info);
        assert.match(t, /Athena Po · 2401187/);
        assert.match(t, /1st Semester, AY 2023–2024/);
        assert.match(t, /EDP 4101 · A-1/);
        assert.match(t, /Backup 1: EDP 4102 · A-2 · TTH 10:00 AM–11:30 AM/);
        assert.match(t, /Backup: none without a clash/);
        assert.match(t, /Total: 6 units/);
        assert.ok(t.includes(S.NOTE));
    });

    test('the printable page escapes what it prints', () => {
        const h = S.html(sheet, info);
        assert.ok(h.includes('Alpha &amp; &lt;Beta&gt;'));
        assert.ok(!h.includes('<Beta>'));
        assert.match(h, /<th>Backup 1<\/th>/);
        assert.match(h, /4102/);
        assert.ok(h.includes('Printed '));
    });

    test('a student name with markup cannot break the page', () => {
        const h = S.html(sheet, { student: { name: '<script>alert(1)</script>', id: '1' } });
        assert.ok(!h.includes('<script>alert'));
    });
});

describe('the request reference on the printed sheet', () => {
    const sheet = S.build({ items: [] });
    test('is printed in the header when given, escaped', () => {
        const h = S.html(sheet, { ref: 'CL-2026-000021' });
        assert.match(h, /Ref\. <strong>CL-2026-000021<\/strong>/);
        assert.ok(!S.html(sheet, { ref: '<b>x</b>' }).includes('<b>x</b>'));
    });
    test('is left out when there is none', () => {
        assert.ok(!S.html(sheet, {}).includes('Ref.'));
    });
});
