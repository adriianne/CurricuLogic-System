// chatsuggestions.test.mjs
// The questions offered under Cura's chat box.
//
//   node --test tests/chatsuggestions.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../ai-assist/chatsuggestions.js');

const rec = (code, extra = {}) => ({ code, title: code, units: 3, retake: false, sections: [{ section: 'A', meetings: [], timeOfDay: 'morning' }], slotOptions: null, ...extra });

/* A summary shaped like the one eligibility-explanation.js builds. */
const summary = (over = {}) => ({
    unitsEarned: 9, recommended: [rec('CC-INTCOM11'), rec('IT-OOPROG21')], recommendedUnits: 23,
    preferences: null, scheduleConflicts: [],
    locked: [{ code: 'CC-NETWORK31', reasons: ['x'] }, { code: 'IT-SAD21', reasons: ['y'] }], lockedCount: 2,
    ...over,
});

describe('at the start of a conversation', () => {
    test('offers the useful opening questions, most useful first', () => {
        assert.deepEqual(S.followUps({ summary: summary(), max: 4 }), [
            'What should I take next semester?',
            'How many units can I take?',
            'Which of my recommended subjects have morning sections?',
            'Why is CC-NETWORK31 locked?',
        ]);
    });
    test('three by default', () => {
        assert.equal(S.followUps({ summary: summary() }).length, 3);
    });
    test('nothing to offer without a summary', () => {
        assert.deepEqual(S.followUps({}), []);
        assert.deepEqual(S.followUps({ summary: null }), []);
    });
});

describe('built from this student\'s own data', () => {
    test('names a locked subject that really exists in the summary', () => {
        const qs = S.followUps({ summary: summary(), asked: ['What should I take next semester?', 'How many units can I take?', 'Which of my recommended subjects have morning sections?'], max: 5 });
        assert.ok(qs.includes('Why is CC-NETWORK31 locked?'));
        assert.ok(qs.includes('What do I need to unlock IT-SAD21?'));
    });
    test('no recommendations: no "what should I take" and no priority question', () => {
        const qs = S.followUps({ summary: summary({ recommended: [], recommendedUnits: 0 }), max: 10 });
        assert.ok(!qs.includes('What should I take next semester?'));
        assert.ok(!qs.includes('Which subject should I take first?'));
    });
    test('no locked subjects: no locked questions', () => {
        const qs = S.followUps({ summary: summary({ locked: [], lockedCount: 0 }), max: 10 });
        assert.ok(!qs.some((q) => /locked|unlock/.test(q)));
    });
    test('a clash is offered by name, with just the subject codes', () => {
        const s = summary({ scheduleConflicts: [{ a: 'IT-SAD21 (BSIT-1A)', b: 'CC-INTCOM11 (BSIT-1A)' }] });
        assert.ok(S.followUps({ summary: s, max: 10 }).includes('Do IT-SAD21 and CC-INTCOM11 clash?'));
    });
    test('two sections of one subject clashing is asked generally', () => {
        const s = summary({ scheduleConflicts: [{ a: 'IT-SAD21 (BSIT-1A)', b: 'IT-SAD21 (BSIT-1B)' }] });
        assert.ok(S.followUps({ summary: s, max: 10 }).includes('Do any of my recommended subjects clash?'));
    });
    test('a retake and an open elective slot are offered when they exist', () => {
        const s = summary({ recommended: [rec('A1', { retake: true }), rec('B2', { slotOptions: [{ code: 'X' }] })] });
        const qs = S.followUps({ summary: s, max: 10 });
        assert.ok(qs.includes('Which subjects do I need to retake?'));
        assert.ok(qs.includes('What can I choose for my elective slot?'));
    });
    test('a subject moved to a later term to keep to the load is asked about by code', () => {
        const s = summary({ preferences: { timeOfDay: 'morning', load: 'light', unitCeiling: 15, movedToLaterTerm: ['PE 101'], notes: [] } });
        const qs = S.followUps({ summary: s, max: 10 });
        assert.ok(qs.includes('Why was PE 101 left for a later term?'));
        assert.ok(qs.includes('Do my sections match my class-time preference?'));
        assert.ok(!qs.includes('Which of my recommended subjects have morning sections?'));
    });
    test('a heavy load invites "what if I want a lighter load?"', () => {
        assert.ok(S.followUps({ summary: summary({ recommendedUnits: 24 }), max: 10 }).includes('What if I want a lighter load?'));
        assert.ok(!S.followUps({ summary: summary({ recommendedUnits: 12 }), max: 10 }).includes('What if I want a lighter load?'));
    });
});

describe('what was just said shapes what is offered next', () => {
    test('after a plan table, sending it to the adviser comes first', () => {
        const qs = S.followUps({ summary: summary(), asked: ['What should I take next semester?'], lastReply: { table: true } });
        assert.equal(qs[0], 'How do I send my plan to my adviser?');
    });
    test('no table, no "send it" question', () => {
        const qs = S.followUps({ summary: summary(), asked: [], lastReply: { table: false }, max: 10 });
        assert.ok(!qs.includes('How do I send my plan to my adviser?'));
    });
    test('after a plan table, a clash question jumps up', () => {
        const s = summary({ scheduleConflicts: [{ a: 'A1 (x)', b: 'B2 (x)' }] });
        const withTable = S.followUps({ summary: s, asked: ['What should I take next semester?'], lastReply: { table: true }, max: 3 });
        assert.ok(withTable.includes('Do A1 and B2 clash?'));
    });
});

describe('no repeats', () => {
    test('a question already asked is not offered again', () => {
        const qs = S.followUps({ summary: summary(), asked: ['What should I take next semester?'], max: 10 });
        assert.ok(!qs.includes('What should I take next semester?'));
    });
    test('the same topic in the student\'s own words counts as asked', () => {
        const qs = S.followUps({ summary: summary(), asked: ['hey, what should i take next sem?', 'how many units am i allowed, what is the unit limit'], max: 10 });
        assert.ok(!qs.includes('What should I take next semester?'));
        assert.ok(!qs.includes('How many units can I take?'));
    });
    test('asking about one locked subject does not hide the other', () => {
        const qs = S.followUps({ summary: summary(), asked: ['Why is CC-NETWORK31 locked?'], max: 10 });
        assert.ok(!qs.includes('Why is CC-NETWORK31 locked?'));
        assert.ok(qs.includes('What do I need to unlock IT-SAD21?'));
    });
    test('a general "why is anything locked" question covers all locked ones', () => {
        const qs = S.followUps({ summary: summary(), asked: ['why are my subjects locked?'], max: 10 });
        assert.ok(!qs.some((q) => /locked|unlock/.test(q)));
    });
    test('when everything has been asked, nothing is offered (the chips go away)', () => {
        const all = S.followUps({ summary: summary(), max: 99 });
        assert.deepEqual(S.followUps({ summary: summary(), asked: all, max: 99 }), []);
    });
    test('no question appears twice in one list', () => {
        const qs = S.followUps({ summary: summary({ scheduleConflicts: [{ a: 'A (x)', b: 'B (x)' }, { a: 'A (y)', b: 'B (y)' }] }), max: 99 });
        assert.equal(new Set(qs).size, qs.length);
    });
});

describe('safety of what is built from data', () => {
    test('every question is plain text within the length limit', () => {
        const long = 'X'.repeat(300);
        const s = summary({ locked: [{ code: long, reasons: [] }] });
        for (const q of S.followUps({ summary: s, max: 99 })) assert.ok(q.length <= S.MAX_LENGTH);
    });
    test('a hostile subject code is passed through as text, never interpreted (the page escapes it)', () => {
        const s = summary({ locked: [{ code: '<img src=x onerror=1>', reasons: [] }] });
        const qs = S.followUps({ summary: s, max: 99 });
        assert.ok(qs.some((q) => q.includes('<img src=x onerror=1>')), 'kept verbatim: the page must escape it');
        assert.ok(qs.every((q) => typeof q === 'string'));
    });
});

describe('topicsOf', () => {
    test('recognises the main topics', () => {
        assert.ok(S.topicsOf('what should I take next semester', summary()).has('next'));
        assert.ok(S.topicsOf('how many units can i take', summary()).has('units'));
        assert.ok(S.topicsOf('do these clash', summary()).has('clash'));
        assert.ok(S.topicsOf('which have morning sections', summary()).has('time'));
        assert.ok(S.topicsOf('how do i send this to my adviser', summary()).has('submit'));
        assert.ok(S.topicsOf('Why is IT-SAD21 locked?', summary()).has('locked:IT-SAD21'));
    });
    test('an unrelated question matches nothing', () => {
        assert.equal(S.topicsOf('hello there', summary()).size, 0);
    });
});
