// subjectcode.test.mjs
// How a subject code is cleaned and compared.
//
//   node --test tests/subjectcode.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SC = require('../shared/js/subjectcode.js');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('clean', () => {
    test('real codes keep the style they were written in', () => {
        for (const code of ['ENGL 101', 'CC-DATACOM22', 'IT-NETWORK31', 'CRIM OJT 411', 'PE 101', 'IT-EL______']) {
            assert.equal(SC.clean(code), code);
        }
    });

    test('lower case, extra spaces and edge spaces are tidied', () => {
        assert.equal(SC.clean('  engl   101 '), 'ENGL 101');
        assert.equal(SC.clean('cc-datacom22'), 'CC-DATACOM22');
    });

    test('every kind of dash becomes a hyphen', () => {
        assert.equal(SC.clean('HUM – REP 101'), 'HUM - REP 101');   // en dash
        assert.equal(SC.clean('HUM — REP 101'), 'HUM - REP 101');   // em dash
        assert.equal(SC.clean('cc‑intcom11'), 'CC-INTCOM11');       // non-breaking hyphen
        assert.equal(SC.clean('cc−intcom11'), 'CC-INTCOM11');       // minus sign
    });

    test('full-width letters and digits become normal ones', () => {
        assert.equal(SC.clean('ＥＮＧＬ １０１'), 'ENGL 101');
    });

    test('invisible characters are dropped', () => {
        assert.equal(SC.clean('EN​GL 101'), 'ENGL 101');
        assert.equal(SC.clean('ENGL 101\u0000'), 'ENGL 101');
    });

    test('null and undefined are an empty code', () => {
        assert.equal(SC.clean(null), '');
        assert.equal(SC.clean(undefined), '');
    });
});

describe('key: what makes two codes the same subject', () => {
    test('separators and case do not matter', () => {
        const same = ['ENGL 101', 'ENGL-101', 'ENGL101', 'engl  101', 'ENGL–101', 'ＥＮＧＬ１０１'];
        for (const c of same) assert.equal(SC.key(c), 'ENGL101', c);
    });

    test('different letters or digits are different subjects', () => {
        assert.notEqual(SC.key('ENGL 101'), SC.key('ENGL 102'));
        assert.notEqual(SC.key('CC-INTCOM11'), SC.key('CC-INTCOM12'));
        assert.notEqual(SC.key('PE 101'), SC.key('PE 1011'));
    });

    test('an empty or symbol-only code has an empty key', () => {
        assert.equal(SC.key(''), '');
        assert.equal(SC.key('---'), '');
    });
});

describe('problem', () => {
    test('real codes are acceptable', () => {
        for (const code of ['ENGL 101', 'CC-INTCOM11', 'IT-EL______', 'ELPHP1', 'PE 1']) {
            assert.equal(SC.problem(code), null, code);
        }
    });

    test('a code must be present and start with a letter', () => {
        assert.match(SC.problem(''), /required/);
        assert.match(SC.problem('   '), /required/);
        assert.match(SC.problem('123123'), /starting with a letter/);
        assert.match(SC.problem('-ENGL'), /starting with a letter/);
    });

    test('markup, symbols and emoji are refused', () => {
        for (const code of ['<b>X</b>', 'ENGL=101', 'ENGL/101', 'ENGL.101', 'EN\u{1F600}GL 101', 'ENGL;101']) {
            assert.match(SC.problem(code), /letters, digits/, code);
        }
    });

    test('20 characters is the limit', () => {
        assert.equal(SC.problem('A'.repeat(20)), null);
        assert.match(SC.problem('A'.repeat(21)), /at most 20/);
    });
});

describe('the curriculum builder uses it', () => {
    const src = readFileSync(resolve(ROOT, 'features/curriculum/curriculum_builder.js'), 'utf8');

    test('no code is upper-cased by hand any more', () => {
        const hand = src.split('\n').filter(l => /code/i.test(l) && /toUpperCase\(\)/.test(l));
        assert.deepEqual(hand, [], 'use SC.clean() to store a code and SC.key() to compare');
    });

    test('the department page loads the helper before the builder', () => {
        const html = readFileSync(resolve(ROOT, 'features/department/departmentdashboard.html'), 'utf8');
        const helper = html.indexOf('shared/js/subjectcode.js');
        const builder = html.indexOf('curriculum/curriculum_builder.js');
        assert.ok(helper > 0 && builder > helper);
    });
});
