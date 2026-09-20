// eligibility-explanation.js
//
// Takes the real, already-computed output of engine.assess() and reduces
// it to the small, flat shape the explain-eligibility Edge Function
// actually needs. Nothing here makes any decision -- it only selects and
// renames fields that already exist in assess()'s real return value.
//
// Why this exists rather than sending assess() output directly:
// assess() returns full subject rows, raw rule-group trace objects, and
// nested offering records. Sending that whole thing to Gemini wastes
// tokens on data it will never reference, and a bigger, messier payload
// makes it more likely the model treats something as its own information
// to reason over, rather than a fact it must simply narrate.
//
// Load this in the same page that already calls engine.assess() -- the
// student dashboard, and the faculty page that views one student.

function summarizeForExplanation(assessResult, studentName) {
    const { facts, locked, recommended, totalUnits } = assessResult;

    // Only the plain-English "detail" strings from each unmet condition
    // survive here -- evaluateCondition() in engine.js already writes
    // these as full sentences ("CC-NETWORK31 has not been taken."), so
    // there is nothing left to interpret; only to narrate.
    const lockedSummary = locked
        .filter(l => l.termsAway !== null)          // reachable within the horizon
        .sort((a, b) => (a.termsAway ?? 99) - (b.termsAway ?? 99))
        .slice(0, 6)                                 // cap: a summary, not a full list
        .map(l => ({
            code: l.subject.code,
            title: l.subject.title,
            termsAway: l.termsAway,
            reasons: l.unmet.map(c => c.detail),
        }));

    const recommendedSummary = recommended.map(r => ({
        code: r.subject.code,
        title: r.subject.title,
        units: r.subject.units,
        retake: r.retake,
        reason: r.reason,
    }));

    return {
        studentName: studentName ?? null,
        unitsEarned: facts.unitsEarned,
        totalUnits,
        completedThroughYear: facts.completedThroughYear,
        recommended: recommendedSummary,
        recommendedUnits: assessResult.recommendedUnits,
        locked: lockedSummary,
        lockedCount: locked.length,      // so "6 more subjects are also locked" is possible
    };
}

if (typeof module === 'object' && module.exports) {
    module.exports = { summarizeForExplanation };
}