// nosectionsend.test.mjs
// A subject with no section posted cannot be sent: the enrollment form would have no schedule, EDP code or room.
// The server refuses it (every client), and the Build your plan page says so before sending.
//
//   node --test tests/nosectionsend.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../features/student/studentdashboard.js', import.meta.url), 'utf8');
const fn = readFileSync(new URL('../supabase/functions/submit-advising-request/index.ts', import.meta.url), 'utf8');
const core = readFileSync(new URL('../supabase/functions/submit-advising-request/core.js', import.meta.url), 'utf8');

describe('a plan with no section posted is not sent', () => {
    test('the rule engine marks a valid-looking subject with no section as noSection and unavailable', () => {
        assert.match(core, /if \(base\.offeringId == null\)/);
        assert.match(core, /unavailable: true, noSection: true/);
    });
    test('the function answers 422 with its own sentence, before the generic unavailable answer', () => {
        const noSec = fn.indexOf('e.noSection');
        const generic = fn.indexOf('e.unavailable');
        assert.ok(noSec > 0 && generic > 0 && noSec < generic);
        assert.match(fn, /No section is posted yet for: /);
        assert.match(fn, /json\(422/);
    });
    test('the page checks before it sends, names the subjects, and does not call the function', () => {
        const check = page.indexOf('i.offeringId == null');
        const invoke = page.indexOf("supabase.functions.invoke('submit-advising-request'", check);
        assert.ok(check > 0 && invoke > check);
        const block = page.slice(check, invoke);
        assert.match(block, /No section is posted yet for: /);
        assert.match(block, /return \{ ok: false/);
    });
});
