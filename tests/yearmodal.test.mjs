// yearmodal.test.mjs
// "Create Academic Year" is a compact card with a short year box, not a window-wide bar (22 Nov 2026).
//
//   node --test tests/yearmodal.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../features/department/curriculum-builder.css', import.meta.url), 'utf8');

describe('the Create Academic Year dialog', () => {
    const html = builder.slice(builder.indexOf('aria-label="Create academic year"') - 60, builder.indexOf('id="confirm-custom-year"'));
    test('has its own class, so it can be sized apart from the other dialogs', () => {
        assert.ok(html.includes('class="cbp-modal cb-yearmodal"'));
    });
    test('the year box is no longer stretched to the full width by an inline style', () => {
        assert.ok(html.includes('id="custom-year-input" class="cb-year-input"'));
        assert.ok(!html.includes('width: 100%; padding: 0.7rem'));
    });
    test('it keeps what the page relies on: the input, the range line, the error line and the confirm button', () => {
        for (const id of ['custom-year-input', 'custom-year-range', 'custom-year-error']) assert.ok(html.includes(`id="${id}"`), id);
        assert.ok(builder.includes('id="confirm-custom-year"'));
        assert.ok(html.includes('min="2000" max="2100" step="1"'));
    });
});

describe('its size', () => {
    test('a fixed small width that still fits a phone', () => {
        assert.match(css, /\.cbp-modal\.cb-yearmodal \{ width: min\(22rem, calc\(100vw - 2rem\)\); max-width: 22rem; \}/);
    });
    test('the year box is only as wide as four digits need', () => {
        assert.match(css, /\.cb-year-input \{\s+width: 9rem;/);
    });
});
