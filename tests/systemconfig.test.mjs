// systemconfig.test.mjs
// The term helper reads system_config with the dashboard's own signed-in client
// (signed-out visitors cannot read it since db/052).
//
//   node --test tests/systemconfig.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/systemconfig.js', import.meta.url), 'utf8');

function boot() {
    const topbar = { textContent: 'static text' };
    const window = {};
    const document = { getElementById: (id) => (id === 'topbar-term' ? topbar : null) };
    vm.runInNewContext(source, { window, document, console: { warn() {} } });
    return { T: window.CurriculogicTerm, topbar };
}

/* A fake client that answers the one query the helper makes. */
const clientReturning = (result) => {
    const calls = [];
    return {
        calls,
        from: (t) => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => { calls.push(t); return result; } }) }),
        }),
    };
};

describe('CurriculogicTerm', () => {
    test('has no client of its own: before setClient it answers null', async () => {
        const { T } = boot();
        assert.equal(await T.load(), null);
    });

    test('reads the term with the client it is given', async () => {
        const { T } = boot();
        const c = clientReturning({ data: { current_term: 2, current_academic_year: 2026 }, error: null });
        T.setClient(c);
        const cfg = await T.load();
        assert.equal(cfg.term, 2);
        assert.equal(cfg.year, 2026);
        assert.deepEqual(c.calls.slice(-1), ['system_config']);
    });

    test('paints the header as soon as the client arrives', async () => {
        const { T, topbar } = boot();
        T.setClient(clientReturning({ data: { current_term: 1, current_academic_year: 2023 }, error: null }));
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(topbar.textContent, '1st Sem · AY 2023–2024');
    });

    test('a refused read keeps the static header and answers null', async () => {
        const { T, topbar } = boot();
        T.setClient(clientReturning({ data: null, error: { message: 'permission denied' } }));
        assert.equal(await T.load(), null);
        assert.equal(topbar.textContent, 'static text');
    });

    test('a failed answer is not cached: a later working client is used', async () => {
        const { T } = boot();
        T.setClient(clientReturning({ data: null, error: { message: 'permission denied' } }));
        assert.equal(await T.load(), null);
        T.setClient(clientReturning({ data: { current_term: 3, current_academic_year: 2025 }, error: null }));
        assert.equal((await T.load()).term, 3);
    });

    test('formatLabel names the semester and the academic year', () => {
        const { T } = boot();
        assert.equal(T.formatLabel(1, 2023), '1st Sem · AY 2023–2024');
        assert.equal(T.formatLabel(3, 2025), 'Summer · AY 2025–2026');
    });
});

describe('every dashboard hands its client over', () => {
    for (const f of ['admin/admindashboard', 'registrar/registrardashboard', 'student/studentdashboard',
                     'faculty/facultydashboard', 'department/departmentdashboard']) {
        test(f, () => {
            const js = readFileSync(new URL(`../features/${f}.js`, import.meta.url), 'utf8');
            assert.ok(js.includes('window.CurriculogicTerm?.setClient(supabase)'), `${f}.js does not call setClient`);
        });
    }
});
