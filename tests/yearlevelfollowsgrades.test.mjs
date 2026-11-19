// yearlevelfollowsgrades.test.mjs
// db/120: a student's year level follows what they have passed (19 Nov 2026). It used to be written once and never change.
//   node --test tests/yearlevelfollowsgrades.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/120_year_level_follows_grades.sql', import.meta.url), 'utf8');
const fnFor = sql.slice(sql.indexOf('create or replace function public.year_level_for'), sql.indexOf('create or replace function public.sync_student_year_level'));

describe('the rule: year_level_for', () => {
    test('counts only PASSED subjects, matched by subject code, each once', () => {
        assert.match(fnFor, /r\.status = 'PASSED' and rs\.code = m\.code/);
        assert.match(fnFor, /select coalesce\(sum\(m\.units\), 0\) as units\s+from mine m\s+where exists/);   // exists, so a retake never counts twice
    });
    test('uses the units of the student\'s OWN curriculum, year by year, cumulatively', () => {
        assert.match(fnFor, /join st on s\.prospectus_id = st\.prospectus_id/);
        assert.match(fnFor, /sum\(units\) over \(order by year_level\) as cum_units/);
        assert.match(fnFor, /cum\.year_level < \(select max\(year_level\) from per_year\) and earned\.units >= cum\.cum_units/);
    });
    test('the year is 1 plus the thresholds met, and never below 1', () => {
        assert.match(fnFor, /coalesce\(\s*1 \+ \(select count\(\*\)/);
    });
});

describe('never goes down, only the student\'s own row is touched', () => {
    test('every update is guarded by "derived is greater than stored"', () => {
        const guards = sql.match(/y\.lvl > coalesce\(u\.year_level, 0\)/g) || [];
        assert.ok(guards.length >= 3, 'the two trigger functions and the catch-up each guard the update');
        assert.match(sql, /public\.year_level_for\(u\.id\) > coalesce\(u\.year_level, 0\)/);
    });
});

describe('when it runs', () => {
    test('statement-level triggers on insert, update and delete of academic_record: one pass per upload, not per row', () => {
        assert.match(sql, /create trigger academic_record_year_ins after insert on public\.academic_record\s+referencing new table as new_rows for each statement/);
        assert.match(sql, /create trigger academic_record_year_upd after update on public\.academic_record\s+referencing new table as new_rows for each statement/);
        assert.match(sql, /create trigger academic_record_year_del after delete on public\.academic_record\s+referencing old table as old_rows for each statement/);
    });
    test('only the students named in the changed rows are recomputed', () => {
        assert.match(sql, /select distinct student_id from new_rows/);
        assert.match(sql, /select distinct student_id from old_rows/);
    });
    test('students who already have grades are brought up to date once, in the same file', () => {
        assert.match(sql, /One-time catch-up/);
    });
});

describe('who can run it', () => {
    test('anon can run none of the functions; the trigger functions and the sync are not callable by signed-in users either', () => {
        assert.match(sql, /revoke execute on function public\.year_level_for\(uuid\) from public, anon/);
        assert.match(sql, /revoke execute on function public\.sync_student_year_level\(uuid\) from public, anon, authenticated/);
        assert.match(sql, /revoke execute on function public\.sync_year_levels_new\(\), public\.sync_year_levels_old\(\) from public, anon, authenticated/);
    });
    test('the file says it was applied', () => assert.match(sql, /APPLIED 19 Nov 2026/));
});
