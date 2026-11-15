// requestcardphone.test.mjs
// On a phone, each subject of a request is a card (shared/css/prospectus.css, container "req-body"). A subject with a
// warning has its reason in the status cell. That cell is "white-space: nowrap", so left in the top-right corner the
// one long line made it as wide as the screen and squeezed the subject code to 0 px (seen at 390 px on 14 Nov).
// The reason now goes to its own full-width row at the bottom of the card and wraps.
//
//   node --test tests/requestcardphone.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const css = read('shared/css/prospectus.css');
const js = read('features/faculty/facultydashboard.js');

/* The narrow-card block of the request table. */
const narrow = (() => {
    const at = css.indexOf('@container req-body (max-width: 640px) {');
    assert.ok(at > 0, 'the narrow card block exists');
    return css.slice(at, css.indexOf('\n}', at));
})();

describe('a warned subject on a phone', () => {
    test('the status cell with a reason takes its own full-width row, below the schedule line', () => {
        assert.match(narrow, /\.req-table td\.req-status-cell:has\(\.req-flag-reason\) \{/);
        assert.match(narrow, /grid-column: 1 \/ -1; grid-row: 5;/);
    });
    test('the reason wraps instead of running on one line', () => {
        assert.match(narrow, /white-space: normal;/);
        assert.match(narrow, /\.req-table \.req-flag-reason \{ flex: 1 0 100%; margin-top: 0; \}/);
    });
    test('a cell with no reason keeps the top-right corner', () => {
        assert.match(narrow, /\.req-table td\.req-status-cell \{ grid-column: 2; grid-row: 1;/);
    });
    test('the reason really is inside the status cell (the thing the rule above relies on)', () => {
        // The reason is part of statusHtml, and statusHtml is what goes inside the cell.
        assert.match(js, /<td class="req-status-cell">\$\{statusHtml\}<\/td>/);
        assert.ok(js.indexOf('req-flag-reason') > 0 && js.indexOf('req-flag-reason') < js.indexOf('<td class="req-status-cell">'));
    });
    test('the cell is "nowrap" on a wide table, which is why the phone rule must turn it off', () => {
        assert.match(css, /\.req-status-cell \{ text-align: right; white-space: nowrap; \}/);
    });
});

describe('the student\'s request table on a phone (shared/css/dashboard.css, container "mreq")', () => {
    const dash = read('shared/css/dashboard.css');
    const at = dash.indexOf('@container mreq (max-width: 640px) {');
    const mreq = at > 0 ? dash.slice(at, dash.indexOf('\n}', at)) : '';
    test('each request card is a container, so the layout follows the card and not the screen', () => {
        assert.match(dash, /\.req-card-body \{ container: mreq \/ inline-size; \}/);
        assert.ok(mreq.length > 0, 'the narrow block exists');
    });
    test('the table header goes and every subject row becomes a two-column card', () => {
        assert.match(mreq, /\.my-req-table thead \{ display: none; \}/);
        assert.match(mreq, /display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/);
        assert.match(mreq, /\.req-card-body \.table-wrap \{ overflow: visible; \}/);
    });
    test('subject and reason top-left, status top-right, then section, then units', () => {
        assert.match(mreq, /td:nth-child\(1\) \{ grid-column: 1; grid-row: 1; \}/);
        assert.match(mreq, /td:nth-child\(4\) \{ grid-column: 2; grid-row: 1; align-self: start; \}/);
        assert.match(mreq, /td:nth-child\(2\) \{ grid-column: 1 \/ -1; grid-row: 2;/);
        assert.match(mreq, /td\.num \{ grid-column: 1 \/ -1; grid-row: 3;[^}]*text-align: left;/);
        assert.match(mreq, /content: ' units'/);
        assert.match(mreq, /content: 'Section '/);
    });
    test('the four columns are still in this order in the page (the rules above depend on it)', () => {
        const js = read('features/student/studentdashboard.js');
        assert.match(js, /<thead><tr><th>Subject<\/th><th>Section and time<\/th><th class="num">Units<\/th><th>Status<\/th><\/tr><\/thead>/);
    });
});
