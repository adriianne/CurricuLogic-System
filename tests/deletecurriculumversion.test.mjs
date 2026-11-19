// deletecurriculumversion.test.mjs
// db/119: a curriculum version activated by mistake can be deleted; students move to the curriculum that stays.
//   node --test tests/deletecurriculumversion.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('db/119_delete_curriculum_version.sql');
const fn = sql.slice(sql.indexOf('create or replace function public.delete_curriculum_version'));
const js = read('features/department/departmentdashboard.js');
const html = read('features/department/departmentdashboard.html');

describe('db/119 delete_curriculum_version', () => {
    test('Department staff of the programme only, with one answer for "missing" and "not yours"', () => {
        assert.match(fn, /auth\.uid\(\) is null or v\.id is null or not public\.department_covers_program\(v\.program_id\)/);
    });
    test('refuses a version that has grades, grade uploads or advising requests under it', () => {
        assert.match(fn, /from academic_record where subject_id = any\(sub_ids\)/);
        assert.match(fn, /from grade_file_row\s+where subject_id = any\(sub_ids\)/);
        assert.match(fn, /from request_item\s+where subject_id = any\(sub_ids\)/);
        assert.match(fn, /from request\s+where prospectus_id = target_id/);
        assert.match(fn, /Deleting it would damage their transcripts\. Retire it instead/);
    });
    test('the active version falls back to the newest other published, not retired, version; none means refused', () => {
        assert.match(fn, /published_at is not null and retired_at is null\s+order by academic_year desc/);
        assert.match(fn, /there is no other published curriculum to fall back to/);
    });
    test('a version that is not active sends its students to the active one', () => {
        assert.match(fn, /where program_id = v\.program_id and is_active and id <> target_id/);
        assert.match(fn, /update university_student set prospectus_id = dest\.id where prospectus_id = target_id/);
    });
    test('check mode (confirm false) returns before anything is changed', () => {
        assert.ok(fn.indexOf("'check', true") < fn.indexOf('update university_student'));
        assert.ok(fn.indexOf("'check', true") < fn.indexOf('delete from subject'));
    });
    test('the old version is deleted before the fallback becomes active (one active version per programme)', () => {
        assert.ok(fn.indexOf('delete from prospectus where id = target_id') < fn.indexOf('set is_active = true'));
    });
    test('every deletion is written to the audit log', () => {
        assert.match(fn, /insert into audit_log[\s\S]{0,200}'DELETE_CURRICULUM'/);
    });
    test('the db/118 trigger is lifted only for the version being deleted', () => {
        assert.match(sql, /current_setting\('curriculogic\.allow_version_delete', true\), ''\) <> old\.id::text/);
        assert.match(fn, /set_config\('curriculogic\.allow_version_delete', target_id::text, true\)/);
    });
    test('anon cannot run it; the file says it was applied', () => {
        assert.match(sql, /revoke execute on function public\.delete_curriculum_version\(integer, boolean\) from public, anon/);
        assert.match(sql, /APPLIED 17 Nov 2026/);
    });
});

describe('the Prospectus page', () => {
    test('a published or active version goes through delete_curriculum_version, a draft through the original', () => {
        assert.match(js, /\(v\.published_at \|\| v\.is_active\) \? 'delete_curriculum_version' : 'delete_draft_prospectus'/);
    });
    test('Delete sits beside Default on the active row', () => {
        assert.match(js, /<span class="dim">Default<\/span>\s*<button class="btn-small" data-delete=/);
    });
    test('the confirmation lists what happens to students and the default', () => {
        assert.match(js, /student\(s\) on it will be moved to the \$\{target\} curriculum/);
        assert.match(js, /becomes the active curriculum again/);
        assert.match(html, /have grades under cannot be deleted; retire it instead/);
    });
    test('the message after deleting says where the students went', () => {
        const deletedMessage = new Function(js.slice(js.indexOf('function deletedMessage'), js.indexOf('/* Populate and open the delete-draft modal')) + '; return deletedMessage;')();
        const m = deletedMessage('2025–2026', { subjects: 83, students: 4, moves_to_year: 2024, becomes_active: false });
        assert.match(m, /Deleted 2025–2026: 83 subjects removed\./);
        assert.match(m, /4 students were moved to the 2024–2025 curriculum\./);
        const a = deletedMessage('2025–2026', { subjects: 83, students: 0, moves_to_year: 2024, becomes_active: true });
        assert.match(a, /The 2024–2025 curriculum is the default again\./);
        assert.doesNotMatch(a, /student/);
        assert.match(deletedMessage('2024–2025', { subjects: 5, prerequisites: 2 }), /5 subjects, 2 rules removed\./);
    });
});
