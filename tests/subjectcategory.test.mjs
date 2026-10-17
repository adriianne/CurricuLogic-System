// subjectcategory.test.mjs
// Cleaning the "kind of course" the AI reader returns, so only values the database accepts are ever saved.
//
//   node --test tests/subjectcategory.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../shared/js/subjectcategory.js');

describe('clean', () => {
    test('the five database values pass through', () => {
        for (const v of ['GE', 'COMMON_COMPUTING', 'PROFESSIONAL_IT', 'ELECTIVE', 'OTHER']) assert.equal(C.clean(v), v);
    });

    test('case, spaces and dashes do not matter', () => {
        assert.equal(C.clean('ge'), 'GE');
        assert.equal(C.clean(' Common Computing '), 'COMMON_COMPUTING');
        assert.equal(C.clean('professional-it'), 'PROFESSIONAL_IT');
    });

    test('the wording of a summary line maps to its value', () => {
        assert.equal(C.clean('General Education Courses'), 'GE');
        assert.equal(C.clean('Core Computing Courses'), 'COMMON_COMPUTING');
        assert.equal(C.clean('Professional IT Courses'), 'PROFESSIONAL_IT');
        assert.equal(C.clean('IT Elective'), 'ELECTIVE');
    });

    test('anything else is no category, never a guess', () => {
        for (const v of [null, undefined, '', '   ', 'banana', 42, {}, 'GE; DROP TABLE subject']) assert.equal(C.clean(v), null);
    });

    test('every value it returns is one the database accepts', () => {
        const ok = new Set(C.CATEGORIES);
        for (const v of ['GE', 'core computing', 'professional', 'electives', 'general education']) assert.ok(ok.has(C.clean(v)));
    });
});
