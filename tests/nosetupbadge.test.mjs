// nosetupbadge.test.mjs
// The "Setup 2/4" badge is gone from the Department header (22 Nov 2026). It counted four steps for the chosen programme (an active curriculum,
// subjects in it, a schedule for the current term, a student) and showed dots; it left once all four were done. It is removed on request.
//
//   node --test tests/nosetupbadge.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('the page has no badge element', () => {
    assert.ok(!read('features/department/departmentdashboard.html').includes('setup-badge'));
});
test('the script neither draws nor refers to it', () => {
    const js = read('features/department/departmentdashboard.js');
    for (const gone of ['renderSetupBadge', 'setup-badge', 'Setup ${complete}']) assert.ok(!js.includes(gone), gone);
});
test('no stylesheet keeps rules for it, and its animation went with it', () => {
    for (const css of ['shared/css/dashboard.css', 'shared/css/dashboard-paper.css']) {
        const s = read(css);
        assert.ok(!s.includes('setup-badge'), css);
        assert.ok(!s.includes('dot-on'), css);
    }
});
test('the header still has its title and its line, so the layout is not left with a hole', () => {
    const html = read('features/department/departmentdashboard.html');
    assert.ok(html.includes('id="greeting"'));
    assert.ok(html.includes('id="hero-line"'));
});
test('what the badge was computed from is still there for the pages that need it (blocked panels read READY)', () => {
    const js = read('features/department/departmentdashboard.js');
    assert.ok(js.includes('READY.prospectus = !!PROSPECTUS;'));
    assert.ok(js.includes('READY.subjects   = SUBJECTS.length;'));
    assert.ok(js.includes('READY.offerings'));
    assert.ok(js.includes('READY.students'));
});
