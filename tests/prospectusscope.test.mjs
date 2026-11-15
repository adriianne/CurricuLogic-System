// prospectusscope.test.mjs
// The Prospectus tab follows the header programme switch (Faculty and Registrar who cover several programmes):
// shared/js/curriculum/prospectusgrid.js, and how the two pages call it.
//
//   node --test tests/prospectusscope.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const grid = read('shared/js/curriculum/prospectusgrid.js');

/* Pull one top-level function out of the grid script so it can run on its own. */
function lift(name) {
    const at = grid.indexOf('function ' + name + '(');
    assert.ok(at >= 0, name + ' not found');
    let depth = 0, end = grid.indexOf('{', at);
    for (let j = end; j < grid.length; j++) {
        if (grid[j] === '{') depth++;
        if (grid[j] === '}' && --depth === 0) { end = j; break; }
    }
    return grid.slice(at, end + 1);
}
const versionsForScope = new Function(lift('versionsForScope') + '; return versionsForScope;')();
const spansProgrammes = new Function(lift('spansProgrammes') + '; return spansProgrammes;')();

const versions = [
    { id: 1, program_id: 7,  academic_year: 2023, is_active: true },
    { id: 2, program_id: 7,  academic_year: 2019, is_active: false },
    { id: 3, program_id: 11, academic_year: 2023, is_active: true },
    { id: 4, program_id: 12, academic_year: 2024, is_active: true },
];

describe('which versions are listed', () => {
    test('every version when no programme is chosen', () => {
        assert.deepEqual(versionsForScope(versions, null).map(v => v.id), [1, 2, 3, 4]);
    });
    test('only the chosen programme\'s versions when one is chosen', () => {
        assert.deepEqual(versionsForScope(versions, 7).map(v => v.id), [1, 2]);
        assert.deepEqual(versionsForScope(versions, 11).map(v => v.id), [3]);
    });
    test('a programme with no published version gives an empty list, not another programme\'s', () => {
        assert.deepEqual(versionsForScope(versions, 99), []);
    });
    test('a programme id given as text still matches', () => {
        assert.deepEqual(versionsForScope(versions, '7').map(v => v.id), [1, 2]);
    });
});

describe('telling versions of different programmes apart', () => {
    test('the programme code is needed only when several programmes are listed together', () => {
        assert.equal(spansProgrammes(versions), true);
        assert.equal(spansProgrammes(versionsForScope(versions, 7)), false);
        assert.equal(spansProgrammes([]), false);
    });
    test('both the dropdown labels and the chips carry the code when it is needed', () => {
        assert.match(grid, /const showCode = scope == null && spansProgrammes\(versions\)/);
        assert.match(grid, /showCode && programmeCode\(v\) \? programmeCode\(v\) \+ ' \\u00b7 ' : ''/);
        assert.match(grid, /chipsHtml\(versions, Number\(select\.value\), showCode\)/);
        assert.match(grid, /const code = showCode \? programmeCode\(v\) : ''/);
    });
});

describe('rebuilding when the choice changes', () => {
    test('the same choice leaves the picker alone; a different one tears it down and rebuilds it', () => {
        assert.match(grid, /if \(already && already\.programId !== scope\) \{ already\.cleanup\(\); mounted\.delete\(select\); \}/);
        assert.match(grid, /mounted\.set\(select, \{\s*programId: scope,/);
    });
    test('the teardown removes what the picker added, so nothing stacks up', () => {
        const cleanup = grid.match(/cleanup\(\) \{[\s\S]*?\n            \},/)[0];
        assert.match(cleanup, /meta\.remove\(\)/);
        assert.match(cleanup, /chips\.remove\(\)/);
        assert.match(cleanup, /select\.hidden = false/);
        assert.match(cleanup, /select\.onchange = null/);
    });
    test('a programme with nothing published says so, with the programme name as the heading', () => {
        assert.match(grid, /No curriculum published for this programme/);
        assert.match(grid, /title\.textContent = window\.CurriculogicPrograms\?\.nameOf\(scope, 'Prospectus'\)/);
    });
    test('the old call without a programme still works (every version)', () => {
        assert.match(grid, /async function mountVersions\(supabase, \{ select, body, title, programId = null \}\)/);
    });
});

describe('the two pages', () => {
    for (const [page, loader] of [['faculty', 'loadProspectusPage'], ['registrar', 'loadProspectus']]) {
        const js = read(`features/${page}/${page}dashboard.js`);
        test(`${page}: passes the header choice to the grid`, () => {
            assert.match(js, /programId: PROGRAM_SCOPE === 'all' \? null : PROGRAM_SCOPE/);
        });
        test(`${page}: re-draws the Prospectus tab at once if it is the one showing when the choice changes`, () => {
            assert.match(js, new RegExp("if \\(parseHash\\(\\)\\.name === 'prospectus'\\) " + loader + '\\(\\);'));
        });
    }
});
