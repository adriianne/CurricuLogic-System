// loginid8.test.mjs
// Found 5 Nov 2026 in the live E2E run: student IDs became 8 digits on 29 Oct (db/090), but the sign-in shape
// still allowed at most 7 digits after "uc-", so logging in with the ID (the very example the page shows,
// uc-24001187) was refused by the page and by the sign-in function.
//
//   node --test tests/loginid8.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const shapeOf = (src, name) => new RegExp(src.match(new RegExp('const ' + name + ' = (/.+/i);'))[1].slice(1, -2), 'i');

for (const [file, name] of [['shared/js/accounts/auth.js', 'STUDENT_SHAPE'], ['supabase/functions/sign-in/index.ts', 'STUDENT_ID']]) {
    test(`${file}: an 8-digit student ID with uc- is accepted`, () => {
        const re = shapeOf(read(file), name);
        assert.ok(re.test('uc-24001187'), 'the page\'s own example');
        assert.ok(re.test('UC-99000010'));
        assert.ok(re.test('uc-2401187'), 'an older 7-digit ID still works');
        assert.ok(!re.test('uc-240011871'), 'nine digits is not an ID');
        assert.ok(!re.test('24001187'), 'the prefix is required');
    });
}
