// emailrules.test.mjs
// The one email rule: one @, sensible characters, a real-looking domain, 254 at most.
//
//   node --test tests/emailrules.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../shared/js/emailrules.js');

describe('problem', () => {
    test('ordinary addresses pass', () => {
        for (const e of ['althea@gmail.com', 'rhea.lumactod@uc.edu.ph', 'juan_dc+advising@uc.edu.ph',
                         "o'brien@school.edu", 'a-b@c-d.org', 'x@sub.domain.co.uk', '1234@uc.edu.ph',
                         'ALTHEA@GMAIL.COM', '  althea@gmail.com  ']) {
            assert.equal(E.problem(e), null, e);
        }
    });

    test('empty input asks for an address', () => {
        for (const e of ['', '   ', null, undefined]) assert.match(E.problem(e), /Enter an email/, String(e));
    });

    test('the shapes the old check let through are refused', () => {
        for (const e of ['a@b.c', 'a@@b.com', 'a@b@c.com', 'x..y@school.edu', '.x@school.edu', 'x.@school.edu',
                         'a@-b.com', 'a@b-.com', 'a@.com', 'a@b..com', 'a@b.com.', 'a@b', 'a@b.c0m', 'a@b.123']) {
            assert.match(E.problem(e), /valid email/, e);
        }
    });

    test('quotes, brackets, spaces and other symbols are refused', () => {
        for (const e of ['<b>x</b>@school.edu', '"x"@school.edu', 'x y@school.edu', 'x@scho ol.edu', 'x,y@school.edu',
                         'x;y@school.edu', 'x(y)@school.edu', 'x\\y@school.edu', 'x@school.edu>', '=1+1@school.edu'.replace('=', '(')]) {
            assert.match(E.problem(e), /valid email/, e);
        }
    });

    test('non-ASCII and emoji are refused', () => {
        for (const e of ['josé@school.edu', 'x@schööl.edu', '\u{1F600}@school.edu', 'x@school.中文']) {
            assert.match(E.problem(e), /valid email/, e);
        }
    });

    test('length limits: 64 before the @, 254 in all', () => {
        assert.equal(E.problem('a'.repeat(64) + '@school.edu'), null);
        assert.match(E.problem('a'.repeat(65) + '@school.edu'), /valid email/);
        const long = 'a'.repeat(60) + '@' + ('b'.repeat(60) + '.').repeat(3) + 'edu';   // 252
        assert.equal(E.problem(long), null);
        assert.match(E.problem('a'.repeat(60) + '@' + ('b'.repeat(60) + '.').repeat(4) + 'edu'), /at most 254/);
    });

    test('a label may be 63 characters, not 64', () => {
        assert.equal(E.problem('a@' + 'b'.repeat(63) + '.edu'), null);
        assert.match(E.problem('a@' + 'b'.repeat(64) + '.edu'), /valid email/);
    });
});

describe('clean', () => {
    test('trims, lower-cases and drops invisible characters', () => {
        assert.equal(E.clean('  Althea@GMail.com '), 'althea@gmail.com');
        assert.equal(E.clean('al​thea@gmail.com'), 'althea@gmail.com');
    });

    test('a pasted full-width address becomes a normal one', () => {
        assert.equal(E.clean('ａｌ＠gmail.com'), 'al@gmail.com');
        assert.equal(E.problem('ａｌ＠gmail.com'), null);
    });

    test('null becomes an empty string', () => {
        assert.equal(E.clean(null), '');
    });
});
