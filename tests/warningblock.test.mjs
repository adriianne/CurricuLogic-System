// warningblock.test.mjs
// A subject with a warning cannot be approved: flagged by the system, or in a schedule clash with another undecided
// subject. It can only be rejected. (shared/js/enrolment/systemcheck.js blocked(), db/112, the Faculty page.)
// Found 12 Nov 2026: one click approved a flagged subject and wiped the reason; the faculty then asked for a hard rule.
//
//   node --test tests/warningblock.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SC = require('../shared/js/enrolment/systemcheck.js');
const SchedC = require('../shared/js/schedule/scheduleconflicts.js');
const clash = SchedC.meetingsClash;
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const sched = (days, a, b, section = 'BSIT-1A') => ({ schedule_days: days, start_time: a, end_time: b, section });
const row = (id, code, status, remarks, offering) => ({ id, status, remarks, subject: { code, title: code + ' title', units: 3 }, offering: offering || null });

describe('blocked(): which subjects cannot be approved', () => {
    test('a flagged subject is blocked, whatever the flag says', () => {
        const b = SC.blocked([
            row(1, 'A', 'flagged', 'CC-INTCOM11 must be passed first.'),
            row(2, 'B', 'flagged', 'This subject is already passed.'),
            row(3, 'C', 'valid', null),
        ], clash);
        assert.deepEqual([...b.flagged].sort(), [1, 2]);
        assert.deepEqual([...b.ids].sort(), [1, 2]);
    });
    test('both subjects of a clash are blocked, and each names the other', () => {
        const b = SC.blocked([
            row(1, 'MATH 101', 'valid', null, sched('MW', '10:00:00', '11:30:00')),
            row(2, 'ENGL 100', 'valid', null, sched('MW', '11:00:00', '12:30:00')),
            row(3, 'PE 101', 'valid', null, sched('F', '13:00:00', '15:00:00')),
        ], clash);
        assert.deepEqual([...b.clashing].sort(), [1, 2]);
        assert.deepEqual(b.clashWith.get(1), ['ENGL 100']);
        assert.deepEqual(b.clashWith.get(2), ['MATH 101']);
        assert.equal(b.ids.has(3), false);
    });
    test('rejecting one of two clashing subjects frees the other', () => {
        const b = SC.blocked([
            row(1, 'MATH 101', 'rejected', 'This section clashes.', sched('MW', '10:00:00', '11:30:00')),
            row(2, 'ENGL 100', 'valid', null, sched('MW', '11:00:00', '12:30:00')),
        ], clash);
        assert.equal(b.ids.size, 0);
    });
    test('decided subjects are never blocked', () => {
        const b = SC.blocked([row(1, 'A', 'approved', null), row(2, 'B', 'rejected', 'Why.'), row(3, 'C', 'flagged', 'x')], clash);
        assert.deepEqual([...b.ids], [3]);
    });
    test('different days, or no section time, is not a clash', () => {
        assert.equal(SC.blocked([
            row(1, 'A', 'valid', null, sched('MW', '08:00:00', '09:30:00')),
            row(2, 'B', 'valid', null, sched('TTh', '08:00:00', '09:30:00')),
            row(3, 'C', 'valid', null, null),
        ], clash).ids.size, 0);
    });
    test('a subject that is flagged and in a clash is counted once', () => {
        const b = SC.blocked([
            row(1, 'A', 'flagged', 'Prereq.', sched('MW', '10:00:00', '11:30:00')),
            row(2, 'B', 'valid', null, sched('MW', '11:00:00', '12:30:00')),
        ], clash);
        assert.equal(b.ids.size, 2);
    });
});

describe('db/112', () => {
    const sql = read('db/112_flagged_cannot_be_approved.sql');
    test('the trigger function now refuses every flagged -> approved change, with no way round it', () => {
        const body = sql.match(/create or replace function public\.request_item_flag_guard[\s\S]*?\$\$;/)[0];
        assert.match(body, /raise exception 'A flagged subject cannot be approved/);
        assert.doesNotMatch(body, /\bif\b/);                       // no condition: always refused
        assert.doesNotMatch(body, /Approved despite flag/);
    });
    test('only a flagged -> approved change is caught; rejecting and approving ready subjects are untouched', () => {
        assert.match(sql, /when \(old\.status = 'flagged' and new\.status = 'approved'\)/);
    });
});

describe('the Faculty page', () => {
    const js = read('features/faculty/facultydashboard.js');
    test('"Approve anyway" is gone: no dialog, no override script', () => {
        assert.doesNotMatch(js, /CurriculogicFlagRules|data-approve-flagged|Approve anyway/);
        assert.equal(existsSync(new URL('../shared/js/enrolment/flagrules.js', import.meta.url)), false);
        assert.doesNotMatch(read('features/faculty/facultydashboard.html'), /flagrules\.js/);
    });
    test('a flagged or clashing row has a lock and only the reject button', () => {
        assert.match(js, /const lockedButtons = \(why\) =>/);
        assert.match(js, /lockedButtons\('Flagged by the system\. It can only be rejected\.'\)/);
        assert.match(js, /lockedButtons\('Clashes with ' \+ clashCodes \+ '\. Reject one of them first\.'\)/);
        const flaggedBranch = js.match(/else if \(item\.status === 'flagged'\) \{[\s\S]*?\} else if \(item\.status === 'approved'\)/)[0];
        assert.doesNotMatch(flaggedBranch, /data-approve-item=|data-approve-note-item=|\$\{itemButtons\}/);
    });
    test('the row says why under it, and a clash row says it cannot be approved until one is rejected', () => {
        assert.match(js, /Cannot be approved\.<\/strong>/);
        assert.match(js, /Cannot be approved until one of them is rejected\./);
    });
    test('a last check before saving refuses a flagged or clashing subject even if the screen was out of date', () => {
        assert.match(js, /async function approvalBlockedReason\(requestId, itemId\)/);
        assert.match(js, /if \(decision === 'approved'\) \{\s*const stop = await approvalBlockedReason\(item\.request_id, itemId\);/);
        assert.match(js, /b\.flagged\.has\(itemId\)/);
        assert.match(js, /b\.clashing\.has\(itemId\)/);
    });
    test('Approve all leaves out every subject with a warning, and says how many', () => {
        assert.match(js, /found\.filter\(i => !warn\.has\(i\.id\)\)/);
        assert.match(js, /\$\{n === 1 \? ' has' : 's have'\} a warning and cannot be approved/);
        assert.match(js, /\$\{left === 1 \? ' has' : 's have'\} a warning and can only be rejected/);
    });
    test('the top Approve button is off while any subject has a warning, and says to reject those first', () => {
        assert.match(js, /\.blocked\(undecided, window\.ScheduleConflicts\?\.meetingsClash\)\.ids\.size/);
        assert.match(js, /\$\{warnN \? 'disabled' : ''\}/);
        assert.match(js, /Reject \$\{warnN === 1 \? 'it' : 'them'\} first/);
        assert.doesNotMatch(js, /Approve \$\{readyN\} ready/);
    });
});
