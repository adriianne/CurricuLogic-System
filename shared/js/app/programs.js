// programs.js
// One place to turn a program_id into the name a person should read.
//
// Several pages used to print "BS Information Technology" or "BSIT" as
// literal text, which is only true while BSIT is the only programme. A
// student in any other programme would have been shown the wrong degree.
// The `program` table is readable by every signed-in role, so each page
// loads it once through here.
//
// Deliberately takes the caller's own Supabase client rather than creating
// one (systemconfig.js already does that, and each extra client produces a
// "multiple GoTrueClient instances" warning).
//
//   await CurriculogicPrograms.load(supabase);        // once, at boot
//   CurriculogicPrograms.nameOf(student.program_id)   // "BS Information Technology"
//   CurriculogicPrograms.codeOf(student.program_id)   // "BSIT"
//
// Both return the fallback (default "—") for an unknown or missing id, so a
// student with no programme set reads "—", never somebody else's degree.

(function () {
'use strict';

let PROGRAMS = new Map();   // id -> { id, code, name, college }
let loaded = false;

async function load(client) {
    if (loaded) return PROGRAMS;
    if (!client) return PROGRAMS;

    const { data, error } = await client
        .from('program')
        .select('id, code, name, college, max_units, max_units_graduating, target_units');

    if (error) {
        console.warn('programs: could not load the programme list.', error.message);
        return PROGRAMS;   // leave `loaded` false so a later call can retry
    }

    PROGRAMS = new Map((data ?? []).map(p => [p.id, p]));
    loaded = true;
    return PROGRAMS;
}

/* For preview pages, which have no database: seed the map by hand. */
function seed(list) {
    PROGRAMS = new Map((list ?? []).map(p => [p.id, p]));
    loaded = true;
}

/* Which active prospectus a student falls back to when they have none of
   their own.
     - Programme known: the active prospectus OF THAT PROGRAMME, or null.
       (The database allows one active prospectus per programme.)
     - Programme unknown: the single active prospectus if exactly one
       exists; null when there are none or several, because guessing would
       put a student on another programme's curriculum.
   `actives` is a list of { id, program_id }. Pure, so it is unit-tested. */
function fallbackProspectus(programId, actives) {
    const list = actives ?? [];
    if (programId !== null && programId !== undefined) {
        return list.find(p => p.program_id === programId) ?? null;
    }
    return list.length === 1 ? list[0] : null;
}

/* Every programme, by code. For pages that let the user choose one. */
const list = () => [...PROGRAMS.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)));

const nameOf = (id, fallback = '—') => PROGRAMS.get(id)?.name ?? fallback;
const codeOf = (id, fallback = '—') => PROGRAMS.get(id)?.code ?? fallback;
const collegeOf = (id, fallback = '') => PROGRAMS.get(id)?.college ?? fallback;

/* Unit limits for a programme. Falls back to the BSIT numbers the system
   used before limits were per-programme, so an unknown id still works. */
const limitsOf = (id) => {
    const p = PROGRAMS.get(id);
    return {
        maxUnits:           p?.max_units ?? 24,
        maxUnitsGraduating: p?.max_units_graduating ?? 27,
        targetUnits:        p?.target_units ?? 176,
    };
};

window.CurriculogicPrograms = { load, seed, list, nameOf, codeOf, collegeOf, limitsOf, fallbackProspectus };

})();
