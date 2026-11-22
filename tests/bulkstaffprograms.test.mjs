// bulkstaffprograms.test.mjs
// Admin > Staff management: set the programmes of many faculty or registrars in one action (db/129).
//
//   node --test tests/bulkstaffprograms.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('db/129_bulk_staff_programs.sql');
const js = read('features/admin/admindashboard.js');
const html = read('features/admin/admindashboard.html');
const css = read('shared/css/dashboard.css');

describe('the database function (db/129)', () => {
    test('only a System administrator can call it, and anonymous callers cannot run it', () => {
        assert.ok(sql.includes('if not public.is_system_admin() then'));
        assert.ok(sql.indexOf('is_system_admin()') < sql.indexOf('pg_advisory_xact_lock'));
        assert.ok(sql.includes('revoke all on function public.bulk_set_staff_programs(text, uuid[], text, integer[], boolean) from public, anon;'));
        assert.ok(sql.includes('grant execute on function public.bulk_set_staff_programs(text, uuid[], text, integer[], boolean) to authenticated;'));
    });
    test('a Department account is not part of it, and the modes are add, remove and replace', () => {
        assert.ok(sql.includes("p_role not in ('faculty', 'registrar')"));
        assert.ok(sql.includes("p_mode not in ('add', 'remove', 'replace')"));
    });
    test('at most 100 accounts and 30 programmes at a time', () => {
        assert.ok(sql.includes('> 100'));
        assert.ok(sql.includes('> 30'));
    });
    test('the programmes are locked first with the same key as account creation (db/047), in order', () => {
        assert.ok(sql.includes("pg_advisory_xact_lock(hashtext('provision:' || p_role || ':' || v_pid::text))"));
        assert.ok(sql.includes('array_agg(distinct x order by x)'));
        assert.ok(sql.indexOf('pg_advisory_xact_lock') < sql.indexOf('for v_sid in'));
        const prov = read('db/047_serialize_account_caps.sql');
        assert.ok(prov.includes("pg_advisory_xact_lock(hashtext('provision:' || v_role || ':' || v_program::text))"));
    });
    test('the caps and the one-college rule are left to the triggers, not copied here', () => {
        assert.ok(!sql.includes('>= 10') && !sql.includes('>= 2'));
        assert.ok(sql.includes('faculty_program_cap') && sql.includes('faculty_program_college'));
        assert.ok(sql.includes("sqlstate = '23505'") && sql.includes("sqlstate = '23514'"));
    });
    test('each account is done in its own savepoint, so one failure never stops the others', () => {
        const loop = sql.slice(sql.indexOf('for v_sid in'));
        assert.ok(/begin\s+-- this account only/.test(loop));
        assert.ok(loop.includes('exception when others then'));
        assert.ok(loop.includes("'status', 'skipped'"));
    });
    test('a person always keeps at least one programme', () => {
        assert.ok(sql.includes("must keep at least one programme"));
    });
    test('a faculty member with active advisees in a programme being removed is skipped, not left without an adviser', () => {
        assert.ok(sql.includes('from advisee_assignment a'));
        assert.ok(sql.includes('a.is_active'));
        assert.ok(sql.includes('reassign them first'));
    });
    test('the preview is the same code as the real run: it raises a private error that undoes the work and carries the answer', () => {
        assert.ok(sql.includes("raise exception using errcode = 'PR001', message = v_out::text;"));
        assert.ok(sql.includes("exception when sqlstate 'PR001' then"));
        assert.ok(sql.includes('return sqlerrm::jsonb;'));
        // the audit row is written only when applying
        const audit = sql.indexOf("'BULK_SET_STAFF_PROGRAMS'");
        assert.ok(audit > sql.indexOf('if p_apply then'));
        assert.ok(audit < sql.indexOf("raise exception using errcode = 'PR001'"));
    });
    test('the audit row says who got which programmes, and is written only when something changed', () => {
        assert.ok(sql.includes('if v_changed > 0 then'));
        assert.ok(sql.includes("'system_administrator', 'BULK_SET_STAFF_PROGRAMS'"));
        assert.ok(sql.includes("'accounts'"));
    });
    test('the main programme is kept while it is still covered, else the first one', () => {
        assert.ok(sql.includes('if v_main is null or not (v_main = any (v_new)) then'));
        assert.ok(sql.includes('v_new[1]'));
    });
});

describe('the Staff management page', () => {
    test('only faculty and registrars can be ticked; a Department account cannot', () => {
        assert.ok(js.includes("const BULK_ROLES = ['faculty', 'registrar'];"));
        assert.ok(js.includes('BULK_ROLES.includes(s.role)'));
    });
    test('one role at a time: ticking an account of the other role starts a new selection', () => {
        const change = js.slice(js.indexOf("data-bulk-pick]')"), js.indexOf("data-bulk-pick]')") + 500);
        assert.ok(change.includes('STAFF_SEL.role !== one.dataset.role'));
        assert.ok(change.includes('clearStaffSelection()'));
    });
    test('select all follows the role filter and covers every page of it, and is off while the filter is All roles', () => {
        assert.ok(js.includes("const pickable = BULK_ROLES.includes(roleFilter) ? list : [];"));
        assert.ok(js.includes("const ids = filteredStaff().map(s => s.id);"));
        assert.ok(js.includes("${pickable.length ? '' : 'disabled'}"));
    });
    test('a stale tick (an account deleted since) is never sent', () => {
        assert.ok(js.includes('STAFF.filter(s => s.role === STAFF_SEL.role && STAFF_SEL.ids.has(s.id))'));
        assert.ok(js.includes('const picked = selectedStaff();'));
        assert.ok(js.includes('BD.ids = picked.map(s => s.id).sort();'));
    });
    test('the table has one more column, and the account panel row spans it', () => {
        assert.ok(js.includes('${acctPanelRow(s.role, s, state, 9)}'));
        assert.ok(js.includes('<th class="col-pick">'));
    });
    test('the selection bar and its two buttons exist', () => {
        assert.ok(js.includes('data-bulk-open'));
        assert.ok(js.includes('data-bulk-clear'));
        assert.ok(css.includes('.bulk-bar'));
    });
});

describe('the dialog', () => {
    test('every element the script uses is in the page', () => {
        for (const id of ['bulk-dialog', 'bulk-dlg-form', 'bulk-dlg-title', 'bulk-dlg-sub', 'bulk-dlg-close', 'bulk-dlg-list',
                          'bulk-dlg-search', 'bulk-dlg-preview', 'bulk-dlg-msg', 'bulk-dlg-count', 'bulk-dlg-cancel', 'bulk-dlg-preview-btn', 'bulk-dlg-apply']) {
            assert.ok(html.includes(`id="${id}"`), id);
            assert.ok(js.includes(`'${id}'`), id + ' not used by the script');
        }
    });
    test('three modes, Add chosen to begin with', () => {
        assert.ok(html.includes('name="bulk-mode" value="add" checked'));
        assert.ok(html.includes('name="bulk-mode" value="remove"'));
        assert.ok(html.includes('name="bulk-mode" value="replace"'));
    });
    test('Apply is on only after a preview of exactly what is chosen, and only if something would change', () => {
        assert.ok(js.includes('BD.previewKey !== bdKey() || BD.previewChanged === 0'));
        assert.ok(js.includes('BD.previewKey = null;          // what was previewed is no longer what is chosen'));
    });
    test('the preview and the apply call the same function with the same arguments, differing only in p_apply', () => {
        assert.equal((js.match(/rpc\('bulk_set_staff_programs'/g) || []).length, 1);
        assert.ok(js.includes('p_role: BD.role, p_staff_ids: BD.ids, p_mode: BD.mode, p_program_ids: [...BD.chosen], p_apply: apply,'));
        assert.ok(js.includes('bdRun(false)') && js.includes('bdRun(true)'));
    });
    test('every name and reason shown is escaped', () => {
        const show = js.slice(js.indexOf('function bdShowResult'), js.indexOf('function openBulkDialog'));
        assert.ok(show.includes('escapeHtml(r.name'));
        assert.ok(show.includes('escapeHtml(r.employee_id'));
        assert.ok(show.includes('escapeHtml(r.reason)'));
        assert.ok(show.includes('.map(escapeHtml)'));
    });
    test('a database error shows a plain sentence, not the raw text', () => {
        const run = js.slice(js.indexOf('async function bdRun'), js.indexOf("$('bulk-dlg-list')?.addEventListener"));
        assert.ok(run.includes("'Could not do that. Please try again.'"));
        assert.ok(!/bdMessage\(error\.message\)/.test(run));
    });
    test('after applying, the staff list is reloaded and the selection cleared', () => {
        const run = js.slice(js.indexOf('async function bdRun'), js.indexOf("$('bulk-dlg-list')?.addEventListener"));
        assert.ok(run.includes('clearStaffSelection();'));
        assert.ok(run.includes('await loadStaff(true);'));
    });
});

describe('the programme search in the dialog', () => {
    const render = js.slice(js.indexOf('function bdRender'), js.indexOf('/* The answer of bulk_set_staff_programs'));
    test('it filters by code, name and college, ignoring case', () => {
        assert.ok(render.includes("BD.search.trim().toLowerCase()"));
        assert.ok(render.includes("(p.code + ' ' + p.name + ' ' + (p.college || '')).toLowerCase().includes(term)"));
    });
    test('a ticked programme that the search hides stays chosen and is still counted', () => {
        assert.ok(render.includes('BD.chosen.size'));
        assert.ok(!/BD\.chosen\.(delete|clear)/.test(render));
    });
    test('typing in it changes what is shown, not what was previewed', () => {
        const handler = js.slice(js.indexOf("$('bulk-dlg-search')?.addEventListener"), js.indexOf("$('bulk-dlg-preview-btn')?.addEventListener"));
        assert.ok(handler.includes('BD.search = e.target.value; bdRender();'));
        assert.ok(!handler.includes('previewKey'));
    });
    test('opening the dialog starts with an empty search, and no match says so', () => {
        assert.ok(js.includes("BD.search = '';"));
        assert.ok(js.includes("$('bulk-dlg-search').value = '';"));
        assert.ok(js.includes("'No programme matches that search.'"));
    });
});

describe('the Staff management search finds people by programme', () => {
    const filter = js.slice(js.indexOf('function filteredStaff'), js.indexOf('const ROLE_PILLS'));
    test('it searches every programme a person covers, by code and by name, as well as name, email and employee ID', () => {
        assert.ok(filter.includes('staffProgramIds(s)'));
        assert.ok(filter.includes('p.code + \' \' + p.name'));
        for (const field of ['s.first_name', 's.last_name', 's.email', 's.employee_id', 's.role']) assert.ok(filter.includes(field), field);
    });
    test('the role filter still applies first, and an empty search shows everyone', () => {
        assert.ok(filter.indexOf("s.role !== filter") < filter.indexOf('staffProgramIds(s)'));
        assert.ok(filter.includes('if (!term) return true;'));
    });
    test('the box says it searches programmes too', () => {
        assert.ok(html.includes('placeholder="Search name, email, employee ID, role, or programme"'));
    });
});

describe('the visible Select all buttons in Staff management', () => {
    const render = js.slice(js.indexOf('const pickButtons'), js.indexOf('const picked = selectedStaff()') > 0 ? js.indexOf('body.innerHTML = `', js.indexOf('const pickButtons')) : 0);
    test('there is one button per role in the list: both on All roles, one when the filter is a role', () => {
        assert.ok(render.includes("BULK_ROLES.filter(r => roleFilter === 'all' || roleFilter === r)"));
        assert.ok(render.includes('data-bulk-selectrole'));
    });
    test('each button counts only the accounts that match the search and the filter, across every page', () => {
        assert.ok(render.includes('list.filter(s => s.role === r)'));
    });
    test('a role with nothing in the list gets no button, and one fully ticked says so instead', () => {
        assert.ok(render.includes('if (!mine.length) return'));
        assert.ok(render.includes('selected</span>'));
    });
    test('clicking it starts a new selection of that role only, from the same filtered list', () => {
        const click = js.slice(js.indexOf("const sel = e.target.closest('[data-bulk-selectrole]')"), js.indexOf("if (e.target.closest('[data-bulk-clear]'))"));
        assert.ok(click.includes('BULK_ROLES.includes(sel.dataset.bulkSelectrole)'));
        assert.ok(click.indexOf('clearStaffSelection()') < click.indexOf('STAFF_SEL.role = role'));
        assert.ok(click.includes('filteredStaff().filter(s => s.role === role)'));
    });
    test('a Department account can never be selected this way', () => {
        assert.ok(!js.includes("data-bulk-selectrole=\"department\""));
        assert.ok(js.includes("BULK_ROLES.includes(sel.dataset.bulkSelectrole)"));
    });
    test('the styles exist', () => {
        assert.ok(css.includes('.bulk-pickrow') && css.includes('.bulk-all-done'));
    });
});
