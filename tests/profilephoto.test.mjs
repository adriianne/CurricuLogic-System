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

describe('signedUrls', () => {
    const storage = (rows, error = null) => ({
        storage: { from: () => ({ createSignedUrls: async (paths) => ({ data: error ? null : rows(paths), error }) }) },
    });

    test('maps each person who has a photo to a link, in one request', async () => {
        const db = storage((paths) => paths.map((p) => (p.startsWith('a/')
            ? { path: p, signedUrl: 'https://x/a', error: null }
            : { path: p, signedUrl: null, error: 'Object not found' })));
        const urls = await P.signedUrls(db, ['a', 'b', 'a']);
        assert.equal(urls.get('a'), 'https://x/a');
        assert.equal(urls.has('b'), false);
        assert.equal(urls.size, 1);
    });

    test('nothing to ask for gives an empty map without a request', async () => {
        const db = { storage: { from: () => { throw new Error('should not be called'); } } };
        assert.equal((await P.signedUrls(db, [])).size, 0);
        assert.equal((await P.signedUrls(db, [null, undefined])).size, 0);
    });

    test('a failed request gives an empty map, not an error', async () => {
        const urls = await P.signedUrls(storage(() => [], { message: 'denied' }), ['a']);
        assert.equal(urls.size, 0);
    });
});
