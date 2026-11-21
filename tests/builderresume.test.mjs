// builderresume.test.mjs
// Continue where you left off in the curriculum builder (21 Nov 2026):
//   - a version row in Prospectus opens that version in the Curriculum tab, with its subjects
//   - the builder remembers the year you were editing, per programme
//   - an "Unsaved changes" badge, and a warning before leaving the page with work that is not saved
//
//   node --test tests/builderresume.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const builder = read('features/department/curriculum-builder.js');
const dept = read('features/department/departmentdashboard.js');
const bcss = read('features/department/curriculum-builder.css');
const dcss = read('shared/css/dashboard.css');

const slice = (src, from, to) => {
    const a = src.indexOf(from);
    assert.ok(a >= 0, `not found: ${from}`);
    const b = to ? src.indexOf(to, a + from.length) : src.length;
    assert.ok(b > a, `end not found: ${to}`);
    return src.slice(a, b);
};

describe('Prospectus: open a version from its row', () => {
    const table = slice(dept, 'tbody>${VERSIONS.map', '</tbody>');
    test('every row has an "Edit subjects" button, and the active one an "Open" button', () => {
        assert.ok(table.includes('data-open-version-btn="${v.id}"'));
        assert.ok(table.includes('Edit subjects'));
        const active = slice(table, '${v.is_active', ': `<div style');
        assert.ok(active.includes('data-open-version-btn') && active.includes('Open'));
        assert.ok(!active.includes('Edit subjects'));
    });
    test('the whole row opens it, except a click on another button of the row', () => {
        assert.ok(table.includes('data-open-version="${v.id}"'));
        const wiring = slice(dept, "body.querySelectorAll('[data-open-version]')", 'openVersionForEditing(Number(row.dataset.openVersion))');
        assert.ok(wiring.includes("e.target.closest('button, a, input, select, textarea')"));
        assert.ok(wiring.includes("!e.target.closest('[data-open-version-btn]')"));
    });
    test('the page goes to the Curriculum tab with that version', () => {
        const fn = slice(dept, 'function openVersionForEditing(id)', '/* schedule */');
        assert.ok(fn.includes('VERSIONS.find(x => x.id === id)'));
        assert.ok(fn.includes('EDITING = v;'));
        assert.ok(fn.includes("window.location.hash = '#curriculum';"));
        assert.ok(fn.includes('loadCurriculum();'));
    });
    test('a draft or published version opens in the builder, which can refuse; the active one never does', () => {
        const fn = slice(dept, 'function openVersionForEditing(id)', '/* schedule */');
        assert.ok(fn.includes('!v.is_active && window.CurriculumBuilder && !window.CurriculumBuilder.open(v)) return;'));
    });
    test('the rows look clickable', () => {
        assert.ok(dcss.includes('tr.version-row { cursor: pointer; }'));
    });
});

describe('the builder: open(), remembering the year, and unsaved changes', () => {
    test('open() loads the version\'s saved subjects, and says no for an active one or when the person keeps their unsaved work', () => {
        const fn = slice(builder, 'function open(v)', 'window.CurriculumBuilder = {');
        assert.ok(fn.includes('if (!v || v.is_active || !MOUNT) return false;'));
        assert.ok(fn.includes('isDirty() && !confirm('));
        assert.ok(fn.includes('loadExisting(v.id)'));
        assert.ok(fn.includes('applyExisting(data)'));
        assert.ok(fn.includes('rememberYear(v.academic_year);'));
    });
    test('open and isDirty are public', () => {
        const api = slice(builder, 'window.CurriculumBuilder = {', '})();');
        assert.ok(/\bopen,/.test(api) && /\bisDirty,/.test(api));
    });
    test('the year is remembered per programme and per tab session, and only the person\'s own choice', () => {
        assert.ok(builder.includes("`cb-last-year:${OPTS.programId ?? 'none'}`"));
        assert.ok(builder.includes('sessionStorage.setItem(recallKey(), String(year))'));
        assert.ok(builder.includes('sessionStorage.removeItem(recallKey())'));
        // every place the person picks or clears a year records it
        assert.ok(slice(builder, "if (pick.value === '')", '// Handle custom year selection').includes('rememberYear(null);'));
        assert.ok(slice(builder, '// Unsaved changes prompt before switching.', 'OPTS.onVersionChange?.(OPTS.prospectusId, year);').includes('rememberYear(year);'));
    });
    test('mount() reopens the remembered year, but never an active one and never another programme\'s year', () => {
        const m = slice(builder, 'function mount(supabase, opts)', 'window.CurriculumBuilder = {');
        assert.ok(m.includes('if (MOUNTED_PROGRAM !== (OPTS.programId ?? null)) SELECTED_YEAR = null;'));
        assert.ok(m.includes('const last = recalledYear();'));
        assert.ok(m.includes('if (v && !v.is_active) SELECTED_YEAR = last;'));
    });
    test('mount() loads the chosen year\'s saved subjects (the table used to come back empty after a save)', () => {
        const m = slice(builder, 'function mount(supabase, opts)', 'window.CurriculumBuilder = {');
        assert.ok(m.includes('loadExisting(OPTS.prospectusId).then('));
        assert.ok(m.includes('ROWS === mine'));
    });
    test('mount() keeps unsaved rows when the page re-mounts for the same programme', () => {
        const m = slice(builder, 'function mount(supabase, opts)', '// A year chosen for another programme');
        assert.ok(m.includes('MOUNTED_PROGRAM === (opts.programId ?? null) && isDirty()'));
        assert.ok(m.includes('prospectusId: keep'));
    });
    test('"unsaved" is the table against what was loaded or saved, never a guess from clicks', () => {
        assert.ok(builder.includes('const isDirty = () => sig() !== SAVED_SIG;'));
        const sig = slice(builder, 'function sig()', 'const isDirty');
        for (const part of ['SC.clean(r.code)', 'r.title', 'r.lec', 'r.lab', 'r.year', 'r.term', 'r.electiveType', 'r.category', 'prereqs']) {
            assert.ok(sig.includes(part), part);
        }
    });
    test('rows are marked clean when loaded, saved or cleared, so only later changes count', () => {
        const apply = builder.indexOf('function applyExisting(data)');
        assert.ok(builder.slice(apply, apply + 2500).includes('markClean();'));
        assert.ok(builder.includes('markClean();           // everything valid is saved now'));
        assert.ok(builder.includes("markClean();           // the edited rules are saved"));
        const m = slice(builder, 'function mount(supabase, opts)', 'window.CurriculumBuilder = {');
        assert.ok(m.includes('markClean();'));
    });
    test('switching or clearing a year asks only when there is something unsaved (not for a year that was just loaded)', () => {
        assert.ok(/isDirty\(\) && !confirm\(\s*'Switch curriculum year\?/.test(builder));
        assert.ok(builder.includes("if (isDirty() && !confirm('Clear the table?"));
        assert.ok(!builder.includes('if (filled().length && SELECTED_YEAR !== null && !confirm('));
    });
    test('the browser asks before leaving or reloading the page with unsaved work', () => {
        const b = slice(builder, "window.addEventListener('beforeunload'", "MOUNT.addEventListener('input'");
        assert.ok(b.includes('if (!isDirty()) return;'));
        assert.ok(b.includes('e.preventDefault();'));
        assert.ok(b.includes("e.returnValue = '';"));
    });
    test('the badge is in the page, hidden when clean, and follows typing a tick later', () => {
        assert.ok(builder.includes('id="cb-unsaved" role="status"${isDirty() ? \'\' : \' hidden\'}>Unsaved changes'));
        assert.ok(builder.includes("MOUNT.addEventListener('input',  () => setTimeout(refreshDirty, 0));"));
        assert.ok(builder.includes("MOUNT.addEventListener('change', () => setTimeout(refreshDirty, 0));"));
        assert.ok(bcss.includes('.cb-unsaved {') && bcss.includes('.cb-unsaved[hidden] { display: none; }'));
    });
});

describe('the unsaved fingerprint, run for real', () => {
    // sig() copied in shape: the same fields in the same order, so a change to any of them moves the fingerprint.
    const clean = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
    function sig(rows) {
        const codeOf = (uid) => rows.find((x) => x.uid === uid)?.code ?? '';
        return JSON.stringify(rows.filter((r) => r.code.trim() || r.title.trim()).map((r) => [
            clean(r.code), String(r.title ?? '').trim(), r.lec ?? null, r.lab ?? null, r.year, r.term, r.electiveType ?? null, r.category ?? null,
            (r.prereqs ?? []).map((p) => (p.standing ? 's' + (p.pos ?? p.standing * 10 + 2) : (p.co ? 'c' : 'p') + clean(codeOf(p.uid)))).sort(),
        ]));
    }
    const row = (uid, code, extra = {}) => ({ uid, code, title: code + ' title', lec: 3, lab: 0, year: 1, term: 1, prereqs: [], ...extra });

    test('blank rows are clean, a typed code is not, and typing it back out is clean again', () => {
        const blank = [row(1, ''), row(2, '')].map((r) => ({ ...r, title: '' }));
        const base = sig(blank);
        assert.equal(base, '[]');
        const typed = [{ ...blank[0], code: 'X' }, blank[1]];
        assert.notEqual(sig(typed), base);
        assert.equal(sig([{ ...typed[0], code: '' }, blank[1]]), base);
    });
    test('a unit, a prerequisite and a year-standing gate each change the fingerprint', () => {
        const a = row(1, 'A'), b = row(2, 'B');
        const base = sig([a, b]);
        assert.notEqual(sig([{ ...a, lec: 2 }, b]), base);
        assert.notEqual(sig([a, { ...b, prereqs: [{ uid: 1 }] }]), base);
        assert.notEqual(sig([a, { ...b, prereqs: [{ standing: 2 }] }]), base);
        assert.notEqual(sig([a, { ...b, prereqs: [{ uid: 1, co: true }] }]), sig([a, { ...b, prereqs: [{ uid: 1 }] }]));
    });
    test('the same rows with different internal ids and a different order of prerequisites are the same', () => {
        const x = sig([row(1, 'A'), row(2, 'B', { prereqs: [{ uid: 1 }, { standing: 2 }] })]);
        const y = sig([row(7, 'A'), row(9, 'B', { prereqs: [{ standing: 2 }, { uid: 7 }] })]);
        assert.equal(x, y);
    });
});
