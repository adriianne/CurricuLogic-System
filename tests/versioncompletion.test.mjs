// versioncompletion.test.mjs
// Prospectus page: a note under the Students count of a non-default version saying how many have finished it (17 Nov 2026).
//   node --test tests/versioncompletion.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const js = readFileSync(new URL('../features/department/departmentdashboard.js', import.meta.url), 'utf8');
const src = js.slice(js.indexOf('function completionSummary'), js.indexOf('async function loadCompletion'));
const { completionSummary, completionNote } = new Function(src + '; return { completionSummary, completionNote };')();
const SL = createRequire(import.meta.url)('../shared/js/records/studentlist.js');

const rec = (units) => [{ subject_id: 1, status: 'PASSED', units }];
const stu = (id, verified = true) => ({ id, record_verified: verified });

describe('completionSummary', () => {
    test('a student has finished when passed units reach the curriculum total', () => {
        const c = completionSummary([stu('a'), stu('b')], new Map([['a', rec(100)], ['b', rec(99)]]), 100, SL.progress);
        assert.deepEqual(c, { students: 2, completed: 1, noRecord: 0 });
    });
    test('a student without a verified record is "no record yet", never counted as unfinished or finished', () => {
        const c = completionSummary([stu('a'), stu('b', false)], new Map([['a', rec(100)], ['b', rec(100)]]), 100, SL.progress);
        assert.deepEqual(c, { students: 2, completed: 1, noRecord: 1 });
    });
    test('a curriculum with no units finishes no one', () => {
        assert.equal(completionSummary([stu('a')], new Map([['a', rec(0)]]), 0, SL.progress).completed, 0);
    });
});

describe('completionNote', () => {
    test('everyone finished: says so and that it can be retired', () => {
        const n = completionNote({ students: 12, completed: 12, noRecord: 0 });
        assert.equal(n.done, true);
        assert.match(n.text, /All 12 completed it/);
        assert.match(n.text, /can be retired/);
    });
    test('some finished: a count, not the retire message', () => {
        const n = completionNote({ students: 12, completed: 9, noRecord: 0 });
        assert.equal(n.done, false);
        assert.equal(n.text, '9 of 12 completed');
    });
    test('everyone with a record finished but some have none: no retire message, the gap is named', () => {
        const n = completionNote({ students: 5, completed: 4, noRecord: 1 });
        assert.equal(n.done, false);
        assert.match(n.text, /4 of 5 completed/);
        assert.match(n.text, /1 with no record yet/);
    });
    test('nobody finished yet: nothing to say', () => {
        assert.equal(completionNote({ students: 5, completed: 0, noRecord: 0 }), null);
        assert.equal(completionNote({ students: 0, completed: 0, noRecord: 0 }), null);
    });
    test('only students with no record: says that', () => {
        assert.equal(completionNote({ students: 3, completed: 0, noRecord: 3 }).text, '3 with no record yet');
    });
});

describe('the page', () => {
    test('the note is only on a version that is not the default', () => {
        assert.match(js, /v\.student_count && !v\.is_active\s*\?\s*`<div data-completion=/);
        assert.match(js, /if \(v\.is_active \|\| !v\.student_count\) continue;/);
    });
    test('it is measured after the list is drawn', () => {
        assert.match(js, /renderVersions\(\);\s*renderSourceOptions\(\);\s*loadCompletion\(\);/);
    });
});
