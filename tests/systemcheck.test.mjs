// systemcheck.test.mjs
// The faculty "System check" note (shared/js/enrolment/systemcheck.js): shown only when it is true.
//
//   node --test tests/systemcheck.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SC = require('../shared/js/enrolment/systemcheck.js');
const SchedC = require('../shared/js/schedule/scheduleconflicts.js');
const clash = SchedC.meetingsClash;

const item = (status, days, start, end) => ({
    status,
    offering: days ? { schedule_days: days, start_time: start, end_time: end } : null,
});
const ok1 = item('valid', 'MW', '08:00:00', '09:30:00');
const ok2 = item('valid', 'MW', '10:00:00', '11:30:00');

describe('when the note shows', () => {
    test('every subject valid and no clash -> shown, with the schedule line', () => {
        const html = SC.noteHtml([ok1, ok2], clash);
        assert.match(html, /System check: all passed/);
        assert.match(html, /No schedule clashes/);
        assert.match(html, /final approver/);
    });
    test('a flagged subject -> not the green note (the attention note takes its place)', () => {
        const h = SC.noteHtml([ok1, item('flagged', 'MW', '13:00:00', '14:30:00')], clash);
        assert.doesNotMatch(h, /all passed/);
        assert.match(h, /need(s)? your attention/);
    });
    test('two sections that overlap -> no note', () => {
        const r = SC.summarize([ok1, item('valid', 'MW', '09:00:00', '10:30:00')], clash);
        assert.equal(r.show, false);
        assert.equal(r.clashes, 1);
    });
    test('same hours on different days is not a clash', () => {
        assert.equal(SC.summarize([ok1, item('valid', 'TTh', '08:00:00', '09:30:00')], clash).show, true);
    });
    test('nothing left to decide -> no note', () => {
        assert.equal(SC.noteHtml([item('approved', 'MW', '08:00:00', '09:30:00')], clash), '');
        assert.equal(SC.noteHtml([], clash), '');
    });
    test('decided rows are ignored: an old rejected clash does not hide the note', () => {
        const rejected = item('rejected', 'MW', '08:00:00', '09:30:00');
        assert.equal(SC.summarize([ok1, rejected], clash).show, true);
    });
});

describe('what the note claims', () => {
    test('a subject with no section time -> the schedule line is left out, not claimed', () => {
        const html = SC.noteHtml([ok1, item('valid', null)], clash);
        assert.match(html, /System check: all passed/);
        assert.doesNotMatch(html, /schedule clashes/);
    });
    test('never claims a unit limit or 100% correct', () => {
        const html = SC.noteHtml([ok1], clash);
        assert.doesNotMatch(html, /units/i);
        assert.doesNotMatch(html, /100%|guarantee|always correct/i);
    });
});

describe('wiring', () => {
    const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
    test('faculty page loads the module and uses it above the table', () => {
        assert.match(read('features/faculty/facultydashboard.html'), /systemcheck\.js/);
        assert.match(read('features/faculty/facultydashboard.js'), /CurriculogicSystemCheck/);
    });
});

describe('the note after a plan is decided', () => {
    const it = (status, units = 3) => ({ status, subject: { units } });
    const html = (items, opts) => SC.decisionHtml(items, opts);

    test('all approved: says approved, final, where the student sees it, and to print', () => {
        const h = html([it('approved'), it('approved'), it('approved', 2)]);
        assert.match(h, /Plan approved/);
        assert.match(h, /All 3 subjects \(8 units\) were approved/);
        assert.match(h, /final/);
        assert.match(h, /My requests/);
        assert.match(h, /Print the enrollment form below/);
    });
    test('partly approved: counts approved against not approved, and the form lists only the approved ones', () => {
        const h = html([it('approved'), it('rejected'), it('approved')]);
        assert.match(h, /Plan partly approved/);
        assert.match(h, /2 of 3 subjects \(6 units\) approved; 1 not approved/);
        assert.match(h, /lists only the approved subjects/);
        assert.match(h, /is-partial/);
    });
    test('none approved: says so, and does not talk about printing', () => {
        const h = html([it('rejected'), it('rejected')]);
        assert.match(h, /Plan not approved/);
        assert.match(h, /None of the 2 subjects was approved/);
        assert.doesNotMatch(h, /Print|enrollment form/);
        assert.match(h, /is-none/);
    });
    test('a single subject reads naturally', () => {
        assert.match(html([it('approved', 3)]), /The subject \(3 units\) was approved/);
        assert.match(html([it('approved', 1)]), /\(1 unit\)/);
    });
    test('nothing while anything is still undecided, for an empty plan, or for an old sent-back plan', () => {
        assert.equal(html([it('approved'), it('valid')]), '');
        assert.equal(html([it('flagged')]), '');
        assert.equal(html([]), '');
        assert.equal(html([it('approved')], { sentBack: true }), '');
    });
    test('never claims the student was notified', () => {
        for (const items of [[it('approved')], [it('approved'), it('rejected')], [it('rejected')]]) {
            assert.doesNotMatch(html(items), /notified|emailed|sent a notice/i);
        }
    });
    test('the system-check note and this one never show together', () => {
        const undecided = [{ status: 'valid', subject: { units: 3 }, offering: null }];
        assert.notEqual(SC.noteHtml(undecided, clash), '');
        assert.equal(SC.decisionHtml(undecided), '');
        const decided = [it('approved')];
        assert.equal(SC.noteHtml(decided, clash), '');
    });
    test('the Faculty page uses it above the table, with the sent-back check', () => {
        const js = readFileSync(new URL('../features/faculty/facultydashboard.js', import.meta.url), 'utf8');
        assert.match(js, /SC\.decisionHtml\(items, \{ sentBack: window\.CurriculogicRequestStatus\?\.sentBack\(req\) \}\)/);
    });
});

describe('the attention note: every warning with its reason', () => {
    const subj = (code, title) => ({ code, title, units: 3 });
    const row = (id, code, status, remarks, offering) => ({ id, status, remarks, subject: subj(code, code + ' title'), offering: offering || null });
    const sched = (days, a, b, section = 'BSIT-1A') => ({ schedule_days: days, start_time: a, end_time: b, section });
    const kindOf = (r) => (/already passed|already in progress|not found in the current curriculum|section is not offered/i.test(r || '') ? 'hard' : 'waivable');

    const plan = [
        row(1, 'CC-INTCOM11', 'valid', null, sched('MW', '08:00:00', '09:30:00')),
        row(2, 'MATH 101', 'valid', null, sched('MW', '10:00:00', '11:30:00')),
        row(3, 'IT 111', 'flagged', 'CC-INTCOM11 must be passed first.', sched('TTh', '08:00:00', '09:30:00')),
        row(4, 'PE 101', 'flagged', 'This subject is already passed.', sched('F', '13:00:00', '15:00:00')),
    ];

    test('says how many need attention out of how many, and how many passed', () => {
        const h = SC.noteHtml(plan, clash, kindOf);
        assert.match(h, /System check: 2 of 4 subjects need your attention/);
        assert.match(h, /The other 2 subjects passed every check/);
        assert.match(h, /is-attention/);
    });
    test('lists every flagged subject with the reason the system gave', () => {
        const h = SC.noteHtml(plan, clash, kindOf);
        assert.match(h, /IT 111<\/strong> \u00b7 IT 111 title/);
        assert.match(h, /CC-INTCOM11 must be passed first\./);
        assert.match(h, /This subject is already passed\./);
    });
    test('says plainly that a flagged subject cannot be approved: it can only be rejected', () => {
        const h = SC.noteHtml(plan, clash);
        assert.equal((h.match(/Cannot be approved: reject it/g) || []).length, 2);   // both flagged subjects, whatever the flag
        assert.doesNotMatch(h, /approve it anyway|written reason/i);
    });
    test('a clash says neither subject can be approved until one is rejected', () => {
        const clashing = [
            row(1, 'MATH 101', 'valid', null, sched('MW', '10:00:00', '11:30:00')),
            row(2, 'ENGL 100', 'valid', null, sched('MW', '11:00:00', '12:30:00')),
        ];
        assert.match(SC.noteHtml(clashing, clash), /Neither can be approved until one of them is rejected/);
    });
    test('lists a schedule clash with both subjects and both times', () => {
        const clashing = [
            row(1, 'MATH 101', 'valid', null, sched('MW', '10:00:00', '11:30:00', 'BSIT-1A')),
            row(2, 'ENGL 100', 'valid', null, sched('MW', '11:00:00', '12:30:00', 'BSIT-1B')),
            row(3, 'PE 101', 'valid', null, sched('F', '13:00:00', '15:00:00')),
        ];
        const h = SC.noteHtml(clashing, clash, kindOf);
        assert.match(h, /System check: 2 of 3 subjects need your attention/);
        assert.match(h, /MATH 101<\/strong> and <strong>ENGL 100<\/strong> have a schedule clash/);
        assert.match(h, /MW 10:00\u201311:30 \(BSIT-1A\) overlaps MW 11:00\u201312:30 \(BSIT-1B\)/);
        assert.match(h, /The other subject passed every check/);
    });
    test('a subject that is both flagged and in a clash is counted once', () => {
        const both = [
            row(1, 'A', 'flagged', 'A prerequisite is missing.', sched('MW', '10:00:00', '11:30:00')),
            row(2, 'B', 'valid', null, sched('MW', '11:00:00', '12:30:00')),
        ];
        const h = SC.noteHtml(both, clash, kindOf);
        assert.match(h, /2 of 2 subjects need your attention/);
        assert.match(h, /No subject passed every check/);
    });
    test('names what was checked, and says so when the schedule could not be checked', () => {
        assert.match(SC.noteHtml(plan, clash, kindOf), /Checked: prerequisites, curriculum, schedule\./);
        const noTime = [row(1, 'A', 'flagged', 'Why.', null), row(2, 'B', 'valid', null, sched('MW', '08:00:00', '09:30:00'))];
        assert.match(SC.noteHtml(noTime, clash, kindOf), /Schedule clashes could not be checked/);
    });
    test('reasons are escaped, never injected as markup', () => {
        const h = SC.noteHtml([row(1, '<b>X</b>', 'flagged', '<img src=x onerror=alert(1)>', null)], clash, kindOf);
        assert.doesNotMatch(h, /<img|<b>X/);
        assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
    });
    test('green only when nothing needs attention; nothing at all once everything is decided', () => {
        assert.match(SC.noteHtml([row(1, 'A', 'valid', null, sched('MW', '08:00:00', '09:30:00'))], clash, kindOf), /all passed/);
        assert.equal(SC.noteHtml([row(1, 'A', 'approved', null, null)], clash, kindOf), '');
    });
    test('only the undecided subjects are reported: a decided flagged one is not listed again', () => {
        const h = SC.noteHtml([row(1, 'A', 'rejected', 'Old reason.', null), row(2, 'B', 'flagged', 'Prereq missing.', null)], clash, kindOf);
        assert.match(h, /1 of 1 subject needs your attention/);
        assert.doesNotMatch(h, /Old reason/);
    });
});

describe('the decided note keeps every reason on record', () => {
    const subj = (code) => ({ code, title: code + ' title', units: 3 });
    const done = (code, status, remarks) => ({ status, remarks, subject: subj(code) });
    test('lists why a subject was rejected', () => {
        const h = SC.decisionHtml([done('A', 'approved', null), done('B', 'rejected', 'A prerequisite for this subject has not been passed yet.')]);
        assert.match(h, /B<\/strong> \u00b7 B title/);
        assert.match(h, /Rejected: A prerequisite for this subject has not been passed yet\./);
    });
    test('lists a note left when approving a subject', () => {
        const h = SC.decisionHtml([
            done('B', 'approved', 'Take this together with NCM 105'),
            done('C', 'approved', null),
        ]);
        assert.match(h, /Note: Take this together with NCM 105/);
        assert.doesNotMatch(h, /despite a flag/);
    });
    test('no list when there is nothing on record, and reasons are escaped', () => {
        assert.doesNotMatch(SC.decisionHtml([done('A', 'approved', null)]), /sys-record/);
        const h = SC.decisionHtml([done('A', 'rejected', '<script>x</script>')]);
        assert.doesNotMatch(h, /<script>/);
    });
});

describe('the reason a rejection starts from', () => {
    const it2 = (id, code, status, remarks, days, start, end) => ({
        id, status, remarks, subject: { code, title: code + ' title' },
        offering: days ? { schedule_days: days, start_time: start, end_time: end, section: 'S' } : null,
    });
    const flaggedA = it2(1, 'IT-WEBDEV11', 'flagged', 'CC-INTCOM11 must be passed first', 'TTH', '09:00:00', '10:00:00');
    const flaggedB = it2(2, 'MATH 100', 'flagged', 'This subject is already passed.', 'TTH', '10:00:00', '11:00:00');
    const readyC = it2(3, 'CC-COMPROG11', 'valid', null, 'MW', '07:30:00', '09:00:00');
    const clashX = it2(4, 'STS 101', 'valid', null, 'TTH', '09:00:00', '10:30:00');
    const clashY = it2(5, 'LIT 101', 'valid', null, 'TTH', '10:00:00', '11:30:00');

    test('a plan with flagged subjects: one short line each, in the system own words', () => {
        assert.equal(SC.rejectNote([flaggedA, flaggedB, readyC], clash),
            'IT-WEBDEV11: CC-INTCOM11 must be passed first.\nMATH 100: This subject is already passed.');
    });
    test('a clash gives one line for the pair, with the time', () => {
        assert.equal(SC.rejectNote([readyC, clashX, clashY], clash),
            'STS 101 and LIT 101 overlap (TTH 09:00–10:30). Please choose another section for one of them.');
    });
    test('a flagged subject with no reason recorded still gets a line', () => {
        assert.equal(SC.rejectNote([it2(9, 'X 1', 'flagged', '', null)], clash), 'X 1: Flagged by the system.');
    });
    test('nothing is filled in when no subject has a warning, or all are decided', () => {
        assert.equal(SC.rejectNote([readyC], clash), '');
        assert.equal(SC.rejectNote([it2(1, 'A', 'rejected', 'no', null)], clash), '');
        assert.equal(SC.rejectNote([], clash), '');
        assert.equal(SC.rejectNote(null, clash), '');
    });
    test('a decided subject no longer counts (rejecting one of two clashing subjects frees the other)', () => {
        const done = { ...clashY, status: 'rejected' };
        assert.equal(SC.rejectNote([clashX, done], clash), '');
        assert.equal(SC.itemNote([clashX, done], 4, clash), '');
    });
    test('one subject: its own reason without the code, or what it overlaps with', () => {
        assert.equal(SC.itemNote([flaggedA, flaggedB], 1, clash), 'CC-INTCOM11 must be passed first.');
        assert.equal(SC.itemNote([readyC, clashX, clashY], 4, clash), 'Overlaps with LIT 101 (TTH 09:00–10:30). Please choose another section.');
    });
    test('a ready subject, or one that is not in the plan, gets nothing', () => {
        assert.equal(SC.itemNote([readyC, clashX, clashY], 3, clash), '');
        assert.equal(SC.itemNote([readyC], 99, clash), '');
    });
    test('a long note is shortened to fit the 500-character limit, and every subject stays in it', () => {
        const many = Array.from({ length: 8 }, (_, k) => it2(100 + k, 'SUBJ-' + k, 'flagged', 'x'.repeat(120), null));
        const note = SC.rejectNote(many, clash);
        assert.ok(note.length <= 500, 'length ' + note.length);
        many.forEach((m, k) => assert.match(note, new RegExp('SUBJ-' + k)));
    });
});
