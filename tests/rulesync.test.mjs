// rulesync.test.mjs
// Saving prerequisite edits on subjects that are already saved in the curriculum builder (found 17 Nov 2026: the edits were
// silently dropped; nine elective prerequisites were "corrected" three times on screen and never stored).
//   node --test tests/rulesync.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const RS = require('../shared/js/curriculum/rulesync.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const deps = {
    key: (c) => String(c).trim().toUpperCase().replace(/\s+/g, ' '),
    requirementType: (p) => (p.co ? 'co_requisite' : 'prerequisite'),
    standingToDb: (p) => p.pos ?? p.standing * 10 + 2,
};

let seq = 0;
const row = (code, o = {}) => ({ uid: ++seq, code, prereqs: [], errors: [], ...o });

describe('signature', () => {
    test('is the same whatever order the conditions were added in', () => {
        const a = row('A'), b = row('B');
        const c = row('C'); c.prereqs = [{ uid: a.uid }, { uid: b.uid }];
        const c2 = row('C2'); c2.prereqs = [{ uid: b.uid }, { uid: a.uid }];
        const rows = [a, b, c, c2];
        assert.equal(RS.signature(c, rows, deps), 'prerequisite:A|prerequisite:B');
        assert.equal(RS.signature(c2, rows, deps), RS.signature(c, rows, deps));
    });
    test('tells a prerequisite from a "taken alongside" condition and from a year standing', () => {
        const a = row('A'), x = row('X');
        x.prereqs = [{ uid: a.uid, co: true }, { standing: 3, pos: 32 }];
        assert.equal(RS.signature(x, [a, x], deps), 'co_requisite:A|standing:32');
    });
    test('a row with no conditions has an empty signature', () => {
        assert.equal(RS.signature(row('A'), [], deps), '');
        assert.equal(RS.signature(undefined, [], deps), '');
    });
    test('a condition pointing at a row that is gone is marked, not lost', () => {
        const x = row('X'); x.prereqs = [{ uid: 99999 }];
        assert.equal(RS.signature(x, [x], deps), 'prerequisite:?');
    });
});

describe('changedRows: which saved subjects were edited', () => {
    function loaded() {
        const a = row('A', { dbId: 1 }), b = row('B', { dbId: 2 }), c = row('C', { dbId: 3 });
        b.prereqs = [{ uid: a.uid }];
        const rows = [a, b, c];
        for (const r of rows) r.savedRules = RS.signature(r, rows, deps);
        return { rows, a, b, c };
    }
    test('nothing changed: nothing to write', () => {
        assert.deepEqual(RS.changedRows(loaded().rows, deps), []);
    });
    test('a changed prerequisite is found, and only that row', () => {
        const { rows, b, c } = loaded();
        b.prereqs = [{ uid: c.uid }];                      // ELDNET1: IT-IMDBSYS31 -> IT-PLATECH22
        assert.deepEqual(RS.changedRows(rows, deps).map(r => r.code), ['B']);
    });
    test('a removed prerequisite and an added one are both found', () => {
        const { rows, a, b, c } = loaded();
        b.prereqs = [];                                    // ELAI: removed
        c.prereqs = [{ uid: a.uid }];                      // FREPM: added
        assert.deepEqual(RS.changedRows(rows, deps).map(r => r.code).sort(), ['B', 'C']);
    });
    test('a new row (no dbId) is not this function’s job', () => {
        const { rows } = loaded();
        rows.push(row('NEW', { prereqs: [{ uid: rows[0].uid }] }));
        assert.deepEqual(RS.changedRows(rows, deps), []);
    });
    test('a row that was never loaded from the database (no remembered rules) is left alone', () => {
        const x = row('X', { dbId: 9 });
        assert.deepEqual(RS.changedRows([x], deps), []);
    });
    test('a row with errors is not written until it is fixed', () => {
        const { rows, b, c } = loaded();
        b.prereqs = [{ uid: c.uid }]; b.errors = ['Missing title'];
        assert.deepEqual(RS.changedRows(rows, deps), []);
    });
});

describe('ruleRows', () => {
    test('builds one stored rule per condition, in groups 1, 2, ...', () => {
        const a = row('A'), b = row('B'), x = row('X', { dbId: 7 });
        x.prereqs = [{ uid: a.uid }, { uid: b.uid, co: true }, { standing: 2, pos: 22 }];
        const byCode = new Map([['A', 11], ['B', 12], ['X', 7]]);
        const { rules, dropped } = RS.ruleRows(7, x, [a, b, x], byCode, deps, 'staff-1');
        assert.equal(dropped, 0);
        assert.deepEqual(rules.map(r => [r.subject_id, r.prerequisite_subject_id, r.requirement_type, r.rule_group, r.threshold_value, r.created_by]), [
            [7, 11, 'prerequisite', 1, null, 'staff-1'],
            [7, 12, 'co_requisite', 2, null, 'staff-1'],
            [7, null, 'standing', 3, 22, 'staff-1'],
        ]);
        assert.ok(rules.every(r => r.rule_type === 'and'));
    });
    test('a prerequisite with no id yet is counted as dropped, never silently lost', () => {
        const a = row('A'), x = row('X', { dbId: 7 });
        x.prereqs = [{ uid: a.uid }];
        const { rules, dropped } = RS.ruleRows(7, x, [a, x], new Map([['X', 7]]), deps, 's');
        assert.equal(rules.length, 0);
        assert.equal(dropped, 1);
    });
    test('no conditions: no rules (the old ones are then deleted)', () => {
        assert.deepEqual(RS.ruleRows(1, row('X'), [], new Map(), deps, 's'), { rules: [], dropped: 0 });
    });
});

describe('message', () => {
    test('says how many saved subjects were updated', () => {
        assert.match(RS.message(1, 0), /1 saved subject were stored/);
        assert.match(RS.message(9, 0), /9 saved subjects were stored/);
    });
    test('says what could not be stored', () => {
        assert.match(RS.message(2, 1), /1 prerequisite could not be stored/);
        assert.match(RS.message(2, 3), /3 prerequisites could not be stored/);
    });
});

// ---- the real function from the builder, run against a fake database ----
describe('syncExistingRules (the builder’s own code)', () => {
    const src = read('features/department/curriculum-builder.js');
    const start = src.indexOf('async function syncExistingRules');
    const end = src.indexOf('async function saveDraft()');
    const fnSource = src.slice(start, end);

    function world({ failOn } = {}) {
        const calls = [];
        const store = new Map();                            // subject_id -> [{ id, ... }]
        let nextId = 1000;
        const SB = {
            from(table) {
                assert.equal(table, 'prerequisite');
                return {
                    select() {
                        return { eq: async (col, id) => {
                            calls.push(['select', id]);
                            if (failOn === 'select') return { error: { message: 'select failed' } };
                            return { data: (store.get(id) ?? []).map(r => ({ id: r.id })) };
                        } };
                    },
                    insert: async (rows) => {
                        calls.push(['insert', rows.map(r => r.prerequisite_subject_id ?? r.threshold_value)]);
                        if (failOn === 'insert') return { error: { message: 'insert failed' } };
                        for (const r of rows) {
                            const l = store.get(r.subject_id) ?? [];
                            l.push({ ...r, id: nextId++ });
                            store.set(r.subject_id, l);
                        }
                        return { error: null };
                    },
                    delete() {
                        return { in: async (col, ids) => {
                            calls.push(['delete', ids]);
                            if (failOn === 'delete') return { error: { message: 'delete failed' } };
                            for (const [k, l] of store) store.set(k, l.filter(r => !ids.includes(r.id)));
                            return { error: null };
                        } };
                    },
                };
            },
        };
        return { SB, calls, store };
    }

    function build(env) {
        const a = row('A', { dbId: 1 }), b = row('B', { dbId: 2 }), c = row('C', { dbId: 3 });
        b.prereqs = [{ uid: a.uid }];
        const ROWS = [a, b, c];
        for (const r of ROWS) r.savedRules = RS.signature(r, ROWS, deps);
        env.store.set(2, [{ id: 500, subject_id: 2, prerequisite_subject_id: 1 }]);
        const OPTS = { staffId: 'staff-1' };
        const make = new Function('SB', 'ROWS', 'OPTS', 'RULE_DEPS', 'filled', `${fnSource}; return syncExistingRules;`);
        const sync = make(env.SB, ROWS, OPTS, deps, () => ROWS);
        return { sync, ROWS, a, b, c, byCode: new Map([['A', 1], ['B', 2], ['C', 3]]) };
    }
    // the function reads window.CurriculogicRuleSync; give it one
    globalThis.window = { CurriculogicRuleSync: RS };

    test('nothing edited: the database is not touched at all', async () => {
        const env = world(); const w = build(env);
        const r = await w.sync(w.byCode);
        assert.deepEqual(r, { count: 0, dropped: 0, error: null });
        assert.deepEqual(env.calls, []);
    });
    test('an edited subject: the new rule goes in FIRST, then the old one is deleted', async () => {
        const env = world(); const w = build(env);
        w.b.prereqs = [{ uid: w.c.uid }];                  // B now requires C instead of A
        const r = await w.sync(w.byCode);
        assert.equal(r.count, 1);
        assert.equal(r.error, null);
        assert.deepEqual(env.calls.map(c => c[0]), ['select', 'insert', 'delete']);
        assert.deepEqual(env.calls[1], ['insert', [3]]);
        assert.deepEqual(env.calls[2], ['delete', [500]]);
        assert.deepEqual(env.store.get(2).map(x => x.prerequisite_subject_id), [3]);
    });
    test('after a successful save the row is no longer "edited", so saving twice does nothing the second time', async () => {
        const env = world(); const w = build(env);
        w.b.prereqs = [{ uid: w.c.uid }];
        await w.sync(w.byCode);
        env.calls.length = 0;
        const again = await w.sync(w.byCode);
        assert.equal(again.count, 0);
        assert.deepEqual(env.calls, []);
    });
    test('removing every prerequisite deletes the old rules and inserts nothing', async () => {
        const env = world(); const w = build(env);
        w.b.prereqs = [];
        const r = await w.sync(w.byCode);
        assert.equal(r.count, 1);
        assert.deepEqual(env.calls.map(c => c[0]), ['select', 'delete']);
        assert.deepEqual(env.store.get(2), []);
    });
    test('if storing the new rules fails, the old rules are kept and the row stays "edited"', async () => {
        const env = world({ failOn: 'insert' }); const w = build(env);
        w.b.prereqs = [{ uid: w.c.uid }];
        const r = await w.sync(w.byCode);
        assert.match(r.error, /Could not store the prerequisites of B \(nothing was changed for it\)/);
        assert.equal(r.count, 0);
        assert.ok(!env.calls.some(c => c[0] === 'delete'), 'nothing was deleted');
        assert.deepEqual(env.store.get(2).map(x => x.prerequisite_subject_id), [1]);
        assert.equal(RS.changedRows(w.ROWS, deps).length, 1);
    });
    test('if deleting the old rules fails, it says so', async () => {
        const env = world({ failOn: 'delete' }); const w = build(env);
        w.b.prereqs = [{ uid: w.c.uid }];
        const r = await w.sync(w.byCode);
        assert.match(r.error, /new prerequisites of B were stored, but the old ones could not be removed/);
    });
    test('if reading the saved rules fails, nothing is written', async () => {
        const env = world({ failOn: 'select' }); const w = build(env);
        w.b.prereqs = [{ uid: w.c.uid }];
        const r = await w.sync(w.byCode);
        assert.match(r.error, /Could not read the saved rules of B/);
        assert.ok(!env.calls.some(c => c[0] === 'insert' || c[0] === 'delete'));
    });
});

describe('the page uses it', () => {
    const js = read('features/department/curriculum-builder.js');
    const html = read('features/department/departmentdashboard.html');
    test('the module loads before the builder', () => {
        assert.ok(html.includes('shared/js/curriculum/rulesync.js'));
        assert.ok(html.indexOf('rulesync.js') < html.indexOf('<script src="curriculum-builder.js">'));
    });
    test('a loaded subject remembers what its rules were', () => {
        assert.match(js, /row\.savedRules = window\.CurriculogicRuleSync\.signature\(row, ROWS, RULE_DEPS\)/);
    });
    test('Save (unpublished) rewrites edited rules both when new subjects were added and when none were, and Create does too', () => {
        assert.equal((js.match(/await syncExistingRules\(/g) || []).length, 3);
    });
    test('Create curriculum rewrites them too', () => {
        const commit = js.slice(js.indexOf('async function commit()'));
        assert.match(commit, /await syncExistingRules\(byCode\)/);
    });
    test('the hint tells the person there are edits to store', () => {
        assert.match(js, /edited prerequisites \\u2014 press Save \(unpublished\) to store/);
    });
});
