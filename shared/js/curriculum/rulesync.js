// rulesync.js
//
// Saving prerequisite edits on subjects that are ALREADY SAVED in the curriculum builder.
//
// THE BUG (found 17 Nov 2026): the builder's Save and Create only wrote the rules of subjects that were new in that
// save. A subject loaded from a saved draft (it carries a dbId) was skipped, so changing its prerequisites on screen
// and pressing Save changed nothing in the database, and the page gave no hint. Nine elective prerequisites of the
// BSIT 2024-2025 draft were "corrected" three times on screen and never stored.
//
// THE FIX: when a saved subject is loaded, a signature of its rules is remembered (row.savedRules). On Save, every saved
// row whose current signature differs has its rules rewritten. The new rules are inserted FIRST and the old ones deleted
// afterwards, so a failure half-way never leaves a subject without rules.
//
// Pure functions (the page passes in what it already uses to read a row), so they are tested without a browser.
//
//   deps = { key(code), requirementType(prereq), standingToDb(prereq) }
//     key             the builder's normalised code key (SC.key)
//     requirementType 'prerequisite' or 'co_requisite' for a prerequisite entry
//     standingToDb    the stored threshold of a year-standing entry

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicRuleSync = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* One string that says what a row's conditions are, independent of the order they were added in. */
function signature(row, rows, deps) {
    const byUid = new Map((rows ?? []).map((r) => [r.uid, r]));
    return (row?.prereqs ?? []).map((p) => {
        if (p.standing) return `standing:${deps.standingToDb(p)}`;
        const target = byUid.get(p.uid);
        return `${deps.requirementType(p)}:${target ? deps.key(target.code) : '?'}`;
    }).sort().join('|');
}

/* Saved rows (they carry a dbId and a remembered signature) whose conditions changed since they were loaded or last saved.
   Rows with errors are left alone: they are not ready to be written. */
function changedRows(rows, deps) {
    return (rows ?? []).filter((r) =>
        r.dbId
        && r.savedRules !== undefined
        && !(r.errors?.length)
        && String(r.code ?? '').trim()
        && signature(r, rows, deps) !== r.savedRules);
}

/* The rule rows to store for one saved subject. A prerequisite that points at a subject with no id yet is dropped (it
   cannot be stored), and the count of those is returned so the page can say so instead of losing it silently. */
function ruleRows(subjectId, row, rows, byCode, deps, staffId) {
    const byUid = new Map((rows ?? []).map((r) => [r.uid, r]));
    const out = [];
    let dropped = 0;

    (row.prereqs ?? []).forEach((p, i) => {
        if (p.standing) {
            out.push({
                subject_id: subjectId, prerequisite_subject_id: null, requirement_type: 'standing', rule_type: 'and',
                rule_group: i + 1, threshold_value: deps.standingToDb(p), created_by: staffId,
            });
            return;
        }
        const target = byUid.get(p.uid);
        const targetId = target ? byCode.get(deps.key(target.code)) : null;
        if (!targetId) { dropped++; return; }
        out.push({
            subject_id: subjectId, prerequisite_subject_id: targetId, requirement_type: deps.requirementType(p), rule_type: 'and',
            rule_group: i + 1, threshold_value: null, created_by: staffId,
        });
    });

    return { rules: out, dropped };
}

/* The sentence the page shows after a save that rewrote rules. */
function message(count, dropped) {
    const base = count === 1 ? 'The changed prerequisites of 1 saved subject were stored.' : `The changed prerequisites of ${count} saved subjects were stored.`;
    return dropped ? `${base} ${dropped} prerequisite${dropped === 1 ? '' : 's'} could not be stored because the subject it points to is not saved yet.` : base;
}

return { signature, changedRows, ruleRows, message };
}));
