// planoverview.js
//
// The "Overview" a faculty adviser sees under a student's requested subjects: a map from the subjects the student
// has ALREADY PASSED (with grade and semester) to the subjects they REQUESTED (with a note: good to take this
// semester, or needs attention). Only the passed subjects that matter to the request are drawn: the prerequisites
// and co-requisites of the requested subjects.
//
// Top to bottom, the same as the lecture and laboratory cards on the Department schedule:
//
//     [ IT 111 · Intro to Computing        ]    the subject already passed, on top
//       Passed · 1.75 · 1st Sem 2024
//         │
//         └──►[ IT 121 · Computer Programming 2 ]    the requested subject, below, on a connector
//               Good to take this semester · Counts for 1st Sem 2023
//
// It is the same judgement as the "System check" note, shown as a picture, so the two never disagree:
//   * a subject the system flagged, or one whose section clashes with another's, shows "Needs attention" with the
//     same reason and "Cannot be approved";
//   * every other subject shows "Good to take this semester" and why (its prerequisite is passed, or it has none).
// The requirements come from the engine (shared/engine/engine.js), the same one that checked the plan when it was
// submitted, so the map cannot draw a rule differently from the system.
//
// Two audiences (opts.audience):
//   'adviser' (default)  the faculty adviser's view: grades shown, "Good to take" / "Cannot be approved" notes.
//   'student'            the student's own view on My requests: the same map in the student's words ("In review by
//                        your adviser", "Will be sent back") with a plain "What to do" line, and NO grades. The
//                        student page deliberately never shows grades (CurricuLogic is an advising tool, not a
//                        records portal), so the student's map says Passed with the semester only.
//
// Pure functions: build() returns a plain model, html() draws it. No DOM, no database.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicPlanOverview = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const DEFAULT_TERMS = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' };
const defaultTermLabel = (t) => DEFAULT_TERMS[t] || '';

/* One plain line telling the student what to do about a subject that will be, or was, sent back. Chosen from the
   system's reason (the engine's own sentences); anything else says to ask the adviser. */
const SENT_BACK_NEXT = 'Open Build your plan, fix what the reason says and send it again, or ask your adviser.';

/* sentBack: the adviser has already sent this subject back. The page says such a subject appears again in Build your
   plan with the reason, so a reason the system has no rule for (the adviser's own words) points there, not only at
   the adviser. A subject that is only flagged has not been sent back yet, so it keeps "Ask your adviser". */
function todoFor(reason, sentBack) {
    const r = String(reason == null ? '' : reason);
    if (/already passed/i.test(r))                       return 'You already passed this subject, so you do not need to take it again.';
    if (/already in progress/i.test(r))                  return 'You are already taking this subject.';
    if (/not found in the current curriculum/i.test(r))  return 'This subject is not in your curriculum. Ask your adviser which one to take instead.';
    if (/section is not offered/i.test(r))               return 'Choose another section of this subject.';
    if (/full or closed|section is full/i.test(r))       return 'Choose another section of this subject.';
    if (/schedule clash|clashes with/i.test(r))          return 'Pick a different section for one of the two subjects.';
    if (/must be taken together with|taken together/i.test(r)) return 'Add the other subject to the same request.';
    if (/was not passed|must be retaken/i.test(r))       return 'Retake that subject first, then request this one again.';
    if (/in progress/i.test(r))                          return 'Finish and pass that subject first, then request this one again.';
    if (/must be passed first|has not been taken|prerequisite|not met/i.test(r)) return 'Take and pass that subject first, then request this one again.';
    return sentBack ? SENT_BACK_NEXT : 'Ask your adviser what to do next.';
}

/* The record that best describes a subject: the latest pass, else the latest failure, else a subject in progress. */
function recordFor(records, subjectId) {
    const mine = (records || []).filter(r => r && r.subject_id === subjectId);
    const order = (r) => (Number(r.taken_year) || 0) * 10 + (Number(r.taken_term) || 0);
    const latest = (status) => mine.filter(r => r.status === status).sort((a, b) => order(b) - order(a))[0];
    return latest('PASSED') || latest('FAILED') || latest('ENROLLED') || null;
}

/* How one condition of a requirement looks on the map. */
function nodeOf(cond, records, planSubjectIds, termLabel, showGrades) {
    if (cond.type === 'standing') {
        return { relation: 'standing', met: !!cond.met, state: cond.met ? 'met' : 'unmet', detail: cond.detail || '' };
    }
    const rec = recordFor(records, cond.subjectId);
    const when = rec && (rec.taken_term || rec.taken_year)
        ? [termLabel(rec.taken_term), rec.taken_year].filter(Boolean).join(' ')
        : '';
    let state = 'missing';
    if (rec && rec.status === 'PASSED') state = 'passed';
    else if (rec && rec.status === 'ENROLLED') state = 'inprogress';
    else if (rec && rec.status === 'FAILED') state = 'failed';
    else if (cond.type === 'co_requisite' && planSubjectIds.has(cond.subjectId)) state = 'together';
    return {
        relation: cond.type === 'co_requisite' ? 'co_requisite' : 'prerequisite',
        met: !!cond.met,
        state,
        subjectId: cond.subjectId,
        code: cond.code || '',
        title: cond.title || '',
        grade: showGrades && rec && rec.grade != null && rec.grade !== '' ? String(rec.grade) : '',
        when,
        detail: cond.detail || '',
    };
}

/* Everything the map shows, as data.
   opts: { items, records, kb: {subjects, rules}, engine, blocked, pairs, request: {term, year}, termLabel }
   items   the plan's request_item rows { id, subject_id, status, remarks, subject:{code,title,units}, offering }
   records the student's academic_record rows (subject_id, status, grade, taken_term, taken_year)
   engine  CurricuLogicEngine (buildFacts, evaluateSubject)
   blocked SystemCheck.blocked(items, clash): subjects that cannot be approved
   pairs   SystemCheck clash pairs, for the clash strips */
function build(opts) {
    const items = opts.items || [];
    const records = opts.records || [];
    const kb = opts.kb || { subjects: [], rules: [] };
    const engine = opts.engine;
    const blocked = opts.blocked || { flagged: new Set(), clashing: new Set(), clashWith: new Map() };
    const termLabel = opts.termLabel || defaultTermLabel;
    const req = opts.request || {};
    const semester = [termLabel(req.term), req.year].filter(Boolean).join(' ');
    const audience = opts.audience === 'student' ? 'student' : 'adviser';
    const showGrades = audience !== 'student';

    const byId = new Map((kb.subjects || []).map(s => [s.id, s]));
    const planSubjectIds = new Set(items.map(i => i.subject_id).filter(id => id != null));
    const baseFacts = engine.buildFacts({ id: opts.studentId || null, year_level: opts.yearLevel || null }, records, kb.subjects || []);
    // Taking a co-requisite together in the same request satisfies it, as it did when the plan was submitted.
    const facts = { ...baseFacts, alongside: planSubjectIds };

    const rows = items.map(item => {
        const subject = byId.get(item.subject_id) || null;
        const rules = (kb.rules || []).filter(r => r.subject_id === item.subject_id);
        const verdict = subject ? engine.evaluateSubject(subject, rules, facts, byId) : { satisfied: true, trace: [] };

        const groups = verdict.trace.map(g => ({
            group: g.group,
            kind: g.kind,                                  // 'required' | 'any_of'
            met: g.met,
            nodes: g.conditions.map(c => nodeOf(c, records, planSubjectIds, termLabel, showGrades)),
        }));

        const code = (item.subject && item.subject.code) || (subject && subject.code) || 'A subject';
        const title = (item.subject && item.subject.title) || (subject && subject.title) || '';
        const units = Number((item.subject && item.subject.units) || (subject && subject.units) || 0);

        // The note: the same verdict as the System check note (for the adviser), or the same facts in the student's words.
        let note;
        const why = (blocked.clashWith.get(item.id) || []).join(', ');
        if (audience === 'student') {
            const reason = String(item.remarks == null ? '' : item.remarks).trim();
            if (item.status === 'approved') {
                note = { kind: 'done', title: 'Approved', text: reason ? 'Note from your adviser: ' + reason : '' };
            } else if (item.status === 'rejected') {
                note = { kind: 'bad', title: 'Sent back', text: reason || 'Your adviser sent this one back.', todo: todoFor(reason, true) };
            } else if (item.status === 'flagged') {
                // A flagged subject cannot be approved (the page and the database both refuse), so "will be sent back" is true.
                note = { kind: 'warn', title: 'Will be sent back', text: reason || 'The system flagged this subject.', todo: todoFor(reason) };
            } else if (blocked.clashing.has(item.id)) {
                note = { kind: 'warn', title: 'Schedule clash', text: 'Its section overlaps ' + why + '.', todo: todoFor('schedule clash') };
            } else if (!verdict.satisfied) {
                const unmet = verdict.trace.flatMap(g => g.conditions.filter(c => !c.met).map(c => c.detail)).filter(Boolean);
                note = { kind: 'warn', title: 'Check your record', text: 'Requirements are no longer met: ' + (unmet[0] || 'ask your adviser.'), todo: 'Ask your adviser what to do next.' };
            } else {
                const metDetails = verdict.trace.flatMap(g => g.conditions.filter(c => c.met).map(c => c.detail)).filter(Boolean);
                note = {
                    kind: 'wait',
                    title: 'In review by your adviser',
                    text: metDetails.length ? 'Your record meets the requirement: ' + metDetails.join(' ') : 'This subject has no prerequisite.',
                };
            }
        } else if (item.status === 'approved') {
            note = { kind: 'done', title: 'Approved', text: item.remarks ? 'Note: ' + item.remarks : '' };
        } else if (item.status === 'rejected') {
            note = { kind: 'bad', title: 'Rejected', text: item.remarks || '' };
        } else if (item.status === 'flagged') {
            note = { kind: 'warn', title: 'Needs attention', text: String(item.remarks || 'Flagged by the system.').trim(), stop: 'Cannot be approved: reject it' };
        } else if (blocked.clashing.has(item.id)) {
            note = { kind: 'warn', title: 'Needs attention', text: 'Schedule clash with ' + why + '.', stop: 'Cannot be approved until one of them is rejected' };
        } else if (!verdict.satisfied) {
            // The submission check passed, but the record has changed since: say so rather than show a green note.
            const unmet = verdict.trace.flatMap(g => g.conditions.filter(c => !c.met).map(c => c.detail)).filter(Boolean);
            note = { kind: 'warn', title: 'Needs attention', text: 'Requirements are no longer met: ' + (unmet[0] || 'check the record.') };
        } else {
            const metDetails = verdict.trace.flatMap(g => g.conditions.filter(c => c.met).map(c => c.detail)).filter(Boolean);
            note = {
                kind: 'good',
                title: 'Good to take this semester',
                counts: semester ? 'Counts for ' + semester : '',
                text: metDetails.length ? metDetails.join(' ') : 'No prerequisite.',
            };
        }

        return { itemId: item.id, code, title, units, status: item.status, groups, note };
    });

    return { audience, semester, rows, pairs: (opts.pairs || []).map(([a, b]) => ({ a, b })) };
}

/* ---- drawing ---- */

function nodeHtml(n) {
    if (n.relation === 'standing') {
        return '<div class="po-pill ' + (n.met ? 'is-met' : 'is-unmet') + '"><i class="fa-solid ' + (n.met ? 'fa-check' : 'fa-xmark') + '" aria-hidden="true"></i> ' + esc(n.detail) + '</div>';
    }
    const head = '<div class="po-code">' + esc(n.code) + (n.title ? ' <span class="po-title">· ' + esc(n.title) + '</span>' : '') + '</div>';
    let meta;
    if (n.state === 'passed') {
        meta = '<i class="fa-solid fa-check" aria-hidden="true"></i> Passed' + (n.grade ? ' · ' + esc(n.grade) : '') + (n.when ? ' · ' + esc(n.when) : '');
    } else if (n.state === 'inprogress') {
        meta = '<i class="fa-solid fa-hourglass-half" aria-hidden="true"></i> In progress' + (n.when ? ' · ' + esc(n.when) : '') + ' · must be passed first';
    } else if (n.state === 'failed') {
        meta = '<i class="fa-solid fa-xmark" aria-hidden="true"></i> Failed' + (n.grade ? ' · ' + esc(n.grade) : '') + (n.when ? ' · ' + esc(n.when) : '') + ' · must be retaken';
    } else if (n.state === 'together') {
        meta = '<i class="fa-solid fa-link" aria-hidden="true"></i> Taken together, in this request';
    } else {
        meta = '<i class="fa-solid fa-xmark" aria-hidden="true"></i> Not passed yet';
    }
    return '<div class="po-node is-' + n.state + '">' + head + '<div class="po-meta">' + meta + '</div></div>';
}

function rowHtml(r) {
    const hasLinks = r.groups.some(g => g.nodes.length);
    let from;
    if (!hasLinks) {
        from = '<div class="po-from"><div class="po-none">No prerequisite</div></div>';
    } else {
        from = '<div class="po-from">' + r.groups.map((g, i) =>
            (i > 0 ? '<div class="po-and">and</div>' : '') +
            '<div class="po-group' + (g.kind === 'any_of' ? ' is-any' : '') + '">' +
                (g.kind === 'any_of' ? '<div class="po-anyof">any one of</div>' : '') +
                g.nodes.map(nodeHtml).join('') +
            '</div>').join('') + '</div>';
    }
    // The connector from what is above to this subject: solid when its requirements are met, dashed red when one is
    // missing, dotted and grey when it has none.
    const unmet = r.groups.some(g => !g.met);
    const link = !hasLinks ? ' is-none' : (unmet ? ' is-broken' : '');

    const n = r.note;
    const icon = { good: 'fa-circle-check', warn: 'fa-triangle-exclamation', bad: 'fa-circle-xmark', done: 'fa-check', wait: 'fa-hourglass-half' }[n.kind] || 'fa-circle-check';
    const to = '<div class="po-to has-link' + link + '">' + (hasLinks && unmet ? '<span class="po-link-label">missing</span>' : '') +
        '<div class="po-node is-requested is-' + n.kind + '">' +
        '<div class="po-code">' + esc(r.code) + (r.title ? ' <span class="po-title">· ' + esc(r.title) + '</span>' : '') + '</div>' +
        '<div class="po-verdict"><i class="fa-solid ' + icon + '" aria-hidden="true"></i> ' + esc(n.title) + '</div>' +
        (n.counts ? '<div class="po-counts">' + esc(n.counts) + '</div>' : '') +
        (n.text ? '<div class="po-text">' + esc(n.text) + '</div>' : '') +
        (n.stop ? '<div class="po-stop">' + esc(n.stop) + '</div>' : '') +
        (n.todo ? '<div class="po-todo"><strong>What to do:</strong> ' + esc(n.todo) + '</div>' : '') +
        '</div></div>';
    return '<div class="po-row">' + from + to + '</div>';
}

function html(model) {
    if (!model || !model.rows || !model.rows.length) return '';
    const clashes = (model.pairs || []).map(p =>
        '<div class="po-clash"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Schedule clash: <strong>' + esc(p.a.subject && p.a.subject.code) +
        '</strong> ⟷ <strong>' + esc(p.b.subject && p.b.subject.code) + '</strong> <span>Neither can be approved until one of them is rejected.</span></div>').join('');
    return '<section class="po" aria-label="Overview of the plan">' +
        '<div class="po-head"><strong>Overview</strong><span>' + (model.audience === 'student'
            ? 'What you have passed, and what you asked to take'
            : 'What the student has passed, and what they asked to take') + '</span></div>' +
        '<div class="po-legend"><span>Already passed</span><i class="fa-solid fa-arrow-down" aria-hidden="true"></i>' +
            '<span>Requested' + (model.semester ? ' for ' + esc(model.semester) : '') + '</span></div>' +
        '<div class="po-rows">' + model.rows.map(rowHtml).join('') + '</div>' +
        clashes +
        '<p class="po-foot">' + (model.audience === 'student'
            ? 'Checked by CurricuLogic against your record. Your adviser makes the final decision.'
            : 'Checked by CurricuLogic against the student\'s record. You are still the final approver.') + '</p>' +
        '</section>';
}

return { build, html, recordFor, todoFor };

}));
