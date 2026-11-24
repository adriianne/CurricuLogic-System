// prereqshorthand.js
//
// A printed prerequisite column often writes several codes of one family in shorthand:
//     HM 114   Pre / Co-requisite:  HM 111, 112, 113        (the BSHM prospectus, 23 Nov 2026)
// meaning HM 111, HM 112 and HM 113. The AI reader returns the pieces as printed ("HM 111", "112", "113"). A bare "112" is no
// subject, so the builder dropped it ("left out rather than guessed") and the row kept only HM 111: 6 prerequisite links were lost
// on 5 subjects of one document.
//
// A bare number now takes the letters in front of the digits of the code before it, "HM " + "112", and is used only when that
// code really is a subject of the document. Where it is not, the number is left as it was, and reported as before.
//
//   expand(codes, exists)  -> { codes: [...], expanded: [{ from, to }] }
//     codes   the list the reader returned for one row, in the order printed
//     exists  (code) => true when the document has a subject with that code
//
// Pure functions, so they are unit-tested.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicPrereqShorthand = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const BARE = /^\d+[A-Za-z]?$/;             // "112", "112A": digits with nothing in front
const TAIL = /^(.*?)(\d+[A-Za-z]?)$/;      // "HM 111" -> "HM " + "111"

function expand(codes, exists) {
    const out = [];
    const expanded = [];
    let prefix = null;                      // the text before the digits of the last FULL code ("HM ", "HM ELECT ", "CC-COMPROG")
    for (const raw of Array.isArray(codes) ? codes : []) {
        const code = String(raw ?? '').trim();
        if (!code) continue;
        if (BARE.test(code) && prefix !== null) {
            const candidate = prefix + code;
            if (typeof exists === 'function' && exists(candidate)) {
                out.push(candidate);
                expanded.push({ from: code, to: candidate });
                continue;
            }
            out.push(code);                 // no such subject: keep the number, it is reported as "not in this document"
            continue;
        }
        out.push(code);
        const m = TAIL.exec(code);
        if (m && m[1].trim()) prefix = m[1];
    }
    return { codes: out, expanded };
}

return { expand };
}));
