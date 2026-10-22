// corequisites.js
//
// Co-requisites in the curriculum builder: subjects that must be taken in the same term as another (a lecture and
// its lab, or the BSN's linked nursing courses). Some prospectuses print them in a column of their own next to the
// pre-requisites. The AI curriculum reader returns that column as "corequisites" (subject codes); this turns the
// codes into the builder's rows, and tells a "goes with" rule from a pre-requisite when a row is saved.
//
//   const { targets, missing } = CurriculogicCorequisites.resolve(['NCM 105', 'NCM 999'], row, (code) => rowByCode.get(key(code)));
//   CurriculogicCorequisites.requirementType({ uid: 4, co: true })   // 'co_requisite'
//
// A rule in a builder row is { uid } (pre-requisite), { uid, co: true } (goes with) or { standing: n } (year standing).
// Pure functions, so they are unit-tested.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicCorequisites = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* codes: what the reader returned. self: the row they belong to. lookup(code) -> the row, or undefined.
   targets are the rows found (each once, never the row itself); missing are the codes that are no subject in the document. */
function resolve(codes, self, lookup) {
    const targets = [];
    const missing = [];
    for (const raw of Array.isArray(codes) ? codes : []) {
        const code = String(raw ?? '').trim();
        if (!code) continue;
        const target = lookup(code);
        if (!target) { missing.push(code); continue; }
        if (target === self) continue;
        if (!targets.includes(target)) targets.push(target);
    }
    return { targets, missing };
}

/* What a builder rule is saved as. */
function requirementType(rule) {
    if (rule?.standing) return 'standing';
    return rule?.co ? 'co_requisite' : 'prerequisite';
}

/* The rule as it comes back from the database, for loading a saved curriculum into the builder. */
const isCoRequisiteRow = (dbRule) => dbRule?.requirement_type === 'co_requisite';

return { resolve, requirementType, isCoRequisiteRow };

}));
