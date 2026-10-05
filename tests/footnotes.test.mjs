// footnotes.test.mjs
// What the curriculum builder does with footnotes and non-code prerequisites
// reported by the importer. The examples are the real output for the BSIT,
// BSN, BSCRIM and BSBA prospectus PDFs.
//
//   node --test tests/footnotes.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const F = require('../shared/js/footnotes.js');

const BSIT = [
    { marker: '**',  text: 'must finish all 1st year to 2nd year courses', through_year: 2 },
    { marker: '***', text: 'must finish all 1st year to 3rd year courses', through_year: 3 },
];
const BSCRIM = [
    { marker: 'Finished Third Year Subjects', text: 'Finished Third Year Subjects', through_year: 3 },
    { marker: 'Must have passed all general education and professional subjects',
      text: 'Must have passed all general education and professional subjects', through_year: null },
];

describe('yearFromText', () => {
    test('a range reads as its last year', () => {
        assert.equal(F.yearFromText('must finish all 1st year to 2nd year courses'), 2);
        assert.equal(F.yearFromText('must finish all 1st year to 3rd year courses'), 3);
        assert.equal(F.yearFromText('Must have completed all 1st year to 4th year first semester subjects'), 4);
    });
    test('a finished year in words or digits', () => {
        assert.equal(F.yearFromText('Finished Third Year Subjects'), 3);
        assert.equal(F.yearFromText('complete 2nd year subjects'), 2);
    });
    test('text that is not about years is null', () => {
        assert.equal(F.yearFromText('Must have passed all general education and professional subjects'), null);
        assert.equal(F.yearFromText(''), null);
        assert.equal(F.yearFromText(null), null);
    });
});

describe('throughYear', () => {
    test('BSIT: ** and *** map to 2 and 3', () => {
        assert.equal(F.throughYear('**', BSIT), 2);
        assert.equal(F.throughYear('***', BSIT), 3);
    });
    test('an unknown mark, a bullet or no mark is not a gate', () => {
        assert.equal(F.throughYear('●', BSIT), null);
        assert.equal(F.throughYear('●●', BSIT), null);
        assert.equal(F.throughYear(null, BSIT), null);
        assert.equal(F.throughYear('**', []), null);
        assert.equal(F.throughYear('**', undefined), null);
    });
    test('BSCRIM: the year-based note is a gate, the general one is not', () => {
        assert.equal(F.throughYear('Finished Third Year Subjects', BSCRIM), 3);
        assert.equal(F.throughYear('Must have passed all general education and professional subjects', BSCRIM), null);
    });
    test('falls back to the text when the importer left through_year empty', () => {
        assert.equal(F.throughYear('**', [{ marker: '**', text: 'must finish 1st year to 2nd year', through_year: null }]), 2);
    });
});

describe('clampStanding', () => {
    test('a subject cannot ask for its own semester (BA 422 with "through 4th year")', () => {
        assert.equal(F.clampStanding(42, 4, 2), 41);
    });
    test('a first-semester subject falls back to the end of the year before', () => {
        assert.equal(F.clampStanding(42, 4, 1), 32);
        assert.equal(F.clampStanding(22, 2, 1), 12);
    });
    test('an earlier position is left alone', () => {
        assert.equal(F.clampStanding(22, 3, 1), 22);
        assert.equal(F.clampStanding(32, 4, 2), 32);
    });
});

describe('standingPositionFor', () => {
    test('the printed gates on real BSIT subjects', () => {
        assert.equal(F.standingPositionFor(2, 3, 2), 22);   // CC-PROFIS10 (**)
        assert.equal(F.standingPositionFor(3, 4, 1), 32);   // IT-CPSTONE41 (***)
    });
    test('BSBA BA 422 "through 4th year" is held to before its own semester', () => {
        assert.equal(F.standingPositionFor(4, 4, 2), 41);
    });
    test('a gate that would constrain nothing is null', () => {
        assert.equal(F.standingPositionFor(1, 1, 1), null);
        assert.equal(F.standingPositionFor(0, 3, 1), null);
        assert.equal(F.standingPositionFor(NaN, 3, 1), null);
    });
});

describe('resolveNotes', () => {
    const idx = new Map(['ENTREP 101', 'CC-INTCOM11', 'LEA 111', 'CLJ 211'].map(c => [F.looseKey(c), c]));

    test('codes the AI put in the wrong list are recovered', () => {
        // BSIT CC-TWRITE21: "ENTREP 101, CC-\nINTCOM11" wrapped across lines
        assert.deepEqual(F.resolveNotes(['ENTREP 101', 'CC-INTCOM11'], idx).matched, ['ENTREP 101', 'CC-INTCOM11']);
        // BSCRIM LEA 221: printed "LEA111" without the space
        assert.deepEqual(F.resolveNotes(['LEA111'], idx).matched, ['LEA 111']);
    });
    test('one note holding several codes is split', () => {
        const r = F.resolveNotes(['ENTREP 101, CC-INTCOM11'], idx);
        assert.deepEqual(r.matched, ['ENTREP 101', 'CC-INTCOM11']);
        assert.deepEqual(r.leftover, []);
    });
    test('real non-code text stays as text', () => {
        const r = F.resolveNotes(['GEC', 'All prof courses from level 1-3 and level 4 1st sem', 'All CLJ Subjects'], idx);
        assert.deepEqual(r.matched, []);
        assert.equal(r.leftover.length, 3);
    });
    test('a note is resolved only if every part is a known subject', () => {
        const r = F.resolveNotes(['CLJ 211, CLJ 223'], idx);   // CLJ 223 is not in the document
        assert.deepEqual(r.matched, []);
        assert.deepEqual(r.leftover, ['CLJ 211, CLJ 223']);
    });
    test('blank notes are ignored', () => {
        assert.deepEqual(F.resolveNotes(['', '  ', null], idx), { matched: [], leftover: [] });
    });
});

// ---- prerequisites written in words ----

// BSN, reduced to what matters: the NCM family spread over four years, plus
// general education and MC subjects that must NOT be swept in.
const bsn = [
    { code: 'HUM 101', year: 1, term: 1 }, { code: 'MC 1', year: 1, term: 1 },
    { code: 'NCM 100', year: 1, term: 1 }, { code: 'NCM 101', year: 1, term: 2 },
    { code: 'NCM 106', year: 2, term: 1 }, { code: 'NCM 111', year: 3, term: 1 },
    { code: 'NCM 118', year: 4, term: 1 }, { code: 'NCM 120', year: 4, term: 1 },
    { code: 'NCM 121', year: 4, term: 2 }, { code: 'NCM 122', year: 4, term: 2 },
    { code: 'IT-EL1', year: null, term: null },
];
const ncm122 = bsn.find(s => s.code === 'NCM 122');

describe('cutoffFromText', () => {
    test('reads a level range and a named semester', () => {
        assert.equal(F.cutoffFromText('from level 1-3'), 32);
        assert.equal(F.cutoffFromText('All prof courses from level 1-3 and level 4 1st sem'), 41);
    });
    test('null when nothing is named', () => {
        assert.equal(F.cutoffFromText('All CLJ/CDI Subjects'), null);
    });
});

describe('interpretNote', () => {
    test('BSN NCM 122: every earlier NCM course, nothing else', () => {
        const r = F.interpretNote('All prof courses from level 1-3 and level 4 1st sem', ncm122, bsn);
        assert.equal(r.kind, 'subjects');
        assert.deepEqual(r.targets.map(s => s.code),
            ['NCM 100', 'NCM 101', 'NCM 106', 'NCM 111', 'NCM 118', 'NCM 120']);
    });

    test('a same-term or later NCM course is never a prerequisite', () => {
        const r = F.interpretNote('All prof courses', ncm122, bsn);
        assert.ok(!r.targets.some(s => s.code === 'NCM 121' || s.code === 'NCM 122'));
    });

    test('the cutoff stops the list short of later semesters', () => {
        const r = F.interpretNote('All prof courses from level 1-3', ncm122, bsn);
        assert.deepEqual(r.targets.map(s => s.code), ['NCM 100', 'NCM 101', 'NCM 106', 'NCM 111']);
    });

    test('BSCRIM: named code prefixes', () => {
        const crim = [
            { code: 'CLJ 111', year: 1, term: 1 }, { code: 'CDI 211', year: 2, term: 1 },
            { code: 'GE 101', year: 1, term: 1 }, { code: 'CLJ 411', year: 4, term: 1 },
        ];
        const r = F.interpretNote('All CLJ/CDI Subjects', crim[3], crim);
        assert.deepEqual(r.targets.map(s => s.code), ['CLJ 111', 'CDI 211']);
    });

    test('a prefix that does not exist in the curriculum is not guessed at', () => {
        assert.equal(F.interpretNote('All XYZ Subjects', ncm122, bsn), null);
    });

    test('BSCRIM: "Finished Third Year Subjects" is a year-standing gate', () => {
        const ojt = { code: 'CRIM OJT 411', year: 4, term: 1 };
        const r = F.interpretNote('Finished Third Year Subjects', ojt, [ojt]);
        assert.deepEqual([r.kind, r.position], ['standing', 32]);
    });

    test('BSCRIM: "all general education and professional subjects" is everything before', () => {
        const ec = { code: 'CRIM EC 421', year: 4, term: 2 };
        const r = F.interpretNote('Must have passed all general education and professional subjects', ec, [ec]);
        assert.deepEqual([r.kind, r.position], ['standing', 41]);
    });

    test('"GEC" has no defined meaning and is left for a person', () => {
        assert.equal(F.interpretNote('GEC', bsn.find(s => s.code === 'NCM 106'), bsn), null);
    });

    test('a catalogue subject (no year) cannot be given a rule', () => {
        assert.equal(F.interpretNote('All prof courses', bsn.at(-1), bsn), null);
    });
});

describe('interpretNote: wrapped text', () => {
    test('a phrase split over lines reads the same', () => {
        const r = F.interpretNote('All prof courses\nfrom level 1-3\nand level 4 1st sem', ncm122, bsn);
        assert.equal(r.targets.length, 6);
    });
});
