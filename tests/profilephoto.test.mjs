// profilephoto.test.mjs
// Which pictures are accepted, the square that is cut out, and where it is stored.
//
//   node --test tests/profilephoto.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../shared/js/profilephoto.js');

describe('problem', () => {
    test('accepts a JPEG, PNG or WebP of reasonable size', () => {
        for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
            assert.equal(P.problem({ type, size: 2_000_000 }), '');
        }
    });

    test('refuses nothing chosen, other file types, empty and huge files', () => {
        assert.notEqual(P.problem(null), '');
        assert.notEqual(P.problem({ type: 'image/gif', size: 1000 }), '');
        assert.notEqual(P.problem({ type: 'application/pdf', size: 1000 }), '');
        assert.notEqual(P.problem({ type: 'image/svg+xml', size: 1000 }), '');
        assert.notEqual(P.problem({ type: 'image/jpeg', size: 0 }), '');
        assert.notEqual(P.problem({ type: 'image/jpeg', size: P.MAX_PICKED + 1 }), '');
    });
});

describe('squareCrop', () => {
    test('a landscape picture is cut from the middle, full height', () => {
        assert.deepEqual(P.squareCrop(400, 200), { sx: 100, sy: 0, side: 200 });
    });

    test('a portrait picture is cut from the middle, full width', () => {
        assert.deepEqual(P.squareCrop(200, 400), { sx: 0, sy: 100, side: 200 });
    });

    test('a square picture is used whole', () => {
        assert.deepEqual(P.squareCrop(300, 300), { sx: 0, sy: 0, side: 300 });
    });
});

describe('pathFor', () => {
    test('is the person\'s own folder, one fixed file name', () => {
        assert.equal(P.pathFor('abc-123'), 'abc-123/avatar.jpg');
    });
});
