// finishbanner.test.mjs
// After "Approve ready", the last step stays in view as a SHORT banner: how many were approved, how many need a
// decision, one line per subject (code and reason), and "Reject it now". While it shows, the longer system check note
// is left out, so the same subject and reason are not written twice. (shared/js/enrolment/systemcheck.js finishHtml and
// the Faculty page.) The reject dialog opens empty: no auto-filled reason.
//
//   node --test tests/finishbanner.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SC = require('../shared/js/enrolment/systemcheck.js');
const RR = require('../shared/js/enrolment/rejectreason.js');
const clash = require('../shared/js/schedule/scheduleconflicts.js').meetingsClash;
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const sched = (days, a, b, section = 'BSIT-1A') => ({ schedule_days: days, start_time: a, end_time: b, section });
const row = (id, code, status, remarks, offering) => ({ id, status, remarks, subject: { code, title: code + ' title', units: 3 }, offering: offering || null });

describe('the banner: when it shows, and how short it is', () => {
    test('after the ready subjects were approved, with only a flagged one left', () => {
        const h = SC.finishHtml([
            row(1, 'A', 'approved', null), row(2, 'B', 'approved', null), row(3, 'C', 'approved', null), row(4, 'D', 'approved', null),
            row(5, 'IT-WEBDEV11', 'flagged', 'CC-INTCOM11 must be passed first.'),
        ], clash, 29);
        assert.match(h, /4 approved/);
        assert.match(h, /1 needs your decision/);
        assert.match(h, /<strong>IT-WEBDEV11<\/strong> · CC-INTCOM11 must be passed first\./);
        assert.match(h, /data-reject-warned="29"/);
        assert.match(h, /Reject it now/);
    });
    test('it is short: no explanation paragraph, no title of the subject, one line per subject', () => {
        const h = SC.finishHtml([row(1, 'A', 'approved', null), row(2, 'B', 'flagged', 'x'), row(3, 'C', 'flagged', 'y')], clash, 7);
        assert.doesNotMatch(h, /cannot be approved|is then asked|reason\. The student/i);
        assert.doesNotMatch(h, /B title|C title/);
        assert.equal((h.match(/<li>/g) || []).length, 2);
        assert.ok(h.replace(/<[^>]+>/g, '').length < 160, 'the banner text should stay short');
    });
    test('several left: plural wording', () => {
        const h = SC.finishHtml([row(1, 'A', 'approved', null), row(2, 'B', 'flagged', 'x'), row(3, 'C', 'flagged', 'y')], clash, 7);
        assert.match(h, /1 approved/);
        assert.match(h, /2 need your decision/);
        assert.match(h, /Reject them now/);
    });
    test('nothing approved yet: no approved count, but still the list', () => {
        const h = SC.finishHtml([row(1, 'A', 'flagged', 'x')], clash, 1);
        assert.doesNotMatch(h, /approved/);
        assert.match(h, /1 needs your decision/);
    });
    test('a schedule clash is listed with the subject it overlaps', () => {
        const h = SC.finishHtml([
            row(1, 'MATH 101', 'valid', null, sched('MW', '10:00:00', '11:30:00')),
            row(2, 'ENGL 100', 'valid', null, sched('MW', '11:00:00', '12:30:00')),
        ], clash, 3);
        assert.match(h, /2 need your decision/);
        assert.match(h, /Schedule clash with ENGL 100\./);
        assert.match(h, /Schedule clash with MATH 101\./);
    });
    test('NOT shown while a subject without a warning is still waiting ("Approve ready" does that job)', () => {
        assert.equal(SC.finishHtml([row(1, 'A', 'valid', null), row(2, 'B', 'flagged', 'x')], clash, 1), '');
    });
    test('not shown when nothing is left, or when nothing has a warning', () => {
        assert.equal(SC.finishHtml([row(1, 'A', 'approved', null)], clash, 1), '');
        assert.equal(SC.finishHtml([row(1, 'A', 'valid', null)], clash, 1), '');
        assert.equal(SC.finishHtml([], clash, 1), '');
    });
    test('reasons and codes are escaped, never injected as markup', () => {
        const h = SC.finishHtml([row(1, '<b>X</b>', 'flagged', '<img src=x onerror=alert(1)>')], clash, '1"><script>');
        assert.doesNotMatch(h, /<img|<b>X|<script>/);
    });
});

describe('the longer note gives way to the banner, and its footer is one short line', () => {
    const flaggedOnly = [row(1, 'A', 'approved', null), row(2, 'IT-WEBDEV11', 'flagged', 'CC-INTCOM11 must be passed first.', sched('F', '08:00:00', '11:00:00'))];
    test('the page shows the banner OR the note, never both', () => {
        const js = read('features/faculty/facultydashboard.js');
        assert.match(js, /: \(finish \|\| note\) \+ renderRequestTable\(items\);/);   // (a withdrawn plan shows its own closed note instead)
    });
    test('the attention note still works on its own, when the banner is not shown', () => {
        const withReady = [row(1, 'A', 'valid', null, sched('MW', '08:00:00', '09:30:00')), row(2, 'B', 'flagged', 'Prereq missing.', sched('F', '08:00:00', '11:00:00'))];
        assert.equal(SC.finishHtml(withReady, clash, 1), '');
        assert.match(SC.noteHtml(withReady, clash), /1 of 2 subjects needs your attention/);
    });
    test('the footer is one short line, and the long sentence is gone', () => {
        const h = SC.noteHtml(flaggedOnly, clash);
        assert.match(h, /Checked: prerequisites, curriculum, schedule\./);
        assert.doesNotMatch(h, /Checked for every subject|You are still the final approver/);
    });
    test('it still says honestly when the schedule could not be checked', () => {
        const h = SC.noteHtml([row(1, 'A', 'flagged', 'x', null), row(2, 'B', 'valid', null, sched('MW', '08:00:00', '09:30:00'))], clash);
        assert.match(h, /Schedule clashes could not be checked for a subject with no section time/);
    });
});

describe('the reject dialog opens empty again: no auto-filled reason', () => {
    test('the dialog has no prefill and no preset, and the page does not pass one', () => {
        const dialog = read('shared/js/enrolment/rejectreason.js');
        const page = read('features/faculty/facultydashboard.js');
        assert.doesNotMatch(dialog, /prefill|preset|presetFor/);
        assert.doesNotMatch(page, /prefill|preset|presetFor|warnReason|data-warn/);
        assert.equal(RR.presetFor, undefined);
    });
    test('the quick picks and the required reason are unchanged', () => {
        assert.deepEqual(RR.REASONS.map(r => r.key), ['prereq', 'clash', 'full', 'load', 'term', 'other']);
        assert.equal(RR.validate('').ok, false);
        assert.equal(RR.validate('A prerequisite for this subject has not been passed yet.').ok, true);
    });
});

describe('the Faculty page', () => {
    const js = read('features/faculty/facultydashboard.js');
    test('"Reject it now" rejects every subject left, one dialog each, and stops cleanly on cancel', () => {
        const fn = js.match(/async function rejectWarnedSubjects\(requestId\) \{[\s\S]*?\n\}/)[0];
        assert.match(fn, /not\('status', 'in', '\(approved,rejected\)'\)/);
        assert.match(fn, /todo\.length !== data\.length/);                    // refuses if a subject can still be approved
        assert.match(fn, /Reject \$\{k \+ 1\} of \$\{todo\.length\}/);
        assert.match(fn, /if \(reason === null\) return;/);
        assert.match(fn, /await reviewRequestItem\(item\.id, 'rejected', reason\)/);
        assert.match(js, /rejectWarned\) return rejectWarnedSubjects\(Number\(rejectWarned\.dataset\.rejectWarned\)\)/);
    });
    test('the banner is built from the plan on every redraw', () => {
        assert.match(js, /SC\.finishHtml\(items, window\.ScheduleConflicts\?\.meetingsClash, req\.id\)/);
    });
});
