// changecurriculum.test.mjs
// Curriculum of a student: published only (db/105), Admin only with an audit entry (db/106). These tests read the files.
//   node --test tests/changecurriculum.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const pub = read('db/105_curriculum_published_only.sql');
const adminSql = read('db/106_curriculum_admin_only.sql');
const reg = read('features/registrar/registrardashboard.js');
const adm = read('features/admin/admindashboard.js');

describe('a draft curriculum is never given to a student', () => {
    test('curriculum_for matches a year only when the curriculum is published', () => {
        assert.match(pub, /pr\.academic_year = p_year and pr\.published_at is not null/);
        assert.match(pub, /p_year is null and pr\.is_active/);
    });
    test('the Admin lists offer only published curricula', () => {
        assert.match(adm, /\.not\('published_at', 'is', null\)/);
    });
});

describe('only the System Administrator changes a curriculum, and it is audited', () => {
    test('set_student_curriculum refuses everyone but the administrator', () => {
        assert.match(adminSql, /if not public\.is_system_admin\(\) then[\s\S]{0,200}errcode = '42501'/);
        assert.doesNotMatch(adminSql, /is_registrar_of_student/);
    });
    test('a change writes UPDATE_CURRICULUM with the old and the new curriculum; no change writes nothing', () => {
        assert.match(adminSql, /if s\.prospectus_id is distinct from pid then/);
        assert.match(adminSql, /'UPDATE_CURRICULUM', 'university_student'/);
        assert.match(adminSql, /old_values, new_values/);
    });
    test('the Registrar page has no Change control any more', () => {
        assert.doesNotMatch(reg, /set_student_curriculum/);
        assert.doesNotMatch(reg, /data-change-curriculum/);
    });
    test('the Admin Students table shows the curriculum and has a Curriculum control for approved students', () => {
        assert.match(adm, /<th>Curriculum<\/th>/);
        assert.match(adm, /s\.program_id && \(s\.approval_status \?\? 'pending'\) === 'approved'/);
        assert.match(adm, /rpc\('set_student_curriculum', \{ p_student_id: s\.student_id, p_year: year \}\)/);
    });
    test('choosing the curriculum the student is already on changes nothing', () => {
        assert.match(adm, /The student is already on that curriculum\./);
    });
});
