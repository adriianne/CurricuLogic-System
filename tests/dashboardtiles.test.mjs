// dashboardtiles.test.mjs
// Every tile on every role's dashboard opens the page it counts. The tile is the link, styled once in dashboard.css.
//
//   node --test tests/dashboardtiles.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

/* The tile that holds the number with this id: { tag, href, hasGo } */
function tileOf(html, id) {
    const at = html.indexOf('id="' + id + '"');
    assert.ok(at > 0, 'no ' + id);
    const open = Math.max(html.lastIndexOf('<div class="stat', at), html.lastIndexOf('<a class="stat', at));
    const head = html.slice(open, html.indexOf('>', open) + 1);
    const closeTag = head.startsWith('<a') ? '</a>' : '</div>';
    const body = html.slice(open, html.indexOf(closeTag, at));
    return { tag: head.startsWith('<a') ? 'a' : 'div', href: (head.match(/href="([^"]+)"/) || [])[1] || null, hasGo: body.includes('stat-go') };
}

const EXPECT = {
    'features/faculty/facultydashboard.html': {
        'stat-students': '#students/all', 'stat-verified': '#students/verified', 'stat-pending': '#students/pending', 'stat-requests': '#requests',
    },
    'features/registrar/registrardashboard.html': {
        'stat-advising': '#advising', 'stat-approved': '#students', 'stat-verified': '#students',
    },
    'features/student/studentdashboard.html': {
        'stat-eligible': '#plan', 'stat-locked': '#prospectus', 'stat-done': '#record', 'stat-units': '#record',
    },
    'features/admin/admindashboard.html': {
        'stat-faculty': '#staff/faculty', 'stat-registrar': '#staff/registrar', 'stat-department': '#staff/department', 'stat-students': '#students',
    },
};

describe('the tiles are links', () => {
    for (const [file, tiles] of Object.entries(EXPECT)) {
        for (const [id, href] of Object.entries(tiles)) {
            test(file.split('/')[1] + ': ' + id + ' opens ' + href, () => {
                const t = tileOf(read(file), id);
                assert.equal(t.tag, 'a');
                assert.equal(t.href, href);
                assert.ok(t.hasGo, 'shows "View ->"');
            });
        }
    }
    test('the Department tiles were already links', () => {
        const html = read('features/department/departmentdashboard.html');
        for (const h of ['#curriculum', '#schedule', '#grades']) assert.match(html, new RegExp('<a class="tile" href="' + h + '"'));
    });
});

describe('every link goes to a page that exists in that role', () => {
    const views = {
        'features/registrar/registrardashboard.js': ['advising', 'students'],
        'features/student/studentdashboard.js': ['plan', 'prospectus', 'record'],
        'features/admin/admindashboard.js': ['staff', 'students'],
    };
    for (const [file, names] of Object.entries(views)) {
        test(file.split('/')[1] + ' knows ' + names.join(', '), () => {
            const js = read(file);
            const block = js.slice(js.indexOf('const VIEWS = {'), js.indexOf('};', js.indexOf('const VIEWS = {')));
            for (const n of names) assert.ok(block.includes('\n    ' + n + ':'), n + ' is a page of this role');
        });
    }
});

describe('the link style is shared, once', () => {
    const css = read('shared/css/dashboard.css');
    test('dashboard.css has the rules', () => {
        assert.match(css, /\.stat-link \{ display: block; text-decoration: none; color: inherit; cursor: pointer;/);
        assert.match(css, /\.stat-link:focus-visible \{ outline: 2px solid var\(--indigo\)/);
        assert.match(css, /\.stat-go \{ display: block;/);
        assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.stat-link, \.stat-go i \{ transition: none; \}/);
    });
    test('the Faculty page no longer carries its own copy', () => {
        assert.doesNotMatch(read('features/faculty/facultydashboard.html'), /\.stat-link \{/);
    });
});

describe('Admin: #staff/<role> opens Staff management for that role', () => {
    const js = read('features/admin/admindashboard.js');
    test('the part after the slash is not taken as the page name', () => {
        assert.match(js, /const name = window\.location\.hash\.replace\('#', ''\)\.split\('\/'\)\[0\];/);
        assert.match(js, /return name in VIEWS \? name : 'dashboard';/);
    });
    test('only the three staff roles are accepted, and the list goes back to its first page', () => {
        assert.match(js, /const STAFF_ROLES = \['faculty', 'registrar', 'department'\];/);
        assert.match(js, /if \(filter && STAFF_ROLES\.includes\(choice\)\) \{ filter\.value = choice; STAFF_PAGE = 1; \}/);
    });
    test('the role list in the page offers exactly those values', () => {
        const html = read('features/admin/admindashboard.html');
        const sel = html.slice(html.indexOf('id="staff-filter"'), html.indexOf('</select>', html.indexOf('id="staff-filter"')));
        for (const r of ['all', 'faculty', 'registrar', 'department']) assert.match(sel, new RegExp('value="' + r + '"'));
    });
});
