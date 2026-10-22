import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { notStarted, message } = require('../shared/js/curriculum/curriculumstart.js');

const base = { curriculumYear: 2050, currentYear: 2026, ownProspectus: false, recordCount: 0 };

test('a new student on a post-dated curriculum is refused', () => {
    assert.equal(notStarted(base), true);
});

test('a student with no curriculum of their own is refused even with records', () => {
    assert.equal(notStarted({ ...base, ownProspectus: false, recordCount: 40 }), true);
});

test('a student with their own curriculum but no records is refused', () => {
    assert.equal(notStarted({ ...base, ownProspectus: true, recordCount: 0 }), true);
});

test('a student with their own curriculum and records keeps working', () => {
    assert.equal(notStarted({ ...base, ownProspectus: true, recordCount: 12 }), false);
});

test('a curriculum that has started is never refused', () => {
    assert.equal(notStarted({ ...base, curriculumYear: 2026 }), false);
    assert.equal(notStarted({ ...base, curriculumYear: 2019 }), false);
});

test('the year the system is on counts as started', () => {
    assert.equal(notStarted({ ...base, curriculumYear: 2026, currentYear: 2026 }), false);
});

test('one year ahead is post-dated', () => {
    assert.equal(notStarted({ ...base, curriculumYear: 2027, currentYear: 2026 }), true);
});

test('an unknown year is never a reason to refuse', () => {
    assert.equal(notStarted({ ...base, curriculumYear: null }), false);
    assert.equal(notStarted({ ...base, currentYear: undefined }), false);
    assert.equal(notStarted({ ...base, curriculumYear: '2050' }), false);
});

test('the message names the academic year', () => {
    assert.match(message(2050), /2050–2051/);
    assert.match(message(2050), /department/);
});
