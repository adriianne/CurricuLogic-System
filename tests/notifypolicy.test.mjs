// notifypolicy.test.mjs
// Found 6 Nov 2026 in the live E2E run: no notification reached a student after the adviser decided a plan,
// because the insert policy still required an advisee_assignment row (db/023) and advisers are now matched by
// programme (db/024). db/097 uses the same rule that lets the faculty member review the request.
//
//   node --test tests/notifypolicy.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/097_faculty_notify_by_program.sql', import.meta.url), 'utf8');

test('the faculty notification policy follows the programme rule, not a per-student assignment', () => {
    assert.match(sql, /public\.is_adviser_of_student\(r\.student_id\)/);
    assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /advisee_assignment/);
});

test('the notice must still be about a real request of that same student', () => {
    assert.match(sql, /r\.id = notification\.related_request_id/);
    assert.match(sql, /us\.user_id = notification\.user_id/);
});
