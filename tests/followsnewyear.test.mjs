// followsnewyear.test.mjs
// After the builder makes a new curriculum year, the page follows it (22 Nov 2026). Saving BSCS 2024-2025 left the Subjects panel and the
// "This is a draft" note on the 2023 version, because the page's own list did not hold the new year and `?? EDITING` kept the old one.
//
//   node --test tests/followsnewyear.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dash = readFileSync(new URL('../features/department/departmentdashboard.js', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');
const between = (src, a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));

describe('the builder tells the page which year it is on', () => {
    test('it exposes the prospectus id of the year it is working on, possibly one the page has never seen', () => {
        assert.match(builder, /currentId: \(\) => OPTS\?\.prospectusId \?\? null,/);
    });
});

describe('the page', () => {
    const mount = between(dash, 'window.CurriculumBuilder.mount(supabase, {', '/* "Edit subjects" / "Open"');
    test('keeps a pending year for the next time the list is fetched', () => {
        assert.match(dash, /let PENDING_EDIT_ID = null;/);
    });
    test('a year change to an id the page does not know is remembered, not swallowed by "?? EDITING"', () => {
        assert.match(mount, /EDITING = VERSIONS\.find\(v => v\.id === id\) \?\? EDITING;\s+if \(EDITING\?\.id !== id\) PENDING_EDIT_ID = id;/);
    });
    test('after a save, a year saved for the first time is picked up from the builder', () => {
        assert.ok(mount.includes('const current = window.CurriculumBuilder?.currentId?.();'));
        assert.ok(mount.includes('if (current && current !== EDITING?.id) PENDING_EDIT_ID = current;'));
        assert.ok(mount.indexOf('PENDING_EDIT_ID = current') < mount.indexOf('loadProspectusList();'));
    });
    test('loadCurriculum adopts it as soon as the fresh list holds it, and clears it either way', () => {
        const load = between(dash, 'async function loadCurriculum()', 'const active = PROSPECTUS;');
        assert.match(load, /if \(PENDING_EDIT_ID !== null\) \{\s+const made = VERSIONS\.find\(v => v\.id === PENDING_EDIT_ID\);\s+if \(made\) \{ EDITING = made; renderEditingSelector\(\); \}\s+PENDING_EDIT_ID = null;/);
    });
    test('the adoption happens after the list is refreshed and before the subjects are read, so the panel shows the new year', () => {
        const load = between(dash, 'async function loadCurriculum()', 'if (subErr) {');
        assert.ok(load.indexOf('setVersions(allVersions);') < load.indexOf('PENDING_EDIT_ID !== null'));
        assert.ok(load.indexOf('PENDING_EDIT_ID !== null') < load.indexOf(".eq('prospectus_id', EDITING.id)"));
    });
    test('the builder is mounted on the adopted year, not the old one', () => {
        const load = between(dash, 'async function loadCurriculum()', 'const pros = EDITING;');
        assert.ok(load.indexOf('PENDING_EDIT_ID !== null') < load.indexOf('mountCurriculumBuilder();'));
    });
});

describe('the rule, as the page applies it', () => {
    // The same decisions on plain data: what EDITING becomes for a known year, an unknown year and no change.
    const run = (versions, editing, change) => {
        let EDITING = editing; let pending = null;
        if (change) { EDITING = versions.find(v => v.id === change) ?? EDITING; if (EDITING?.id !== change) pending = change; }
        const fresh = [...versions, { id: 37 }];            // the list after it is fetched again
        if (pending !== null) { const made = fresh.find(v => v.id === pending); if (made) EDITING = made; }
        return EDITING.id;
    };
    const old = [{ id: 36 }];
    test('a new year the page did not know ends on the new year', () => assert.equal(run(old, old[0], 37), 37));
    test('a year the page already knew is chosen at once', () => assert.equal(run([{ id: 36 }, { id: 40 }], { id: 36 }, 40), 40));
    test('no change leaves the year alone', () => assert.equal(run(old, old[0], null), 36));
    test('an id that never appears leaves the year alone rather than breaking', () => assert.equal(run(old, old[0], 99), 36));
});
