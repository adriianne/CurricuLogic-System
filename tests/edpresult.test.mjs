// edpresult.test.mjs
// What the student reports about the EDP office's answer, and what to do next.
//
//   node --test tests/edpresult.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ER = require('../shared/js/edpresult.js');
const SC = require('../shared/js/schedule/scheduleconflicts.js');

let nextId = 1;
const offering = (subject_id, section, days, start, end, type = 'LEC', edp = null) =>
    ({ id: nextId++, subject_id, section, meeting_type: type, schedule_days: days, start_time: start, end_time: end, edp_code: edp });

/* an approved request item with the section it was submitted with, as the page enriches it */
const item = (id, subject_id, code, rows, chosen, over = {}) => {
    const groups = SC.groupSections(rows);
    return {
        id, subject_id, status: 'approved', subject: { code, title: `${code} title`, units: 3 },
        _section: groups.find(g => g.section === chosen), _allSections: groups, ...over,
    };
};

describe('the reasons', () => {
    test('every reason has a label and a next step', () => {
        for (const r of ER.REASONS) {
            assert.ok(r.label.length > 3, r.value);
            assert.ok(r.next.length > 10, r.value);
        }
        assert.deepEqual(ER.REASONS.map(r => r.value).sort(),
            ['code_error', 'conflict', 'full', 'hold', 'other', 'overload', 'record']);
    });

    test('they match what the database accepts', () => {
        // db/077_edp_results.sql: full | conflict | record | overload | code_error | hold | other
        assert.equal(ER.REASONS.length, 7);
    });

    test('full, conflict, code error and other call for another section; record, overload and hold do not', () => {
        for (const v of ['full', 'conflict', 'code_error', 'other']) assert.equal(ER.needsNewSection(v), true, v);
        for (const v of ['record', 'overload', 'hold']) assert.equal(ER.needsNewSection(v), false, v);
        assert.equal(ER.needsNewSection('nonsense'), false);
    });

    test('an unknown reason has no label and no step', () => {
        assert.equal(ER.reasonLabel('x'), '');
        assert.equal(ER.nextStep('x'), '');
    });
});

describe('the checklist', () => {
    const rows = [offering(1, 'BSIT-1A', 'MW', '08:00', '09:30', 'LEC', '4101'), offering(1, 'BSIT-1A', 'F', '13:00', '16:00', 'LAB', '4102')];
    const request = { id: 9, request_item: [
        item(10, 1, 'AAA', rows, 'BSIT-1A'),
        { id: 11, subject_id: 2, status: 'rejected', subject: { code: 'BBB', title: 'x', units: 3 } },
        { id: 12, subject_id: 3, status: 'flagged', subject: { code: 'CCC', title: 'x', units: 3 } },
    ] };

    test('only subjects the adviser approved can be reported on', () => {
        assert.deepEqual(ER.checklistRows(request).map(r => r.code), ['AAA']);
    });

    test('a row carries the section and each EDP code once', () => {
        const [r] = ER.checklistRows(request);
        assert.equal(r.section, 'BSIT-1A');
        assert.deepEqual(r.edp, ['4101', '4102']);
        assert.equal(r.result, null);
    });

    test('an earlier report is shown', () => {
        const req = { request_item: [item(10, 1, 'AAA', rows, 'BSIT-1A', { edp_result: 'rejected', edp_reason: 'full' })] };
        assert.deepEqual([ER.checklistRows(req)[0].result, ER.checklistRows(req)[0].reason], ['rejected', 'full']);
    });

    test('an item with no section known does not crash', () => {
        const req = { request_item: [{ id: 1, status: 'approved', subject: { code: 'Z', title: 't', units: 3 } }] };
        const [r] = ER.checklistRows(req);
        assert.equal(r.section, null);
        assert.deepEqual(r.edp, []);
    });
});

describe('what is sent', () => {
    test('a rejection needs a known reason', () => {
        assert.deepEqual(ER.problems([{ itemId: 1, result: 'rejected', reason: null }]).map(p => p.itemId), [1]);
        assert.deepEqual(ER.problems([{ itemId: 1, result: 'rejected', reason: 'bogus' }]).map(p => p.itemId), [1]);
        assert.deepEqual(ER.problems([{ itemId: 1, result: 'rejected', reason: 'full' }]), []);
    });

    test('accepted, or nothing reported, needs no reason', () => {
        assert.deepEqual(ER.problems([{ itemId: 1, result: 'accepted' }, { itemId: 2, result: null }]), []);
    });

    test('an unknown result is a problem', () => {
        assert.equal(ER.problems([{ itemId: 1, result: 'maybe' }]).length, 1);
    });

    test('the payload keeps a reason only for a rejection', () => {
        assert.deepEqual(ER.payload([
            { itemId: 1, result: 'rejected', reason: 'full' },
            { itemId: 2, result: 'accepted', reason: 'full' },
            { itemId: 3, result: null, reason: 'full' },
        ]), [
            { item_id: 1, result: 'rejected', reason: 'full' },
            { item_id: 2, result: 'accepted', reason: null },
            { item_id: 3, result: null, reason: null },
        ]);
    });
});

describe('sections reported full', () => {
    const rowsA = [offering(1, 'BSIT-1A', 'MW', '08:00', '09:30'), offering(1, 'BSIT-1B', 'MW', '10:00', '11:30')];
    const reqs = [{ request_item: [
        item(1, 1, 'AAA', rowsA, 'BSIT-1A', { edp_result: 'rejected', edp_reason: 'full' }),
        item(2, 2, 'BBB', [offering(2, 'BSIT-1A', 'TTH', '08:00', '09:30')], 'BSIT-1A', { edp_result: 'rejected', edp_reason: 'conflict' }),
        item(3, 3, 'CCC', [offering(3, 'BSIT-1A', 'F', '08:00', '09:30')], 'BSIT-1A', { edp_result: 'accepted' }),
    ] }];

    test('only a "full" report hides the section from this student', () => {
        assert.deepEqual([...ER.fullKeys(reqs)], ['1|BSIT-1A']);
    });

    test('the offerings of that section, every meeting, are dropped; other sections stay', () => {
        const rows = [
            offering(1, 'BSIT-1A', 'MW', '08:00', '09:30', 'LEC'), offering(1, 'BSIT-1A', 'F', '13:00', '16:00', 'LAB'),
            offering(1, 'BSIT-1B', 'MW', '10:00', '11:30'), offering(2, 'BSIT-1A', 'TTH', '08:00', '09:30'),
        ];
        const kept = ER.dropReported(rows, ER.fullKeys(reqs));
        assert.deepEqual(kept.map(o => `${o.subject_id}/${o.section}`), ['1/BSIT-1B', '2/BSIT-1A']);
    });

    test('with nothing reported the rows come back as they are', () => {
        const rows = [offering(1, 'BSIT-1A', 'MW', '08:00', '09:30')];
        assert.equal(ER.dropReported(rows, new Set()), rows);
        assert.equal(ER.dropReported(rows, null), rows);
    });

    test('a report on one student does not hide anything from the function that is given other keys', () => {
        assert.deepEqual([...ER.fullKeys([])], []);
        assert.deepEqual([...ER.fullKeys(null)], []);
    });
});

describe('hiding a section by offering id', () => {
    const rows = [
        offering(1, 'BSIT-1A', 'MW', '08:00', '09:30', 'LEC'), offering(1, 'BSIT-1A', 'F', '13:00', '16:00', 'LAB'),
        offering(1, 'BSIT-1B', 'MW', '10:00', '11:30'), offering(2, 'BSIT-1A', 'TTH', '08:00', '09:30'),
    ];

    test('one meeting reported takes the whole section away, and only that section', () => {
        const kept = ER.dropByOfferingIds(rows, [rows[0].id]);
        assert.deepEqual(kept.map(o => o.subject_id + '/' + o.section), ['1/BSIT-1B', '2/BSIT-1A']);
    });

    test('the lab meeting id works as well as the lecture one', () => {
        const kept = ER.dropByOfferingIds(rows, [rows[1].id]);
        assert.ok(!kept.some(o => o.subject_id === 1 && o.section === 'BSIT-1A'));
    });

    test('an id that is not in the current list changes nothing', () => {
        assert.equal(ER.dropByOfferingIds(rows, [99999]).length, rows.length);
        assert.equal(ER.dropByOfferingIds(rows, []), rows);
        assert.equal(ER.dropByOfferingIds(rows, null), rows);
    });

    test('the same section name in another subject stays', () => {
        const kept = ER.dropByOfferingIds(rows, [rows[3].id]);
        assert.equal(kept.filter(o => o.subject_id === 1).length, 3);
    });
});

describe('alternatives', () => {
    // subject 1: sections A (MW 8-9:30), B (MW 10-11:30), C (TTH 8-9:30)   <- the one turned down is A
    // subject 2: one section TTH 10-11:30      subject 3: one section MW 8:30-10 (clashes with 1/A and 1/B)
    const s1 = [offering(1, 'BSIT-1A', 'MW', '08:00', '09:30'), offering(1, 'BSIT-1B', 'MW', '10:00', '11:30'), offering(1, 'BSIT-1C', 'TTH', '08:00', '09:30')];
    const s2 = [offering(2, 'BSIT-1A', 'TTH', '10:00', '11:30')];
    const mk = () => ({ id: 9, request_item: [item(10, 1, 'AAA', s1, 'BSIT-1A'), item(11, 2, 'BBB', s2, 'BSIT-1A')] });
    const entry = (id, code, rows, over = {}) => ({ subject: { id, code, title: `${code} t`, units: 3, year_level: 1 }, sections: rows, availableThisTerm: true, alongside: [], ...over });

    test('other sections of the same subject come first, clash-free with the rest of the plan', () => {
        const alt = ER.alternatives({ request: mk(), rejected: new Set([10]) }).get(10);
        assert.deepEqual(alt.sameSubject.map(g => g.section).sort(), ['BSIT-1B', 'BSIT-1C']);
        assert.deepEqual(alt.replacements, []);
    });

    test('the section turned down is never offered back', () => {
        const alt = ER.alternatives({ request: mk(), rejected: new Set([10]) }).get(10);
        assert.ok(!alt.sameSubject.some(g => g.section === 'BSIT-1A'));
    });

    test('a section the student already reported full is not offered', () => {
        const full = new Set([ER.sectionKey(1, 'BSIT-1B')]);
        const alt = ER.alternatives({ request: mk(), rejected: new Set([10]), fullKeys: full }).get(10);
        assert.deepEqual(alt.sameSubject.map(g => g.section), ['BSIT-1C']);
    });

    test('a section that would clash with a subject still in the plan is not offered', () => {
        const rows = [...s1, offering(1, 'BSIT-1D', 'TTH', '10:30', '12:00')];   // clashes with BBB (TTH 10-11:30)
        const req = { id: 9, request_item: [item(10, 1, 'AAA', rows, 'BSIT-1A'), item(11, 2, 'BBB', s2, 'BSIT-1A')] };
        const alt = ER.alternatives({ request: req, rejected: new Set([10]) }).get(10);
        assert.ok(!alt.sameSubject.some(g => g.section === 'BSIT-1D'));
    });

    test('when two subjects were turned down, neither is held back by the other', () => {
        const alts = ER.alternatives({ request: mk(), rejected: new Set([10, 11]) });
        assert.ok(alts.get(10).sameSubject.length > 0);
        assert.equal(alts.size, 2);
    });

    test('with no other section, another subject that fits is offered', () => {
        const only = [offering(1, 'BSIT-1A', 'MW', '08:00', '09:30')];
        const req = { id: 9, request_item: [item(10, 1, 'AAA', only, 'BSIT-1A'), item(11, 2, 'BBB', s2, 'BSIT-1A')] };
        const fits = entry(5, 'FIT', [offering(5, 'BSIT-1A', 'F', '08:00', '09:30')]);
        const clashes = entry(6, 'CLASH', [offering(6, 'BSIT-1A', 'TTH', '10:30', '12:00')]);   // overlaps BBB
        const alt = ER.alternatives({ request: req, rejected: new Set([10]), eligible: [clashes, fits], room: 0 }).get(10);
        assert.deepEqual(alt.sameSubject, []);
        assert.deepEqual(alt.replacements.map(r => r.code), ['FIT']);
        assert.equal(alt.replacements[0].group.section, 'BSIT-1A');
    });

    test('a replacement must fit the unit room, counting the units freed by the subject turned down', () => {
        const only = [offering(1, 'BSIT-1A', 'MW', '08:00', '09:30')];
        const req = { id: 9, request_item: [item(10, 1, 'AAA', only, 'BSIT-1A')] };
        const big = entry(5, 'BIG', [offering(5, 'BSIT-1A', 'F', '08:00', '09:30')], { subject: { id: 5, code: 'BIG', title: 'b', units: 6, year_level: 1 } });
        const ok = entry(7, 'OK3', [offering(7, 'BSIT-1A', 'S', '08:00', '09:30')]);
        const alt = ER.alternatives({ request: req, rejected: new Set([10]), eligible: [big, ok], room: 0 }).get(10);
        assert.deepEqual(alt.replacements.map(r => r.code), ['OK3']);
    });

    test('a subject already in the plan, one not run this term, an elective choice, or a paired subject is not offered', () => {
        const only = [offering(1, 'BSIT-1A', 'MW', '08:00', '09:30')];
        const req = { id: 9, request_item: [item(10, 1, 'AAA', only, 'BSIT-1A'), item(11, 2, 'BBB', s2, 'BSIT-1A')] };
        const f = (id, code, over) => entry(id, code, [offering(id, 'BSIT-1A', 'S', '08:00', '09:30')], over);
        const eligible = [
            f(2, 'BBB'),
            f(5, 'NORUN', { availableThisTerm: false }),
            f(6, 'ELEC', { subject: { id: 6, code: 'ELEC', title: 'e', units: 3, year_level: null } }),
            f(7, 'PAIR', { alongside: [{ id: 8, code: 'LAB' }] }),
            f(9, 'GOOD'),
        ];
        const alt = ER.alternatives({ request: req, rejected: new Set([10]), eligible, room: 3 }).get(10);
        assert.deepEqual(alt.replacements.map(r => r.code), ['GOOD']);
    });

    test('a replacement is not offered when every one of its sections was reported full', () => {
        const only = [offering(1, 'BSIT-1A', 'MW', '08:00', '09:30')];
        const req = { id: 9, request_item: [item(10, 1, 'AAA', only, 'BSIT-1A')] };
        const e = entry(5, 'GONE', [offering(5, 'BSIT-1A', 'F', '08:00', '09:30')]);
        const alt = ER.alternatives({ request: req, rejected: new Set([10]), eligible: [e], room: 3, fullKeys: new Set([ER.sectionKey(5, 'BSIT-1A')]) }).get(10);
        assert.deepEqual(alt.replacements, []);
    });

    test('no more than the limit is offered', () => {
        const only = [offering(1, 'BSIT-1A', 'MW', '08:00', '09:30')];
        const req = { id: 9, request_item: [item(10, 1, 'AAA', only, 'BSIT-1A')] };
        const many = Array.from({ length: 8 }, (_, i) => entry(20 + i, `S${i}`, [offering(20 + i, 'BSIT-1A', 'S', '08:00', '09:30')]));
        const alt = ER.alternatives({ request: req, rejected: new Set([10]), eligible: many, room: 30, max: 3 }).get(10);
        assert.equal(alt.replacements.length, 3);
    });

    test('the input request is not changed', () => {
        const req = mk();
        const before = JSON.stringify(req);
        ER.alternatives({ request: req, rejected: new Set([10]) });
        assert.equal(JSON.stringify(req), before);
    });

    test('nothing rejected gives nothing', () => {
        assert.equal(ER.alternatives({ request: mk(), rejected: new Set() }).size, 0);
    });
});

describe('switching a section', () => {
    const rowsA = [offering(1, 'X-1A', 'MWF', '08:00', '09:00'), offering(1, 'X-1B', 'MWF', '10:00', '11:00'), offering(1, 'X-1C', 'TTh', '08:00', '09:30')];
    const rowsB = [offering(2, 'X-1A', 'MWF', '10:00', '11:00')];
    const mk = () => {
        const a = item(1, 1, 'AAA', rowsA, 'X-1A', { offering_id: rowsA[0].id });
        const b = item(2, 2, 'BBB', rowsB, 'X-1A', { offering_id: rowsB[0].id });
        return { a, b, request: { request_item: [a, b] } };
    };

    test('offers other sections that do not clash with the rest of the plan', () => {
        const { a, request } = mk();
        const opts = ER.moveOptions({ request, item: a });
        // X-1B clashes with BBB (MWF 10:00), X-1C does not
        assert.deepEqual(opts.map(o => o.group.section), ['X-1C']);
        assert.equal(opts[0].offeringId, rowsA[2].id);
    });

    test('a subject turned down no longer blocks a section', () => {
        const { a, b, request } = mk();
        b.edp_result = 'rejected';
        assert.deepEqual(ER.moveOptions({ request, item: a }).map(o => o.group.section), ['X-1B', 'X-1C']);
    });

    test('a section reported full or closed is not offered', () => {
        const { a, b, request } = mk();
        b.edp_result = 'rejected';
        const full = new Set([ER.sectionKey(1, 'X-1B')]);
        assert.deepEqual(ER.moveOptions({ request, item: a, fullKeys: full }).map(o => o.group.section), ['X-1C']);
        a._allSections.find(g => g.section === 'X-1C').meetings[0].is_open = false;
        assert.deepEqual(ER.moveOptions({ request, item: a, fullKeys: full }), []);
    });

    test('a lab moves to a lab, and a section without one is skipped', () => {
        const rows = [offering(3, 'Y-1A', 'MWF', '08:00', '09:00', 'LAB'), offering(3, 'Y-1B', 'TTh', '08:00', '09:00', 'LEC'),
                      offering(3, 'Y-1C', 'TTh', '13:00', '14:00', 'LAB')];
        const lab = item(5, 3, 'CCC', rows, 'Y-1A', { offering_id: rows[0].id });
        const opts = ER.moveOptions({ request: { request_item: [lab] }, item: lab });
        assert.deepEqual(opts.map(o => o.group.section), ['Y-1C']);
        assert.equal(opts[0].offeringId, rows[2].id);
    });

    test('nothing to offer when the current meeting is unknown', () => {
        const { a, request } = mk();
        a.offering_id = 99999;
        assert.deepEqual(ER.moveOptions({ request, item: a }), []);
    });
});
