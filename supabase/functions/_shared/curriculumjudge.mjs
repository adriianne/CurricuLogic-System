// curriculumjudge.mjs
//
// What an answer from the AI is WORTH, for the curriculum reader (analyze-curriculum-document), 21 Nov 2026.
//
// The reader starts a second, quicker model in parallel when the first is slow (callGeminiHedged in geminicall.mjs) and
// needs to decide, for each answer that arrives, whether it can be used at once. The rule is the same check the page
// makes afterwards (shared/js/curriculum/extractioncheck.js): the subjects must ADD UP to the totals the document itself
// prints. An answer whose units match every printed total is "good" and wins at once, from any model. An answer that
// does not match, or whose document prints no totals, is only "usable": the first (most accurate) model's usable answer
// is taken at once, another model's waits a few seconds for the first model.
//
//   judge(data) -> 'good' | 'usable' | 'bad'
//     data   the raw answer of the Gemini API ({ candidates: [{ content: { parts: [{ text }] } }] })
//     bad    nothing in it, or it is not JSON (cut off), or it is a curriculum with no subjects
//
// Plain JavaScript with nothing from Deno, so it is tested in Node (tests/curriculumjudge.test.mjs).

/** The units the subjects add up to, per semester block ("year:term") and in all. Scheduled subjects only: electives in a list have no semester. */
export function unitsOf(subjects) {
    const blocks = new Map();
    let total = 0;
    for (const s of Array.isArray(subjects) ? subjects : []) {
        if (!Number.isInteger(s?.year_level) || !Number.isInteger(s?.term)) continue;
        const u = (Number(s.lecture_units) || 0) + (Number(s.laboratory_units) || 0);
        const key = `${s.year_level}:${s.term}`;
        blocks.set(key, (blocks.get(key) ?? 0) + u);
        total += u;
    }
    return { blocks, total };
}

/** Every programme total the document printed: the main one and any others it prints with a label, such as one per track
    (the BSHM prospectus: ABM Track 165, non-ABM Academic Track 180). */
export function grandTotalsOf(printed) {
    const out = [];
    const add = (v) => { const n = Number(v); if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n); };
    add(printed?.grand_total_units);
    for (const g of Array.isArray(printed?.other_grand_totals) ? printed.other_grand_totals : []) add(g?.total_units);
    return out;
}

/** True only when the document printed totals AND the subjects add up to every one of them (to one of the programme totals, when it prints several). */
export function totalsMatch(parsed) {
    const printed = parsed?.printed_totals;
    const grands = grandTotalsOf(printed);
    const printedBlocks = Array.isArray(printed?.blocks) ? printed.blocks : [];
    const hasGrand = grands.length > 0;
    if (!hasGrand && !printedBlocks.length) return false;          // nothing to check against
    const { blocks, total } = unitsOf(parsed?.subjects);
    if (hasGrand && !grands.includes(total)) return false;         // a document with one total per track: matching ONE is enough
    for (const b of printedBlocks) {
        const y = Number(b?.year_level), t = Number(b?.term), want = Number(b?.total_units);
        if (!Number.isInteger(y) || !Number.isInteger(t) || !Number.isFinite(want)) continue;
        if ((blocks.get(`${y}:${t}`) ?? 0) !== want) return false;
    }
    return true;
}

/** A subject code the way two readings of the same document would agree on it: letters and digits only, upper case. */
const codeKey = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Every prerequisite and co-requisite the answer names is a subject in the same answer. A code that is NOT one means two
    places in the answer disagree about a code: on 21 Nov 2026 a quicker model wrote the SUBJECT as "CC-DISCRET12" while the
    document prints (and the links copied) "CS-DISCRET12". The units still add up, the links do not: so it is only "usable". */
export function linksResolve(parsed) {
    const subjects = Array.isArray(parsed?.subjects) ? parsed.subjects : [];
    const known = new Set(subjects.map((s) => codeKey(s?.code)));
    for (const s of subjects) {
        for (const list of [s?.prerequisites, s?.corequisites]) {
            let prefix = null;                                 // letters before the digits of the last full code in this list
            for (const raw of Array.isArray(list) ? list : []) {
                const code = String(raw ?? '').trim();
                if (!codeKey(code)) continue;
                // "HM 111, 112, 113" is printed in shorthand and read as "HM 111", "112", "113": a bare number takes the letters of the
                // code before it. The page expands it the same way (shared/js/curriculum/prereqshorthand.js), so it is not a broken link.
                if (/^\d+[A-Za-z]?$/.test(code) && prefix !== null && known.has(codeKey(prefix + code))) continue;
                if (!known.has(codeKey(code))) return false;
                const m = /^(.*?)(\d+[A-Za-z]?)$/.exec(code);
                if (m && m[1].trim()) prefix = m[1];
            }
        }
    }
    return true;
}

export function judge(data) {
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return 'bad';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return 'bad'; }
    // "Not a curriculum" is the one answer a quicker model could get wrong: it counts as an answer, never as a verified one.
    if (parsed?.is_curriculum_document === false) return 'usable';
    const subjects = Array.isArray(parsed?.subjects) ? parsed.subjects : [];
    if (!subjects.length) return 'bad';
    // "good" needs BOTH checks: the units add up to every printed total, and every prerequisite points at a real subject.
    return totalsMatch(parsed) && linksResolve(parsed) ? 'good' : 'usable';
}
