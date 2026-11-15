// withdrawrequest.test.mjs
// A student can take back a plan the adviser has not started on (db/113_withdraw_request.sql).
//   - the rule (shared/js/enrolment/requeststatus.js: withdrawn, canWithdraw, stages)
//   - the subjects become free again (supabase/functions/submit-advising-request/core.js lockedSubjectIds, and the
//     student page's own computeSubjectLocks)
//   - the migration: the function, the guards, the audit row, who may call it
//   - the student page (button, confirm dialog, "Withdrawn" chip) and the Faculty page (closed, no buttons)
//
//   node --test tests/withdrawrequest.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RS = require('../shared/js/enrolment/requeststatus.js');
const core = require('../supabase/functions/submit-advising-request/core.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const req = (status, items = [], extra = {}) => ({ status, request_item: items.map(s => ({ status: s })), ...extra });

describe('the rule: who can withdraw', () => {
    test('a plan still waiting, with nothing decided, can be withdrawn', () => {
        assert.equal(RS.canWithdraw(req('submitted', ['valid', 'flagged', 'valid'])), true);
        assert.equal(RS.canWithdraw(req('submitted', [])), true);
    });
    test('once the adviser has approved or rejected any subject, it cannot', () => {
        assert.equal(RS.canWithdraw(req('submitted', ['valid', 'approved'])), false);
        assert.equal(RS.canWithdraw(req('submitted', ['rejected', 'valid'])), false);
    });
    test('a decided, withdrawn or old sent-back plan cannot', () => {
        for (const s of ['approved', 'partially_approved', 'rejected', 'withdrawn']) assert.equal(RS.canWithdraw(req(s, ['valid'])), false, s);
        assert.equal(RS.canWithdraw(req('submitted', ['valid'], { registrar_status: 'rejected' })), false);
    });
    test('nothing, or a missing request, is not withdrawable', () => {
        assert.equal(RS.canWithdraw(null), false);
        assert.equal(RS.canWithdraw(undefined), false);
    });
});

describe('the status', () => {
    test('withdrawn is its own closed state', () => {
        assert.equal(RS.withdrawn(req('withdrawn')), true);
        assert.equal(RS.withdrawn(req('submitted')), false);
        assert.equal(RS.waiting(req('withdrawn')), false);
        assert.equal(RS.finalApproved(req('withdrawn')), false);
        assert.equal(RS.adviserApproved(req('withdrawn')), false);
    });
    test('its chip says "Withdrawn", in the neutral colour', () => {
        assert.deepEqual(RS.stages(req('withdrawn')), { faculty: { label: 'Withdrawn', chip: 'muted' }, registrar: null });
    });
});

describe('the subjects are free again', () => {
    const items = (subjectId, status) => ({ subject_id: subjectId, status });
    test('a subject in a waiting plan is locked (as before)', () => {
        const locked = core.lockedSubjectIds([{ status: 'submitted', request_item: [items(5, 'valid')] }]);
        assert.ok(locked.has(5));
    });
    test('the same subject in a withdrawn plan is not locked', () => {
        const locked = core.lockedSubjectIds([{ status: 'withdrawn', request_item: [items(5, 'valid')] }]);
        assert.equal(locked.has(5), false);
    });
    test('an older plan still counts when the newer one was withdrawn (newest first, withdrawn skipped)', () => {
        const locked = core.lockedSubjectIds([
            { status: 'withdrawn', request_item: [items(5, 'valid')] },
            { status: 'approved',  request_item: [items(5, 'approved'), items(6, 'approved')] },
        ]);
        assert.ok(locked.has(5) && locked.has(6));
    });
    test('and a newer plan sent after a withdrawal locks the subject again', () => {
        const locked = core.lockedSubjectIds([
            { status: 'submitted', request_item: [items(5, 'valid')] },
            { status: 'withdrawn', request_item: [items(5, 'valid')] },
        ]);
        assert.ok(locked.has(5));
    });
    test('the student page uses the same rule when it draws Build your plan', () => {
        const js = read('features/student/studentdashboard.js');
        const fn = js.slice(js.indexOf('function computeSubjectLocks(myRequests) {'));
        assert.match(fn.slice(0, 700), /if \(req\.status === 'withdrawn'\) continue;/);
    });
});

describe('db/113: the migration', () => {
    const sql = read('db/113_withdraw_request.sql');
    test('the status list the database allows gains "withdrawn" (found by the live test: the check constraint refused it)', () => {
        assert.match(sql, /alter table public\.request drop constraint if exists request_status_values;/);
        assert.match(sql, /alter table public\.request add constraint request_status_values/);
        assert.match(sql, /array\['submitted', 'approved', 'partially_approved', 'rejected', 'withdrawn'\]/);
        // and the constraint is dealt with before the function that needs it
        assert.ok(sql.indexOf('request_status_values') < sql.indexOf('create or replace function public.withdraw_my_request'));
    });
    test('one atomic UPDATE checks the rule and withdraws', () => {
        assert.match(sql, /create or replace function public\.withdraw_my_request\(p_request_id integer\)/);
        assert.match(sql, /security definer/);
        assert.match(sql, /set status = 'withdrawn'/);
        assert.match(sql, /r\.student_id = v_student/);
        assert.match(sql, /r\.status = 'submitted'/);
        assert.match(sql, /r\.registrar_status is null/);
        assert.match(sql, /i\.status in \('approved', 'rejected'\)/);
        assert.match(sql, /from public\.request_review v where v\.request_id = r\.id/);
    });
    test('only the student\'s own request, found through current_student_id()', () => {
        assert.match(sql, /v_student uuid := public\.current_student_id\(\);/);
        assert.match(sql, /if v_student is null then\s*raise exception/);
    });
    test('it says why a withdrawal was refused, without revealing other people\'s requests', () => {
        assert.match(sql, /'not_found'/);
        assert.match(sql, /'not_waiting'/);
        assert.match(sql, /'already_reviewed'/);
        assert.match(sql, /where r\.id = p_request_id and r\.student_id = v_student;/);
    });
    test('every withdrawal is audited, and signed-out visitors cannot call it', () => {
        assert.match(sql, /insert into public\.audit_log/);
        assert.match(sql, /'WITHDRAW_REQUEST'/);
        assert.match(sql, /revoke all on function public\.withdraw_my_request\(integer\) from public, anon;/);
        assert.match(sql, /grant execute on function public\.withdraw_my_request\(integer\) to authenticated;/);
    });
    test('a withdrawn plan cannot be decided, and cannot be changed back', () => {
        assert.match(sql, /create trigger request_item_withdrawn_guard/);
        assert.match(sql, /create trigger request_withdrawn_final/);
        assert.match(sql, /old\.status = 'withdrawn' and new\.status is distinct from 'withdrawn'/);
    });
    test('no trigger WHEN clause holds a subquery (PostgreSQL refuses that)', () => {
        for (const m of sql.matchAll(/\n\s*when \(([^;]*?)\)\s*\n\s*execute function/g)) {
            assert.doesNotMatch(m[1], /\bselect\b/i, 'subquery in a WHEN clause: ' + m[1]);
        }
    });
    test('the undo steps and the redeploy reminder are written down', () => {
        assert.match(sql, /TO UNDO/);
        assert.match(sql, /Rebuild and redeploy both functions/);
    });
});

describe('the student page', () => {
    const js = read('features/student/studentdashboard.js');
    test('the button shows only when the rule allows it, and the database has the last word', () => {
        assert.match(js, /\$\{RS\.canWithdraw\(r\) \? `/);
        assert.match(js, /data-withdraw="\$\{r\.id\}"/);
        assert.match(js, /supabase\.rpc\('withdraw_my_request', \{ p_request_id: requestId \}\)/);
    });
    test('a plain confirm dialog first, with a "Keep it" way out', () => {
        assert.match(js, /Withdraw this request\?/);
        assert.match(js, /Keep it/);
        assert.match(js, /if \(!\(await askWithdrawConfirm\(\)\)\) return;/);
        assert.doesNotMatch(js.slice(js.indexOf('async function withdrawRequest')), /window\.confirm/);
    });
    test('a refused withdrawal says why, and the page shows the real state', () => {
        assert.match(js, /already_reviewed: 'Your adviser has just started on this request, so it can no longer be withdrawn\.'/);
        assert.match(js, /if \(!error\) await loadRequestHistory\(\);/);
    });
    test('the click is wired once, from the page-wide handler', () => {
        assert.match(js, /e\.target\.closest\('\[data-withdraw\]'\)/);
        assert.match(js, /withdrawRequest\(Number\(withdrawBtn\.dataset\.withdraw\), withdrawBtn\)/);
    });
    test('a withdrawn plan reads "Withdrawn": two steps, a grey chip, no overview, a note with the date', () => {
        assert.match(js, /if \(RS\.withdrawn\(r\)\) return \[\{ label: 'Submitted', cls: 'is-done' \}, \{ label: 'Withdrawn', cls: 'is-current' \}\];/);
        assert.match(js, /muted: 'muted'/);
        assert.match(js, /RS\.withdrawn\(r\) \? \{ cls: 'muted', label: 'Withdrawn' \}/);
        assert.match(js, /r\.status === 'withdrawn'\) continue;/);
        assert.match(js, /You withdrew this request/);
        assert.match(js, /requested_term, requested_year, created_at, updated_at,/);
    });
    test('the "Awaiting adviser" count does not include a withdrawn plan', () => {
        assert.match(js, /waiting:  requests\.filter\(r => RS\.waiting\(r\)\)\.length/);
    });
});

describe('the Faculty page', () => {
    const js = read('features/faculty/facultydashboard.js');
    test('a withdrawn plan opened by link is closed: a note, no approve or reject buttons, no overview', () => {
        assert.match(js, /const withdrawn = !!window\.CurriculogicRequestStatus\?\.withdrawn\(req\);/);
        assert.match(js, /Withdrawn by the student/);
        assert.match(js, /renderRequestTable\(items, \{ closed: true \}\)/);
        assert.match(js, /\(withdrawn \? Promise\.resolve\(''\) : planOverviewHtml\(req, items\)\)/);
        assert.match(js, /function renderRequestTable\(items, \{ closed = false \} = \{\}\) \{/);
    });
    test('the queue and the count only ever ask for plans that are still "submitted"', () => {
        const q = js.slice(js.indexOf('async function loadRequestQueue'));
        assert.match(q.slice(0, 1400), /\.eq\('status', 'submitted'\)/);
        assert.match(js, /\.eq\('status', 'submitted'\);/);
    });
});

describe('the look', () => {
    const css = read('shared/css/dashboard.css');
    test('a grey "Withdrawn" chip and the button row', () => {
        assert.match(css, /\.pill\.muted\s*\{ background: rgba\(100, 116, 139, 0\.16\); color: var\(--slate\); \}/);
        assert.match(css, /\.req-withdraw \{ display: flex; flex-wrap: wrap;/);
    });
    test('the Withdraw button is red, so it is easy to notice, and keeps white text in the paper theme too', () => {
        assert.match(read('features/student/studentdashboard.js'), /class="btn-small btn-withdraw" data-withdraw="\$\{r\.id\}"/);
        assert.match(css, /\.req-withdraw \.btn-small\.btn-withdraw \{ background: #b91c1c; border-color: #b91c1c; color: #fff; font-weight: 700; \}/);
        assert.match(css, /\.btn-withdraw:hover:not\(:disabled\) \{ background: #991b1b;/);
        assert.match(css, /\.btn-withdraw:disabled \{ opacity: 0\.6;/);
    });
    test('the confirm dialog reuses the adviser reject dialog\'s styles', () => {
        assert.match(css, /\.rej-dlg \.rej-foot \.rej-ok \{ background: #b91c1c;/);
    });
});
