// systemcheck.js
//
// The "System check" note a faculty adviser sees above a student's plan, so nothing the system found is hidden in a
// tooltip. Pure functions only (no DOM, no Supabase), so the rules can be tested in Node.
//
// The note may only say what is true. The per-subject verdict ('valid' or 'flagged', with the reason in `remarks`)
// comes from the engine when the plan is submitted and covers: prerequisites and co-requisites, the subject being in
// the student's curriculum and open this term, and not already passed or in progress. Schedule clashes are not part of
// that verdict, so they are worked out here from the sections on the plan. The unit cap is not claimed at all.
//
// A subject with a warning CANNOT be approved: a flagged subject, or a subject whose section clashes with another
// undecided subject's. It can only be rejected (the reason goes to the student). blocked() says which subjects those
// are; the page uses it for the buttons, for "Approve all" and as a last check before saving, and the database refuses
// a flagged subject too (db/112). A clash clears once one of the two is rejected, so the other can then be approved.
//
// While subjects are undecided the note is one of two:
//   * green  "System check: all passed"            every undecided subject is valid and no two sections clash;
//   * amber  "System check: N of M need attention" each flagged subject and each clash, with its reason, and the count
//                                                  of subjects that passed.
// Once everything is decided, decisionHtml() says what was decided and lists every reason and note on the record.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicSystemCheck = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const DECIDED = new Set(['approved', 'rejected']);

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hasTime(o) {
    return !!(o && o.schedule_days && o.start_time && o.end_time);
}

const clock = (t) => String(t || '').slice(0, 5);
const whenOf = (o) => (hasTime(o) ? o.schedule_days + ' ' + clock(o.start_time) + '–' + clock(o.end_time) + (o.section ? ' (' + o.section + ')' : '') : '');
const codeOf = (i) => (i && i.subject && i.subject.code) || 'A subject';
const titleOf = (i) => (i && i.subject && i.subject.title) || '';
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* Pairs of undecided subjects whose sections overlap. meetingsClash is ScheduleConflicts.meetingsClash. */
function clashPairs(undecided, meetingsClash) {
    const pairs = [];
    if (typeof meetingsClash !== 'function') return pairs;
    const timed = undecided.filter(i => hasTime(i.offering));
    for (let a = 0; a < timed.length; a++) {
        for (let b = a + 1; b < timed.length; b++) {
            if (meetingsClash(timed[a].offering, timed[b].offering)) pairs.push([timed[a], timed[b]]);
        }
    }
    return pairs;
}

/* items: request_item rows with { status, remarks, subject: {code,title}, offering: {schedule_days,start_time,end_time,section} }.
   meetingsClash: (offeringA, offeringB) => boolean.
   Returns { show, checkedSchedule, clashes } (show = nothing needs attention). */
function summarize(items, meetingsClash) {
    const undecided = (items ?? []).filter(i => !DECIDED.has(i.status));
    if (!undecided.length) return { show: false, checkedSchedule: false, clashes: 0 };

    const allValid = undecided.every(i => i.status === 'valid');
    const clashes = clashPairs(undecided, meetingsClash).length;
    const checkedSchedule = undecided.filter(i => hasTime(i.offering)).length === undecided.length;
    return { show: allValid && clashes === 0, checkedSchedule, clashes };
}

/* Everything the system found on the undecided subjects, as data:
   { total, passed, needing, flagged: [{ item, reason }], clashes: [[itemA, itemB]], checkedSchedule }. */
function findings(items, meetingsClash) {
    const undecided = (items ?? []).filter(i => !DECIDED.has(i.status));
    const flagged = undecided.filter(i => i.status === 'flagged').map(i => ({
        item: i,
        reason: String(i.remarks == null ? '' : i.remarks).trim(),
    }));
    const clashes = clashPairs(undecided, meetingsClash);

    const attention = new Set();
    flagged.forEach(f => attention.add(f.item));
    clashes.forEach(([a, b]) => { attention.add(a); attention.add(b); });

    return {
        total: undecided.length,
        passed: undecided.length - attention.size,
        needing: attention.size,
        flagged,
        clashes,
        checkedSchedule: undecided.filter(i => hasTime(i.offering)).length === undecided.length,
    };
}

/* The undecided subjects that cannot be approved, and why:
   { ids: Set of item ids, flagged: Set, clashing: Set, clashWith: Map(id -> [subject codes it clashes with]) }.
   Decided subjects are ignored, so rejecting one of two clashing subjects frees the other. */
function blocked(items, meetingsClash) {
    const undecided = (items ?? []).filter(i => !DECIDED.has(i.status));
    const flagged = new Set(undecided.filter(i => i.status === 'flagged').map(i => i.id));
    const clashing = new Set();
    const clashWith = new Map();
    for (const [a, b] of clashPairs(undecided, meetingsClash)) {
        clashing.add(a.id); clashing.add(b.id);
        if (!clashWith.has(a.id)) clashWith.set(a.id, []);
        if (!clashWith.has(b.id)) clashWith.set(b.id, []);
        clashWith.get(a.id).push(codeOf(b));
        clashWith.get(b.id).push(codeOf(a));
    }
    return { ids: new Set([...flagged, ...clashing]), flagged, clashing, clashWith };
}

function passedHtml(r) {
    const lines = [
        'Prerequisites and co-requisites are met',
        'Every subject is in the student\'s curriculum and open this term',
        'None of the subjects is already passed or in progress',
    ];
    if (r.checkedSchedule) lines.push('No schedule clashes between the sections');
    return '<div class="sys-check" role="note">' +
        '<div class="sys-check-title"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> System check: all passed</div>' +
        '<p>This plan was built from the student\'s curriculum and checked by CurricuLogic, so you do not need to re-check these:</p>' +
        '<ul>' + lines.map(l => '<li><i class="fa-solid fa-check" aria-hidden="true"></i> ' + l + '</li>').join('') + '</ul>' +
        '<p class="sys-check-foot">You are still the final approver.</p>' +
        '</div>';
}

function attentionHtml(f) {
    const lead = f.passed > 0
        ? (f.passed === 1 ? 'The other subject passed every check.' : 'The other ' + f.passed + ' subjects passed every check.')
        : 'No subject passed every check.';

    const flaggedLis = f.flagged.map(x => {
        return '<li class="is-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><div>' +
            '<strong>' + esc(codeOf(x.item)) + '</strong>' + (titleOf(x.item) ? ' · ' + esc(titleOf(x.item)) : '') +
            '<span class="sys-reason">' + esc(x.reason || 'Flagged by the system, with no reason recorded.') + '</span>' +
            '<span class="sys-tag is-hard">Cannot be approved: reject it</span>' +
            '</div></li>';
    });

    const clashLis = f.clashes.map(([a, b]) =>
        '<li class="is-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><div>' +
            '<strong>' + esc(codeOf(a)) + '</strong> and <strong>' + esc(codeOf(b)) + '</strong> have a schedule clash' +
            '<span class="sys-reason">' + esc(whenOf(a.offering)) + ' overlaps ' + esc(whenOf(b.offering)) + '</span>' +
            '<span class="sys-tag is-hard">Neither can be approved until one of them is rejected</span>' +
        '</div></li>');

    const foot = f.checkedSchedule
        ? 'Checked: prerequisites, curriculum, schedule.'
        : 'Checked: prerequisites, curriculum. Schedule clashes could not be checked for a subject with no section time.';

    return '<div class="sys-check is-attention" role="note">' +
        '<div class="sys-check-title"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> System check: ' +
            f.needing + ' of ' + plural(f.total, 'subject', 'subjects') + ' need' + (f.needing === 1 ? 's' : '') + ' your attention</div>' +
        '<p>' + lead + '</p>' +
        '<ul class="sys-issues">' + flaggedLis.concat(clashLis).join('') + '</ul>' +
        '<p class="sys-check-foot">' + foot + '</p>' +
        '</div>';
}

/* The note while subjects are undecided, or '' when none are. Green when nothing needs attention; otherwise amber,
   listing every flagged subject and every clash with its reason. */
function noteHtml(items, meetingsClash) {
    const undecided = (items ?? []).filter(i => !DECIDED.has(i.status));
    if (!undecided.length) return '';
    const f = findings(items, meetingsClash);
    if (f.needing === 0 && undecided.every(i => i.status === 'valid')) return passedHtml(f);
    if (f.needing === 0) return '';   // only 'pending' rows (not flagged, not valid yet): nothing to report
    return attentionHtml(f);
}

/* The banner that keeps the last step in view, kept short. Shown when every subject still undecided has a warning
   (flagged, or in a clash), so nothing is left to approve: one line with how many were approved and how many need a
   decision, one line per subject (code and the reason), and "Reject it now". '' otherwise (while subjects without a
   warning remain, "Approve N ready" does that job). While it shows, the page leaves out the longer system check note,
   which would only say the same again. requestId goes on the button. */
function finishHtml(items, meetingsClash, requestId) {
    const all = items ?? [];
    const undecided = all.filter(i => !DECIDED.has(i.status));
    if (!undecided.length) return '';
    const b = blocked(all, meetingsClash);
    if (!b.ids.size || undecided.some(i => !b.ids.has(i.id))) return '';

    const approved = all.filter(i => i.status === 'approved').length;
    const n = undecided.length;
    const lis = undecided.map(i => {
        const reason = b.flagged.has(i.id)
            ? String(i.remarks == null ? '' : i.remarks).trim() || 'Flagged by the system.'
            : 'Schedule clash with ' + (b.clashWith.get(i.id) || []).join(', ') + '.';
        return '<li><strong>' + esc(codeOf(i)) + '</strong> \u00b7 ' + esc(reason) + '</li>';
    }).join('');

    return '<div class="sys-finish" role="status">' +
        '<div class="sys-finish-head">' +
            '<div class="sys-finish-title">' +
                (approved ? '<span class="is-ok"><i class="fa-solid fa-check" aria-hidden="true"></i> ' + approved + ' approved</span>' : '') +
                '<span class="is-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' + n + (n === 1 ? ' needs' : ' need') + ' your decision</span>' +
            '</div>' +
            '<button type="button" class="btn-small sys-finish-btn" data-reject-warned="' + esc(requestId) + '">' +
                '<i class="fa-solid fa-xmark" aria-hidden="true"></i> Reject ' + (n === 1 ? 'it' : 'them') + ' now</button>' +
        '</div>' +
        '<ul class="sys-finish-list">' + lis + '</ul>' +
        '</div>';
}

/* The note once every subject has been decided: what was decided, that it is final, and every reason and note on the
   record. It says only what the decisions show. It does not claim the student was notified (that notice is sent
   without waiting for a result); it says where the student sees the decision, which is always true.
   Nothing for an older plan the Registrar once sent back (that plan is closed, and the page says so itself). */
function decisionHtml(items, opts = {}) {
    const all = items ?? [];
    if (!all.length || opts.sentBack) return '';
    if (all.some(i => !DECIDED.has(i.status))) return '';

    const approved = all.filter(i => i.status === 'approved');
    const rejectedItems = all.filter(i => i.status === 'rejected');
    const rejected = rejectedItems.length;
    const units = approved.reduce((sum, i) => sum + (Number(i.subject && i.subject.units) || 0), 0);
    const unitText = (Math.round(units * 10) / 10) + (units === 1 ? ' unit' : ' units');
    const subjects = (n) => n + (n === 1 ? ' subject' : ' subjects');

    let kind, icon, title, lines;
    if (approved.length === all.length) {
        kind = ''; icon = 'fa-circle-check'; title = 'Plan approved';
        lines = [
            (all.length === 1 ? 'The subject' : 'All ' + subjects(all.length)) + ' (' + unitText + ') ' + (all.length === 1 ? 'was' : 'were') + ' approved.',
            'The decision is final, so no further approval is needed. The student sees it under My requests.',
            'Print the enrollment form below for the student to sign.',
        ];
    } else if (approved.length > 0) {
        kind = ' is-partial'; icon = 'fa-circle-exclamation'; title = 'Plan partly approved';
        lines = [
            approved.length + ' of ' + subjects(all.length) + ' (' + unitText + ') approved; ' + rejected + ' not approved.',
            'The decision is final. The student sees it under My requests.',
            'The enrollment form below lists only the approved subjects.',
        ];
    } else {
        kind = ' is-none'; icon = 'fa-circle-xmark'; title = 'Plan not approved';
        lines = [
            'None of the ' + subjects(all.length) + ' was approved.',
            'The student sees the decision under My requests.',
        ];
    }

    // Every reason and note on the record, one line per subject: why a subject was rejected, and any note left
    // when approving.
    const record = [];
    for (const i of all) {
        const text = typeof i.remarks === 'string' ? i.remarks.trim() : '';
        if (!text) continue;
        if (i.status === 'rejected') record.push({ icon: 'fa-xmark', item: i, text: 'Rejected: ' + text });
        else record.push({ icon: 'fa-pen', item: i, text: 'Note: ' + text });
    }
    const recordHtml = record.length
        ? '<ul class="sys-issues sys-record">' + record.map(r =>
            '<li><i class="fa-solid ' + r.icon + '" aria-hidden="true"></i><div><strong>' + esc(codeOf(r.item)) + '</strong>' +
            (titleOf(r.item) ? ' · ' + esc(titleOf(r.item)) : '') + '<span class="sys-reason">' + esc(r.text) + '</span></div></li>').join('') + '</ul>'
        : '';

    return '<div class="sys-check' + kind + '" role="note">' +
        '<div class="sys-check-title"><i class="fa-solid ' + icon + '" aria-hidden="true"></i> ' + title + '</div>' +
        '<p>' + lines.join(' ') + '</p>' +
        recordHtml +
        '</div>';
}

/* ---- The reason a rejection starts from ----
   When an adviser rejects a subject the system warned about, the reason box opens already filled with what the system
   found, short and one line per subject, so the adviser only reads it, changes what they need and sends it.
   Nothing is filled in for a subject without a warning. */
const NOTE_MAX = 500;   // the database refuses a longer reason (db/050)

const sentence = (s) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return /[.!?]$/.test(t) ? t : t + '.'; };
const flagReason = (i) => sentence(i.remarks && String(i.remarks).trim() ? i.remarks : 'Flagged by the system');
const timeOf = (o) => (hasTime(o) ? o.schedule_days + ' ' + clock(o.start_time) + '–' + clock(o.end_time) : '');

/* Keeps a note inside the limit: every line is shortened evenly, so no subject is left out. */
function fitNote(lines, max) {
    const text = lines.join('\n');
    if (text.length <= max) return text;
    const each = Math.max(8, Math.floor((max - (lines.length - 1)) / lines.length));
    return lines.map(l => (l.length > each ? l.slice(0, each - 1).trimEnd() + '…' : l)).join('\n');
}

/* The reason for rejecting a whole plan: a line for every flagged subject, and one for every pair of clashing
   sections. '' when nothing has a warning. */
function rejectNote(items, meetingsClash, max = NOTE_MAX) {
    const undecided = (items ?? []).filter(i => !DECIDED.has(i.status));
    const lines = undecided.filter(i => i.status === 'flagged').map(i => codeOf(i) + ': ' + flagReason(i));
    for (const [a, b] of clashPairs(undecided, meetingsClash)) {
        const when = timeOf(a.offering);
        lines.push(codeOf(a) + ' and ' + codeOf(b) + ' overlap' + (when ? ' (' + when + ')' : '') + '. Please choose another section for one of them.');
    }
    return lines.length ? fitNote(lines, max) : '';
}

/* The reason for rejecting one subject (the student sees it next to that subject, so no code in front). '' when the
   subject has no warning. */
function itemNote(items, itemId, meetingsClash, max = NOTE_MAX) {
    const undecided = (items ?? []).filter(i => !DECIDED.has(i.status));
    const item = undecided.find(i => i.id === itemId);
    if (!item) return '';
    const parts = [];
    if (item.status === 'flagged') parts.push(flagReason(item));
    const others = (blocked(undecided, meetingsClash).clashWith.get(itemId) || []);
    if (others.length) {
        const when = timeOf(item.offering);
        parts.push('Overlaps with ' + others.join(', ') + (when ? ' (' + when + ')' : '') + '. Please choose another section.');
    }
    const text = parts.join(' ');
    return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

return { summarize, findings, blocked, clashPairs, noteHtml, finishHtml, decisionHtml, rejectNote, itemNote };

}));
