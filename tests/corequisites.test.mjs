// corequisites.test.mjs
// The "goes with" side of the curriculum builder: turning the reader's co-requisite codes into rows, and saving
// a co-requisite as a co-requisite rather than a pre-requisite.
//
//   node --test tests/corequisites.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../shared/js/corequisites.js');

const row = (code) => ({ uid: code, code });
const a = row('NCM 104'), b = row('NCM 105'), c = row('NCM 106');
const byCode = new Map([a, b, c].map(r => [r.code, r]));
const lookup = (code) => byCode.get(code);

describe('resolve', () => {
    test('codes become the subjects they name, in order', () => {
        const { targets, missing } = C.resolve(['NCM 105', 'NCM 106'], a, lookup);
        assert.deepEqual(targets, [b, c]);
        assert.deepEqual(missing, []);
    });

    test('a code that is no subject in the document is reported, not guessed', () => {
        const { targets, missing } = C.resolve(['NCM 105', 'NCM 999'], a, lookup);
        assert.deepEqual(targets, [b]);
        assert.deepEqual(missing, ['NCM 999']);
    });

    test('a subject is never its own co-requisite, and a repeated code counts once', () => {
        const { targets } = C.resolve(['NCM 104', 'NCM 105', 'NCM 105'], a, lookup);
        assert.deepEqual(targets, [b]);
    });

    test('blank, missing and non-array input is no co-requisites', () => {
        for (const v of [undefined, null, 'NCM 105', 42, [], ['', '  ', null]]) {
            assert.deepEqual(C.resolve(v, a, lookup), { targets: [], missing: [] });
        }
    });

    test('a code with stray spaces still finds its subject', () => {
        const trimmed = C.resolve(['  NCM 105 '], a, (code) => byCode.get(code));
        assert.deepEqual(trimmed.targets, [b]);
        assert.deepEqual(trimmed.missing, []);
    });
});

describe('requirementType', () => {
    test('a plain rule is a pre-requisite', () => assert.equal(C.requirementType({ uid: 1 }), 'prerequisite'));
    test('a goes-with rule is a co-requisite', () => assert.equal(C.requirementType({ uid: 1, co: true }), 'co_requisite'));
    test('a year standing is a standing, even if it somehow carries co', () => {
        assert.equal(C.requirementType({ standing: 2 }), 'standing');
        assert.equal(C.requirementType({ standing: 3, co: true }), 'standing');
    });
    test('nothing is a pre-requisite, not an error', () => assert.equal(C.requirementType(undefined), 'prerequisite'));
});

describe('isCoRequisiteRow', () => {
    test('recognises a saved co-requisite', () => {
        assert.equal(C.isCoRequisiteRow({ requirement_type: 'co_requisite' }), true);
        assert.equal(C.isCoRequisiteRow({ requirement_type: 'prerequisite' }), false);
        assert.equal(C.isCoRequisiteRow({ requirement_type: 'standing' }), false);
        assert.equal(C.isCoRequisiteRow(null), false);
    });
});
