// footnotes.js
//
// Turns what the curriculum importer reports about footnotes and non-code
// prerequisites into things the curriculum builder can use. Pure functions
// only, so the rules are testable without a browser or the AI.
//
// The importer returns, besides the subject list:
//   footnotes: [{ marker: '**', text: '...', through_year: 2 }]
//   per subject: footnote_marker ('**' or null) and prerequisite_notes
//     (prerequisite text that is not a subject code, e.g. 'All prof courses')
//
// What is done with them:
//   - a subject carrying a footnote that means "finish years 1 to N" gets a
//     year-standing gate: its stored threshold is a position (Y*10+T), the
//     form the engine reads (22 = through 2nd year, 2nd sem)
//   - a note that is really a subject code (a code the AI put in the wrong
//     list because it was wrapped across lines or printed without a space,
//     "LEA111") is resolved to that subject
//   - anything left is reported so a person adds it by hand; nothing is
//     silently dropped

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicFootnotes = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const WORD_YEAR = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };

/* The last year a footnote's text says must be finished, or null.
   "must finish all 1st year to 2nd year courses" -> 2
   "Finished Third Year Subjects"                  -> 3
   Used when the importer left through_year empty. */
function yearFromText(text) {
    const t = String(text ?? '').toLowerCase();

    const range = t.match(/(\d)\s*(?:st|nd|rd|th)?\s*(?:year)?\s*(?:to|through|-|–|—)\s*(\d)\s*(?:st|nd|rd|th)?\s*year/);
    if (range) return Number(range[2]);

    // "finished third year", "complete 2nd year subjects"
    if (/(finish|complet|pass)/.test(t)) {
        const digit = t.match(/(\d)\s*(?:st|nd|rd|th)?\s*year/);
        if (digit) return Number(digit[1]);
        const word = t.match(/\b(first|second|third|fourth|fifth|sixth)\s+year/);
        if (word) return WORD_YEAR[word[1]];
    }
    return null;
}

/* The year a subject's footnote marker stands for, or null when the marker
   is not a year-finishing footnote (a bullet, an unknown mark, no mark). */
function throughYear(marker, footnotes) {
    const m = String(marker ?? '').trim();
    if (!m) return null;
    const f = (footnotes ?? []).find(x => String(x?.marker ?? '').trim() === m);
    if (!f) return null;
    const y = Number(f.through_year);
    if (Number.isInteger(y) && y >= 1 && y <= 6) return y;
    return yearFromText(f.text);
}

/* A standing threshold is "everything at or before this position finished".
   A subject cannot ask for its own semester or a later one: it would need to
   pass itself first and could never open. Clamp to the semester before it.
   position = year*10 + term (22 = 2nd year, 2nd sem). */
function clampStanding(position, subjectYear, subjectTerm) {
    const own = Number(subjectYear) * 10 + (Number(subjectTerm) || 1);
    if (!Number.isFinite(own)) return position;
    if (position < own) return position;
    const t = Number(subjectTerm) || 1;
    return t > 1 ? Number(subjectYear) * 10 + (t - 1) : (Number(subjectYear) - 1) * 10 + 2;
}

/* The stored threshold for "finish years 1 to `year`" on this subject, or
   null if it would not constrain anything (year 0 or before the subject's
   own first semester). */
function standingPositionFor(year, subjectYear, subjectTerm) {
    if (!Number.isInteger(year) || year < 1) return null;
    const pos = clampStanding(year * 10 + 2, subjectYear, subjectTerm);
    return pos >= 11 ? pos : null;
}

/* Comparison key for a subject code: case, spaces and every dash variant
   ignored, so "LEA111", "LEA 111" and "lea-111" all meet. */
function looseKey(code) {
    return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* Split each note into candidate codes and try to find each one among the
   extracted subjects. `index` is Map<looseKey, anything>.
   Returns { matched: [value...], leftover: [text...] }: a note whose every
   part is a known subject is resolved; anything else stays as text. */
function resolveNotes(notes, index) {
    const matched = [];
    const leftover = [];
    for (const raw of notes ?? []) {
        const text = String(raw ?? '').trim();
        if (!text) continue;
        const parts = text.split(/\s*(?:,|;|\band\b|&)\s*/i).map(p => p.trim()).filter(Boolean);
        const hits = parts.map(p => index.get(looseKey(p)));
        if (parts.length && hits.every(h => h !== undefined)) matched.push(...hits);
        else leftover.push(text);
    }
    return { matched, leftover };
}

/* ---- prerequisites written in words ----
   Some prospectuses print a prerequisite that is a description, not a code:
     "All prof courses from level 1-3 and level 4 1st sem"   (BSN NCM 122)
     "All CLJ/CDI Subjects"                                   (BSCRIM)
     "Finished Third Year Subjects"                           (BSCRIM)
     "Must have passed all general education and professional subjects"
   The engine has two rule forms: a named subject, and a year-standing gate.
   A description is turned into one of those at import time, so the engine
   stays unchanged. The consequence is that a description is read once: if a
   subject is added to the curriculum later, it is not picked up by an old
   "all professional courses" rule. Reviewing the result is therefore part
   of the import, and every interpretation comes back with a plain label. */

const prefixOf = (code) => (String(code ?? '').toUpperCase().match(/^[A-Z]+/) || [''])[0];
const positionOf = (s) => Number(s.year) * 10 + (Number(s.term) || 1);

/* The last position a description reaches, or null when it names none.
   "from level 1-3 and level 4 1st sem" -> 41
   "level 1-3"                          -> 32 */
function cutoffFromText(text) {
    const t = String(text ?? '').toLowerCase();
    let best = null;
    const take = (n) => { if (best === null || n > best) best = n; };

    const range = t.match(/(?:level|year)s?\s*(\d)\s*(?:-|–|—|to|through)\s*(\d)/);
    if (range) take(Number(range[2]) * 10 + 2);

    const sem = t.match(/(?:level|year)\s*(\d)\s*(1st|first|2nd|second|summer)\s*sem/);
    if (sem) take(Number(sem[1]) * 10 + ({ '1st': 1, first: 1, '2nd': 2, second: 2 }[sem[2]] || 3));

    return best;
}

/* Turns one piece of prerequisite text into a rule, or null when it cannot
   be read with confidence (the caller then reports it to a person).

     subject  { code, year, term }      the subject that carries the text
     all      [{ code, year, term }]    every subject in the curriculum

   Returns
     { kind: 'standing', position, label }   a year-standing gate
     { kind: 'subjects', targets, label }    a list of `all` members
   Only subjects scheduled EARLIER than `subject` are ever returned: a subject
   cannot wait on its own semester or a later one. */
function interpretNote(text, subject, all) {
    // A long phrase wraps across lines in the PDF; read it as one line.
    const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
    const t = raw.toLowerCase();
    if (!raw || subject?.year == null) return null;

    const own = positionOf(subject);
    const cutoff = cutoffFromText(t);
    const limit = cutoff === null ? own - 1 : Math.min(cutoff, own - 1);
    const earlier = (all ?? []).filter(s =>
        s !== subject && s.code && s.year != null && positionOf(s) <= limit);

    const subjectsResult = (targets, label) =>
        targets.length ? { kind: 'subjects', targets, label } : null;

    // "all general education and professional subjects", "all previous subjects":
    // everything before it, which is a standing gate up to the prior semester.
    if (/\ball\b.*\b(general education|ge)\b.*\b(professional|major)\b/.test(t)
        || /\ball\b.*\b(prior|previous|earlier|preceding)\b/.test(t)) {
        const position = clampStanding(99, subject.year, subject.term);
        return position >= 11
            ? { kind: 'standing', position, label: `everything before it (through ${position})` }
            : null;
    }

    // "all prof courses ...": the subject's own code family (NCM 122 -> NCM).
    if (/\ball\b.*\b(prof|professional|major)\b/.test(t) && !/general education/.test(t)) {
        const family = prefixOf(subject.code);
        if (!family) return null;
        const targets = earlier.filter(s => prefixOf(s.code) === family);
        return subjectsResult(targets, `all ${family} courses up to ${describe(limit)}`);
    }

    // "All CLJ/CDI Subjects": named code prefixes that really exist here.
    const named = raw.match(/\b[Aa]ll\s+([A-Z]{2,6}(?:\s*(?:\/|,|&|and)\s*[A-Z]{2,6})*)\s+(?:[Ss]ubjects?|[Cc]ourses?)\b/);
    if (named) {
        const wanted = named[1].split(/\s*(?:\/|,|&|and)\s*/).map(x => x.trim()).filter(Boolean);
        const known = new Set((all ?? []).map(s => prefixOf(s.code)));
        if (wanted.length && wanted.every(w => known.has(w))) {
            const targets = earlier.filter(s => wanted.includes(prefixOf(s.code)));
            return subjectsResult(targets, `all ${wanted.join('/')} courses up to ${describe(limit)}`);
        }
        return null;
    }

    // "Finished Third Year Subjects": a year-standing gate.
    const year = yearFromText(raw);
    if (year) {
        const position = standingPositionFor(year, subject.year, subject.term);
        return position ? { kind: 'standing', position, label: `finished through year ${year}` } : null;
    }

    return null;   // "GEC" and anything else with no defined meaning
}

function describe(position) {
    const y = Math.floor(position / 10);
    const t = position % 10;
    return `year ${y}, ${({ 1: '1st', 2: '2nd', 3: 'summer' }[t] || t)} ${t === 3 ? 'term' : 'sem'}`;
}

return { yearFromText, throughYear, clampStanding, standingPositionFor, looseKey, resolveNotes,
         cutoffFromText, interpretNote };

}));
