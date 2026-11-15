// requestbadge.test.mjs
// The Faculty menu count beside "Advising requests" and its one-minute refresh. These tests read the files; the badge
// was also looked at in the browser preview.
//
//   node --test tests/requestbadge.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('features/faculty/facultydashboard.html');
const js = read('features/faculty/facultydashboard.js');

describe('menu badge', () => {
    test('sits inside the Advising requests link, hidden until counted', () => {
        const link = html.match(/<a href="#requests"[\s\S]*?<\/a>/)[0];
        assert.match(link, /class="nav-count" id="nav-requests" hidden/);
    });
    test('is painted from the same count as the dashboard, and hidden at zero', () => {
        assert.match(js, /paintRequestBadge\(REQUEST_COUNT\)/);
        assert.match(js, /badge\.hidden = !\(n > 0\)/);
    });
    test('caps a long count at 99+', () => {
        assert.match(js, /n > 99 \? '99\+'/);
    });
});

describe('auto refresh', () => {
    test('runs every minute and when the tab comes back, and is started once the page has loaded', () => {
        assert.match(js, /REQUEST_REFRESH_MS = 60 \* 1000/);
        assert.match(js, /setInterval\(refreshRequests, REQUEST_REFRESH_MS\)/);
        assert.match(js, /visibilitychange/);
        assert.match(js, /startRequestRefresh\(\);\s*route\(\);/);
    });
    test('skips a hidden tab, preview mode and an overlapping run', () => {
        const fn = js.match(/async function refreshRequests\(\) \{[\s\S]*?\n\}/)[0];
        assert.match(fn, /PREVIEW \|\| !supabase \|\| !FACULTY \|\| document\.hidden \|\| REFRESH_BUSY/);
    });
    test('reloads the queue only when the count changed and no plan is open', () => {
        const fn = js.match(/async function refreshRequests\(\) \{[\s\S]*?\n\}/)[0];
        assert.match(fn, /REQUEST_COUNT !== before && !REQUEST_FAILED && name === 'requests' && !param/);
    });
});
