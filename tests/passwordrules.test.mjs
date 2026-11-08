// passwordrules.test.mjs
// The one password rule: 8+ characters with a letter, a number and a special character; 12+ for admin.
//
//   node --test tests/passwordrules.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../shared/js/accounts/passwordrules.js');

describe('problem', () => {
    test('a short password is refused', () => {
        assert.match(P.problem('Ab1!'), /at least 8/);
        assert.match(P.problem('Abc123!'), /at least 8/);   // 7 characters
    });

    test('eight characters with a special character is accepted', () => {
        assert.equal(P.problem('Abcdef1!'), null);
        assert.equal(P.problem('abcdef1#'), null);
    });

    test('no special character is refused, whatever the length', () => {
        assert.match(P.problem('12345678'), /special character/);
        assert.match(P.problem('Password1'), /special character/);
        assert.match(P.problem('a'.repeat(40)), /special character/);
    });

    test('a space is not a special character', () => {
        assert.match(P.problem('abcd efgh'), /special character/);
        assert.match(P.problem('        '), /at least 8/);
    });

    test('any symbol counts', () => {
        for (const c of '!@#$%^&*()-_=+[]{};:\'",.<>/?\\|`~') {
            assert.equal(P.problem(`abcdef1${c}`), null, `symbol ${c}`);
        }
    });

    test('a letter from another alphabet is a letter, not a symbol', () => {
        assert.match(P.problem('ñññññññññ'), /special character/);
    });

    test('longer than 72 characters is refused', () => {
        assert.match(P.problem('a!'.repeat(37)), /at most 72/);   // 74
        assert.equal(P.problem('a!'.repeat(35) + '1!'), null);       // 72
    });

    test('spaces do not count toward the minimum', () => {
        assert.match(P.problem('        !'), /at least 8.*spaces do not count/);   // 8 spaces + !
        assert.match(P.problem('a b c d e f!'), /at least 8/);                      // 7 visible
        assert.equal(P.problem('abcd ef1!'), null);                                 // 8 visible
    });

    test('the 72 limit counts bytes, not characters', () => {
        assert.equal(P.byteLength('abc'), 3);
        assert.equal(P.byteLength('é'), 2);
        assert.equal(P.byteLength('田'), 3);
        assert.equal(P.byteLength('😀'), 4);
        assert.equal(P.problem('田'.repeat(22) + '1!'), null);                      // 24 chars, 68 bytes
        assert.match(P.problem('田'.repeat(24) + '!'), /at most 72 bytes/);         // 25 chars, 73 bytes
        assert.match(P.problem('😀'.repeat(18) + '!'), /at most 72 bytes/);         // 19 chars, 73 bytes
    });

    test('missing or non-string input is refused, not thrown on', () => {
        assert.ok(P.problem(undefined));
        assert.ok(P.problem(null));
        assert.ok(P.problem(12345678));
    });
});

describe('a letter and a number are required too', () => {
    test('no number is refused', () => {
        assert.match(P.problem('abcdefg!'), /number/);
        assert.match(P.problem('Passwor!'), /number/);
    });
    test('no letter is refused', () => {
        assert.match(P.problem('12345678!'), /letter/);
        assert.match(P.problem('!!!!!!!1'), /letter/);
    });
    test('the weak passwords that used to pass are refused', () => {
        for (const pw of ['12345678!', '!!!!!!!!', 'abcdefg!', 'ABCDEFGH!']) assert.ok(P.problem(pw), pw);
    });
    test('a letter of another alphabet and a digit of another script count', () => {
        assert.equal(P.problem('ñññññññ1!'), null);
        assert.equal(P.problem('abcdefg\u0663!'), null);   // Arabic-indic digit three
    });
    test('the hint names all three', () => {
        assert.match(P.hint(), /letter, a number and a special character/);
    });
});

describe('admin accounts', () => {
    test('need 12 characters', () => {
        assert.match(P.problem('Abcdef1!', 'admin'), /at least 12/);
        assert.match(P.problem('Abcdefghij!', 'admin'), /at least 12/);  // 11
        assert.equal(P.problem('Abcdefghij1!', 'admin'), null);         // 12
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

    test('every kind of character is in a generated password, even when the draw is always the same', () => {
        const pw = P.generate('student', () => 0);
        assert.ok(/[A-Za-z]/.test(pw) && /[0-9]/.test(pw) && P.hasSpecial(pw), pw);
        assert.equal(pw.length, 10);
    });

    test('a draw with no special character still gets one', () => {
        // pick() always 0 -> the pool's first character, a letter, every time
        const pw = P.generate('student', () => 0);
        assert.equal(P.problem(pw), null);
        assert.ok(P.hasSpecial(pw));
    });
});
