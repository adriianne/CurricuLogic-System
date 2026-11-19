// electivestanding.test.mjs
// db/121: the year-standing footnotes of the printed BSIT 2024-2025 elective lists are stored as rules (19 Nov 2026).
//   **  must finish all 1st year to 2nd year courses -> standing 22;  ***  must finish all 1st year to 3rd year courses -> standing 32.
//   node --test tests/electivestanding.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/121_elective_standing_rules.sql', import.meta.url), 'utf8');

describe('db/121', () => {
    test('the five ** courses are standing 22 and the three *** courses are standing 32, as the prospectus footnotes say', () => {
        const threshold = (code) => { const m = new RegExp("\\('" + code + "',\\s*(\\d+)\\)").exec(sql); return m ? Number(m[1]) : null; };
        for (const c of ['ELPYTHON', 'FREFORLAN', 'FREIP', 'FRETRNDS', 'FREKYI']) assert.equal(threshold(c), 22, c);
        for (const c of ['ELAI', 'ELASI', 'FRECERT']) assert.equal(threshold(c), 32, c);
    });
    test('each rule has the shape of the existing standing rules: type standing, no prerequisite subject, group 1', () => {
        assert.match(sql, /select s\.id, null, 'standing', 'and', 1, t\.threshold/);
    });
    test('only the BSIT 2024-2025 curriculum (prospectus 30) is changed', () => {
        assert.match(sql, /where s\.prospectus_id = 30/);
    });
    test('safe to run twice: a rule that already exists is not added again', () => {
        assert.match(sql, /not exists \(\s+select 1 from public\.prerequisite p\s+where p\.subject_id = s\.id and p\.requirement_type = 'standing' and p\.threshold_value = t\.threshold\)/);
    });
    test('the slots are not touched', () => {
        for (const c of ['IT-EL1', 'IT-EL2', 'IT-EL3', 'IT-FRE1', 'IT-FRE2', 'IT-FRE3']) assert.doesNotMatch(sql.slice(sql.indexOf('insert into')), new RegExp(`'${c}'`));
    });
    test('the file says it was applied', () => assert.match(sql, /APPLIED 19 Nov 2026/));
});
