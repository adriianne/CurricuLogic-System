// dashboardlayout.test.mjs
// Guards for the Department, Registrar and Faculty dashboards: no element id used twice on a page, the header and
// attention parts every page needs are there, and the new motion only plays for a person who has not asked for
// reduced motion.
//
//   node --test tests/dashboardlayout.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const FEATURES = path.resolve('features');
const pages = [];
for (const dir of fs.readdirSync(FEATURES)) {
    const full = path.join(FEATURES, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of fs.readdirSync(full)) if (f.endsWith('.html')) pages.push({ name: `${dir}/${f}`, file: path.join(full, f) });
}
const read = (file) => fs.readFileSync(file, 'utf8');
const idsOf = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);

describe('no id is used twice on a page', () => {
    // getElementById answers with the first one, so a second element with the same id never receives what is written to it
    for (const page of pages) {
        test(page.name, () => {
            const ids = idsOf(read(page.file));
            const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
            assert.deepEqual(dup, []);
        });
    }
});

describe('the three dashboards carry what the new header and list need', () => {
    const NEEDED = ['hero-eyebrow', 'greeting', 'hero-line', 'attention-card', 'attention-body', 'attention-note'];
    const dashboards = ['department/departmentdashboard.html', 'registrar/registrardashboard.html', 'faculty/facultydashboard.html'];

    for (const name of dashboards) {
        test(name, () => {
            const html = read(path.join(FEATURES, name));
            const ids = new Set(idsOf(html));
            for (const id of NEEDED) assert.ok(ids.has(id), `missing #${id}`);
        });
    }

    test('the Registrar and Faculty pages load the shared summary module before their own script', () => {
        for (const name of ['registrar/registrardashboard.html', 'faculty/facultydashboard.html']) {
            const html = read(path.join(FEATURES, name));
            const mod = html.indexOf('shared/js/dashboardsummary.js');
            const own = html.search(/src="(registrar|faculty)dashboard\.js"/);
            assert.ok(mod > 0, name + ' does not load dashboardsummary.js');
            assert.ok(mod < own, name + ' loads it after its own script');
        }
    });

    test('the Department page loads the section demand rules before its own script', () => {
        const html = read(path.join(FEATURES, 'department/departmentdashboard.html'));
        assert.ok(html.indexOf('shared/js/sectiondemand.js') > 0);
        assert.ok(html.indexOf('shared/js/sectiondemand.js') < html.search(/src="departmentdashboard\.js"/));
    });

    test('the student page and the subject page of the Department do not share a subtitle id', () => {
        const html = read(path.join(FEATURES, 'department/departmentdashboard.html'));
        const js = read(path.join(FEATURES, 'department/departmentdashboard.js'));
        assert.ok(html.includes('id="student-sub"'));
        assert.ok(html.includes('id="detail-sub"'));
        assert.ok(js.includes("setText('student-sub'"));
    });
});

/* ---- motion ---- */

/* Every rule of a stylesheet with the at-rules around it: [{ selector, body, context: ['@media ...'] }]. */
function rulesOf(css) {
    const out = [];
    const stack = [];
    let buf = '';
    let body = '';
    let inString = null;
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (let i = 0; i < clean.length; i++) {
        const c = clean[i];
        if (inString) { buf += c; if (c === inString) inString = null; continue; }
        if (c === '"' || c === "'") { inString = c; buf += c; continue; }
        if (c === '{') {
            const head = buf.trim();
            buf = '';
            stack.push({ head, text: '' });
            continue;
        }
        if (c === '}') {
            const top = stack.pop();
            if (top && !top.head.startsWith('@')) {
                out.push({ selector: top.head, body: top.text + buf, context: stack.map(s => s.head).filter(h => h.startsWith('@')) });
            }
            buf = '';
            continue;
        }
        if (stack.length && !stack[stack.length - 1].head.startsWith('@')) stack[stack.length - 1].text += c;
        else buf += c;
    }
    return out;
}

describe('motion only plays for a person who has not asked for reduced motion', () => {
    const css = read(path.resolve('shared/css/dashboard.css'));
    const rules = rulesOf(css);

    test('the stylesheet reads as rules (the checks below are not looking at nothing)', () => {
        assert.ok(rules.length > 500, 'only ' + rules.length + ' rules found');
        assert.ok(rules.some(r => /\.demand-tile/.test(r.selector)));
    });

    const NEW = /\.(attention-item|demand-board|demand-tile|demand-detail|demand-year|demand-names-row|demand-confirm|demand-help|prospectus-details|hero\b|hero-|setup-badge-dot)/;

    test('every animation of the new parts sits inside the no-preference block', () => {
        const offenders = rules
            .filter(r => NEW.test(r.selector) && /animation\s*:/.test(r.body))
            .filter(r => !r.context.some(c => /prefers-reduced-motion:\s*no-preference/.test(c)))
            .map(r => r.selector.replace(/\s+/g, ' '));
        assert.deepEqual(offenders, []);
    });

    test('the new animations really are there (so the test above can fail)', () => {
        const animated = rules.filter(r => NEW.test(r.selector) && /animation\s*:/.test(r.body));
        assert.ok(animated.length >= 8, 'found ' + animated.length);
    });

    test('nothing in the new motion loops forever', () => {
        const forever = rules.filter(r => NEW.test(r.selector) && /animation[^;]*\binfinite\b/.test(r.body)).map(r => r.selector);
        assert.deepEqual(forever, []);
    });

    test('every keyframe a new animation names is defined', () => {
        const defined = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]));
        const used = new Set();
        for (const r of rules.filter(r => NEW.test(r.selector))) {
            for (const m of r.body.matchAll(/animation\s*:\s*([\w-]+)/g)) used.add(m[1]);
        }
        const missing = [...used].filter(k => !defined.has(k));
        assert.deepEqual(missing, []);
    });
});
