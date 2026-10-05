// core.js -- what the assess-student function does once it has the data.
//
// Pure: no network, no database, no Deno. Given a student's records and their
// curriculum, it runs the SAME engine, preferences step and Cura summary the
// website runs, and shapes the result for a mobile client. Kept apart from
// index.ts so it can be tested in Node without a database.
//
// Nothing here decides anything. eligibility, ranking, gates and preferences
// all come from shared/engine/engine.js and shared/engine/preferences.js;
// this file only calls them and renames fields.

'use strict';

/* Meetings of one section, in a flat shape a client can print. */
function sectionOut(SC, group) {
    return {
        // The id a request names to say which section was picked.
        offeringId: group.offeringId ?? group.meetings?.[0]?.id ?? null,
        section: group.section,
        timeOfDay: SC.sectionTimeOfDay(group.meetings),
        meetings: group.meetings.map(m => ({
            type: m.meeting_type ?? 'LEC',
            days: m.schedule_days ?? '',
            start: m.start_time ?? null,
            end: m.end_time ?? null,
            room: m.room ?? null,
        })),
    };
}

function brief(engine, s) {
    return {
        id: s.id,
        code: s.code,
        title: s.title,
        units: Number(s.units) || 0,
        year: s.year_level ?? null,
        term: s.term ?? null,
        elective: engine.isElective(s),
        electiveType: s.elective_type ?? null,
    };
}

/* deps:  { engine, preferences, explain, SC }
   input: { student, program, records, subjects, rules, offerings, term, year, prefs } */
function assessStudent(deps, input) {
    const { engine, preferences, explain, SC } = deps;
    const { student, program, records, subjects, rules, offerings, term, year, prefs, inRequestIds } = input;

    const result = engine.assess(
        { id: student.id, year_level: student.year_level },
        records,
        { subjects, rules, offerings },
        {
            maxUnits: program?.max_units ?? 24,
            maxUnitsGraduating: program?.max_units_graduating ?? 27,
            term,
            respectOfferings: offerings.length > 0,
        },
    );
    const plan = preferences.apply(result, prefs);
    const summary = explain.summarizeForExplanation(plan, student.first_name, { inRequestIds });

    const sectionsOf = (e) => SC.groupSections(e.sections).map(g => sectionOut(SC, g));

    const recommended = plan.recommended.map(e => ({
        ...brief(engine, e.subject),
        reason: e.reason,
        retake: !!e.retake,
        unlocks: Math.round((e.unlocks ?? 0) * 10) / 10,
        scheduleState: e.scheduleState,
        section: e.chosenSection
            ? { ...sectionOut(SC, { section: e.chosenSection.section, meetings: e.chosenSection.meetings }),
                timeOfDay: e.chosenSection.timeOfDay }
            : null,
        sections: sectionsOf(e),
        timeMatch: e.timeMatch ?? null,
        sectionReason: e.preferenceReason ?? null,
        slotOptions: e.slotOptions ?? null,
    }));

    const recommendedIds = new Set(plan.recommended.map(e => e.subject.id));
    const alsoOpen = result.eligible
        .filter(e => !recommendedIds.has(e.subject.id))
        .map(e => ({
            ...brief(engine, e.subject),
            scheduleState: e.scheduleState,
            retake: !!e.retake,
            // Choosable in the plan builder too, so they carry their sections.
            sections: sectionsOf(e),
        }));

    const locked = result.locked.map(l => ({
        ...brief(engine, l.subject),
        reasons: (l.unmet ?? []).map(u => u.detail),
        termsAway: l.termsAway ?? null,
    }));

    // Every subject of the curriculum with where the student stands on it:
    // the same statuses the website's "My prospectus" grid shows.
    const grades = new Map();
    for (const r of records) if (r.status === 'PASSED' && r.subject_id) grades.set(r.subject_id, r.grade);

    const rows = [];
    for (const s of result.completed) {
        rows.push({
            ...brief(engine, s), status: 'passed',
            detail: s.filledBy ? `Filled by ${s.filledBy.code}` : (grades.get(s.id) ? `Grade ${grades.get(s.id)}` : 'Passed'),
            filledBy: s.filledBy ? { code: s.filledBy.code, title: s.filledBy.title } : null,
        });
    }
    for (const s of result.inProgress) rows.push({ ...brief(engine, s), status: 'enrolled', detail: 'Currently enrolled' });
    for (const e of result.eligible) {
        rows.push({
            ...brief(engine, e.subject),
            status: e.retake ? 'retake' : 'eligible',
            detail: e.retake ? 'Previously failed. Retake available.' : 'All requirements met.',
        });
    }
    for (const l of result.locked) {
        rows.push({ ...brief(engine, l.subject), status: 'blocked', detail: (l.unmet ?? []).map(u => u.detail).join(' ') });
    }
    // Catalogue electives have no year: they sort after the semesters.
    rows.sort((a, b) =>
        (a.year ?? 99) - (b.year ?? 99) || (a.term ?? 99) - (b.term ?? 99) || a.code.localeCompare(b.code));

    const totalUnits = result.totalUnits;
    const earned = result.facts.unitsEarned;

    return {
        assessed: true,
        student: {
            id: student.id,
            studentId: student.student_id,
            name: [student.first_name, student.last_name].filter(Boolean).join(' '),
            firstName: student.first_name ?? null,
            yearLevel: student.year_level ?? null,
            programCode: program?.code ?? null,
            programName: program?.name ?? null,
        },
        term: { term, year },
        progress: {
            unitsEarned: earned,
            totalUnits,
            percent: totalUnits > 0 ? Math.min(100, Math.round((earned / totalUnits) * 100)) : 0,
            passed: result.facts.passedCount,
            inProgress: result.inProgress.length,
            open: result.eligible.length,
            locked: result.locked.length,
        },
        load: {
            recommendedUnits: plan.recommendedUnits,
            maxUnits: plan.maxUnits,
            availableUnits: plan.availableUnits,
            enrolledUnits: plan.enrolledUnits,
            graduating: plan.graduating,
        },
        recommended,
        alsoOpen,
        locked,
        curriculum: rows,
        electives: result.electives ?? {},
        preferences: {
            timeOfDay: plan.preference.timeOfDay,
            load: plan.preference.load,
            ceiling: plan.preference.ceiling,
            movedToLaterTerm: plan.preference.deferred,
            notes: plan.preference.notes,
        },
        // What Cura reads. The client hands this straight to eligibility-chat.
        summary,
    };
}

module.exports = { assessStudent };
