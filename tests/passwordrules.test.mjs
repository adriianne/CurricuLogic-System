// passwordrules.test.mjs
// The one password rule: 8+ characters with a special character, 12+ for admin.
//
//   node --test tests/passwordrules.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../shared/js/passwordrules.js');

describe('problem', () => {
    test('a short password is refused', () => {
        assert.match(P.problem('Ab1!'), /at least 8/);
        assert.match(P.problem('Abc123!'), /at least 8/);   // 7 characters
    });

    test('eight characters with a special character is accepted', () => {
        assert.equal(P.problem('Abcdef1!'), null);
        assert.equal(P.problem('abcdefg#'), null);
    });

    test('no special character is refused, whatever the length', () => {
        assert.match(P.problem('12345678'), /special character/);
        assert.match(P.problem('Password1'), /special character/);
        assert.match(P.problem('a'.repeat(40)), /special character/);
    });

    test('a space is not a special character', () => {
        assert.match(P.problem('abcd efgh'), /special character/);
        assert.match(P.problem('        '), /special character/);
    });

    test('any symbol counts', () => {
        for (const c of '!@#$%^&*()-_=+[]{};:\'",.<>/?\\|`~') {
            assert.equal(P.problem(`abcdefg${c}`), null, `symbol ${c}`);
        }
    });

    test('a letter from another alphabet is a letter, not a symbol', () => {
        assert.match(P.problem('ñññññññññ'), /special character/);
    });

    test('longer than 72 characters is refused', () => {
        assert.match(P.problem('a!'.repeat(37)), /at most 72/);   // 74
        assert.equal(P.problem('a!'.repeat(36)), null);           // 72
    });

    test('missing or non-string input is refused, not thrown on', () => {
        assert.ok(P.problem(undefined));
        assert.ok(P.problem(null));
        assert.ok(P.problem(12345678));
    });
});

describe('admin accounts', () => {
    test('need 12 characters', () => {
        assert.match(P.problem('Abcdef1!', 'admin'), /at least 12/);
        assert.match(P.problem('Abcdefghij!', 'admin'), /at least 12/);  // 11
        assert.equal(P.problem('Abcdefghijk!', 'admin'), null);          // 12
    });

    test('still need a special character', () => {
        assert.match(P.problem('Abcdefghijkl', 'admin'), /special character/);
    });

    test('the role name is not case sensitive; other roles stay at 8', () => {
        assert.match(P.problem('Abcdef1!', 'ADMIN'), /at least 12/);
        for (const r of ['student', 'faculty', 'registrar', 'department', '', undefined]) {
            assert.equal(P.problem('Abcdef1!', r), null, String(r));
        }
    });
});

describe('hint', () => {
    test('names the length for the role', () => {
        assert.match(P.hint(), /At least 8 characters/);
        assert.match(P.hint('admin'), /At least 12 characters/);
        assert.match(P.hint(), /special character/);
    });
});

describe('generate', () => {
    test('every generated password passes the rule', () => {
        for (let i = 0; i < 2000; i++) {
            assert.equal(P.problem(P.generate('faculty')), null);
            assert.equal(P.problem(P.generate('admin'), 'admin'), null);
        }
    });

    test('length is 10, or 14 for an admin', () => {
        assert.equal(P.generate('student').length, 10);
        assert.equal(P.generate('admin').length, 14);
    });

    test('a draw with no special character still gets one', () => {
        // pick() always 0 -> the pool's first character, a letter, every time
        const pw = P.generate('student', () => 0);
        assert.equal(P.problem(pw), null);
        assert.ok(P.hasSpecial(pw));
    });
});
