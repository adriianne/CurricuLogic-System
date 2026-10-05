import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { findMatches, reasonText } = createRequire(import.meta.url)('../shared/js/accountmatches.js');

const acct = (id, first, last, email, student_id = null) => ({ id, first_name: first, last_name: last, email, student_id });

test('the same name is a match, whatever the case or spacing', () => {
    const req = acct('r', 'Althea', 'Villanueva', 'a@x.com');
    const m = findMatches(req, [acct('1', '  althea ', 'VILLANUEVA', 'other@x.com')]);
    assert.deepEqual(m[0].reasons, ['same_name']);
});

test('accents are ignored in names', () => {
    const m = findMatches(acct('r', 'José', 'Peña', 'a@x.com'), [acct('1', 'Jose', 'Pena', 'b@x.com')]);
    assert.equal(m.length, 1);
});

test('the same student ID and the same e-mail are matches', () => {
    const req = acct('r', 'A', 'B', 'a@x.com', '2401187');
    const m = findMatches(req, [acct('1', 'C', 'D', 'c@x.com', '2401187'), acct('2', 'E', 'F', 'A@X.com')]);
    assert.deepEqual(m.map(x => x.reasons), [['same_id'], ['same_email']]);
});

test('the request itself and unrelated accounts are not matches', () => {
    const req = acct('r', 'A', 'B', 'a@x.com', '1');
    assert.deepEqual(findMatches(req, [req, acct('2', 'C', 'D', 'c@x.com', '2')]), []);
});

test('strongest reason comes first', () => {
    const req = acct('r', 'A', 'B', 'a@x.com', '5');
    const m = findMatches(req, [acct('1', 'A', 'B', 'z@x.com'), acct('2', 'Q', 'W', 'q@x.com', '5')]);
    assert.equal(m[0].account.id, '2');
});

test('an empty name or ID never matches blank ones', () => {
    const req = acct('r', '', '', '', null);
    assert.deepEqual(findMatches(req, [acct('1', '', '', '', null)]), []);
    assert.deepEqual(findMatches(null, []), []);
    assert.deepEqual(findMatches(req, null), []);
});

test('reasons read as plain words', () => {
    assert.equal(reasonText(['same_id', 'same_name']), 'same student ID, same name');
});
