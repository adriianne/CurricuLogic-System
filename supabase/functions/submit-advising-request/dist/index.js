var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// supabase/functions/submit-advising-request/core.js
var require_core = __commonJS({
  "supabase/functions/submit-advising-request/core.js"(exports, module) {
    "use strict";
    function lockedSubjectIds(requests) {
      const latest = /* @__PURE__ */ new Map();
      for (const req of requests ?? []) {
        for (const item of req.request_item ?? []) {
          if (!latest.has(item.subject_id)) latest.set(item.subject_id, { req, item });
        }
      }
      const locked = /* @__PURE__ */ new Set();
      for (const [subjectId, { req, item }] of latest) {
        const sentBack = req.registrar_status === "rejected";
        const rejected = item.status === "rejected";
        if (!sentBack && !rejected) locked.add(subjectId);
      }
      return locked;
    }
    var MAX_PER_DAY = 5;
    var MIN_GAP_SECONDS = 30;
    var DAY_MS = 24 * 60 * 60 * 1e3;
    function submissionLimit(requests, now = Date.now()) {
      const times = (requests ?? []).map((r) => new Date(r.created_at).getTime()).filter((t) => Number.isFinite(t) && t <= now).sort((a, b) => b - a);
      const sinceLast = times.length ? Math.ceil((now - times[0]) / 1e3) : Infinity;
      if (sinceLast < MIN_GAP_SECONDS) {
        const wait = MIN_GAP_SECONDS - sinceLast;
        return {
          ok: false,
          retryAfterSeconds: wait,
          error: `Please wait ${wait} second${wait === 1 ? "" : "s"} before sending another request.`
        };
      }
      const recent = times.filter((t) => now - t < DAY_MS);
      if (recent.length >= MAX_PER_DAY) {
        const oldest = recent[MAX_PER_DAY - 1];
        const wait = Math.ceil((oldest + DAY_MS - now) / 1e3);
        const hours = Math.ceil(wait / 3600);
        return {
          ok: false,
          retryAfterSeconds: wait,
          error: `You have already sent ${MAX_PER_DAY} requests in the last 24 hours. Try again in about ${hours} hour${hours === 1 ? "" : "s"}, or talk to your adviser.`
        };
      }
      return { ok: true };
    }
    function evaluateSelections(deps, input) {
      const { engine: engine2 } = deps;
      const { student, program, records, subjects, rules, term, selections } = input;
      const offerings = input.offerings.filter((o) => o.is_open !== false);
      const result = engine2.assess(
        { id: student.id, year_level: student.year_level },
        records,
        { subjects, rules, offerings },
        {
          maxUnits: program?.max_units ?? 24,
          maxUnitsGraduating: program?.max_units_graduating ?? 27,
          term,
          respectOfferings: offerings.length > 0
        }
      );
      const open = new Map(result.eligible.map((e) => [e.subject.id, e]));
      const locked = new Map(result.locked.map((l) => [l.subject.id, l]));
      const passed = new Set(result.completed.map((s) => s.id));
      const taking = new Set(result.inProgress.map((s) => s.id));
      const offeringSubject = new Map(offerings.map((o) => [o.id, o.subject_id]));
      const picked = new Set(selections.map((sel) => sel.subjectId));
      return selections.map((sel) => {
        const base = { subjectId: sel.subjectId, offeringId: sel.offeringId ?? null };
        const no = (reason) => ({ ...base, valid: false, reason });
        if (passed.has(sel.subjectId)) return no("This subject is already passed.");
        if (taking.has(sel.subjectId)) return no("This subject is already in progress.");
        if (locked.has(sel.subjectId)) {
          const unmet = (locked.get(sel.subjectId).unmet ?? []).map((u) => u.detail).join(" ");
          return no(unmet || "Requirements for this subject are not met.");
        }
        if (!open.has(sel.subjectId)) return no("Subject not found in the current curriculum.");
        const entry = open.get(sel.subjectId);
        if (entry.availableThisTerm === false) {
          const why = entry.scheduleState === "not-run" ? "The department is not running this subject this term." : entry.subject.year_level == null ? "No section is open for this elective this term." : "This subject belongs to another semester and has no section this term.";
          return { ...no(why), unavailable: true };
        }
        const missing = (entry.alongside ?? []).filter((a) => !picked.has(a.id));
        if (missing.length) {
          return no(`${entry.subject.code} must be taken together with ${missing.map((m) => m.code).join(" and ")}. Add it to the same request.`);
        }
        if (base.offeringId != null && offeringSubject.get(base.offeringId) !== sel.subjectId) {
          return no("The chosen section is not offered for this subject this term.");
        }
        return { ...base, valid: true, reason: null };
      });
    }
    module.exports = { lockedSubjectIds, evaluateSelections, submissionLimit, MAX_PER_DAY, MIN_GAP_SECONDS };
  }
});

// shared/engine/engine.js
var require_engine = __commonJS({
  "shared/engine/engine.js"(exports, module) {
    (function(root, factory) {
      if (typeof module === "object" && module.exports) module.exports = factory();
      else root.CurricuLogicEngine = factory();
    })(typeof self !== "undefined" ? self : exports, function() {
      "use strict";
      const PASSED = "PASSED";
      const FAILED = "FAILED";
      const ENROLLED = "ENROLLED";
      const PREREQUISITE = "prerequisite";
      const CO_REQUISITE = "co_requisite";
      const STANDING = "standing";
      const DEFAULTS = {
        maxUnits: 24,
        maxUnitsGraduating: 27,
        /* First year level held back by the year gate (see assess). */
        gateFromYear: 3,
        /* Guard only. With an acyclic graph the fixpoint is reached in far
           fewer passes; this stops a cycle that slipped past the integrity
           checks from spinning forever. */
        maxIterations: 20
      };
      const isElective = (s) => s.is_elective === true || s.elective_type != null;
      function buildFacts(student, records, subjects) {
        const byId = new Map(subjects.map((s) => [s.id, s]));
        const passed = /* @__PURE__ */ new Set();
        const failed = /* @__PURE__ */ new Set();
        const enrolled = /* @__PURE__ */ new Set();
        for (const r of records) {
          if (r.subject_id == null) continue;
          if (r.status === PASSED) passed.add(r.subject_id);
          if (r.status === FAILED) failed.add(r.subject_id);
          if (r.status === ENROLLED) enrolled.add(r.subject_id);
        }
        for (const id of passed) failed.delete(id);
        let unitsEarned = 0;
        for (const id of passed) unitsEarned += Number(byId.get(id)?.units || 0);
        return {
          studentId: student?.id ?? null,
          yearLevel: Number(student?.year_level) || null,
          passed,
          failed,
          enrolled,
          unitsEarned,
          completedThroughPosition: highestCompletedPosition(passed, subjects),
          firstIncompletePosition: firstIncompletePosition(passed, subjects)
        };
      }
      function highestCompletedPosition(passed, subjects) {
        const positions = [...new Set(
          subjects.filter((s) => !isElective(s) && s.year_level != null && s.term != null).map((s) => s.year_level * 10 + s.term)
        )].sort((a, b) => a - b);
        let highest = 0;
        for (const pos of positions) {
          const upto = subjects.filter(
            (s) => !isElective(s) && s.year_level != null && s.term != null && s.year_level * 10 + s.term <= pos
          );
          if (upto.every((s) => passed.has(s.id))) highest = pos;
          else break;
        }
        return highest;
      }
      function firstIncompletePosition(passed, subjects) {
        let first = Infinity;
        for (const s of subjects) {
          if (isElective(s) || s.year_level == null || s.term == null) continue;
          if (passed.has(s.id)) continue;
          first = Math.min(first, s.year_level * 10 + s.term);
        }
        return first;
      }
      function standingPosition(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return n < 10 ? n * 10 + 2 : n;
      }
      function describePosition(pos) {
        if (!pos) return "nothing yet";
        const y = Math.floor(pos / 10);
        const t = pos % 10;
        const ord = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" }[y] || `${y}th`;
        const term = { 1: "1st Semester", 2: "2nd Semester", 3: "Summer" }[t] || "";
        return `${ord} Year, ${term}`;
      }
      function evaluateSubject(subject, rules, facts, byId) {
        const groups = /* @__PURE__ */ new Map();
        for (const r of rules) {
          const g = r.rule_group ?? 1;
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(r);
        }
        const trace = [];
        let satisfied = true;
        for (const [groupId, conditions] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
          const results = conditions.map((c) => evaluateCondition(c, facts, byId, subject));
          const met = results.some((r) => r.met);
          if (!met) satisfied = false;
          trace.push({
            group: groupId,
            met,
            /* Only a multi-condition group is a real choice. Labelling a
               single condition "any one of" reads as though an
               alternative exists. */
            kind: conditions.length > 1 ? "any_of" : "required",
            conditions: results
          });
        }
        return { satisfied, trace };
      }
      function evaluateCondition(rule, facts, byId, subject) {
        const type = rule.requirement_type;
        if (type === STANDING) {
          let need = standingPosition(rule.threshold_value);
          if (subject && subject.year_level != null) {
            const own = subject.year_level * 10 + (Number(subject.term) || 1);
            if (need >= own) need = own - 1;
          }
          const have = facts.completedThroughPosition;
          const met2 = facts.firstIncompletePosition !== void 0 ? facts.firstIncompletePosition > need : have >= need;
          return {
            type,
            met: met2,
            threshold: need,
            detail: met2 ? `Completed through ${describePosition(need)}.` : `Requires completion through ${describePosition(need)}. Currently through ${describePosition(have)}.`
          };
        }
        const required = byId.get(rule.prerequisite_subject_id);
        if (!required) {
          return {
            type,
            met: false,
            detail: "This condition refers to a subject that is no longer in the prospectus."
          };
        }
        if (type === CO_REQUISITE) {
          const already = facts.passed.has(required.id) || facts.enrolled.has(required.id);
          const together = !already && !!facts.alongside && facts.alongside.has(required.id);
          const met2 = already || together;
          return {
            type,
            met: met2,
            subjectId: required.id,
            code: required.code,
            title: required.title,
            alongside: together,
            detail: already ? `${required.code} is passed or currently being taken.` : together ? `${required.code} must be taken in the same term as this subject.` : `${required.code} must be passed or taken alongside this subject.`
          };
        }
        const met = facts.passed.has(required.id);
        const currentlyTaking = facts.enrolled.has(required.id);
        const previouslyFailed = facts.failed.has(required.id);
        return {
          type: PREREQUISITE,
          met,
          subjectId: required.id,
          code: required.code,
          title: required.title,
          detail: met ? `${required.code} passed.` : currentlyTaking ? `${required.code} is in progress. It must be passed first.` : previouslyFailed ? `${required.code} was not passed. It must be retaken.` : `${required.code} has not been taken.`
        };
      }
      function chainForward(facts, kb, assumePassed = []) {
        const passed = new Set(facts.passed);
        for (const id of assumePassed) passed.add(id);
        const working = { ...facts, passed };
        working.completedThroughPosition = highestCompletedPosition(passed, kb.subjects);
        working.firstIncompletePosition = firstIncompletePosition(passed, kb.subjects);
        const depth = /* @__PURE__ */ new Map();
        let iteration = 0;
        let derivedThisPass;
        do {
          derivedThisPass = 0;
          iteration++;
          const newlyPassed = [];
          for (const subject of kb.subjects) {
            if (working.passed.has(subject.id)) continue;
            if (depth.has(subject.id)) continue;
            const rules = kb.rulesFor(subject.id);
            const { satisfied } = evaluateSubject(subject, rules, working, kb.byId);
            if (satisfied) {
              depth.set(subject.id, iteration);
              newlyPassed.push(subject.id);
              derivedThisPass++;
            }
          }
          for (const id of newlyPassed) working.passed.add(id);
          working.completedThroughPosition = highestCompletedPosition(working.passed, kb.subjects);
          working.firstIncompletePosition = firstIncompletePosition(working.passed, kb.subjects);
        } while (derivedThisPass > 0 && iteration < DEFAULTS.maxIterations);
        return depth;
      }
      function unlockImpact(subjectId, facts, kb) {
        const dependents = kb.dependentsOf(subjectId);
        const seen = /* @__PURE__ */ new Set([subjectId]);
        const queue = [...dependents];
        let count = 0;
        while (queue.length > 0) {
          const { id, weight } = queue.shift();
          if (seen.has(id)) continue;
          seen.add(id);
          if (facts.passed.has(id)) continue;
          count += weight;
          for (const next of kb.dependentsOf(id)) {
            if (!seen.has(next.id)) queue.push({ id: next.id, weight: weight * next.weight });
          }
        }
        return Math.round(count * 10) / 10;
      }
      function assess(student, records, knowledgeBase, options = {}) {
        const kept = new Set(records.filter((r) => r.status === PASSED || r.status === ENROLLED).map((r) => r.subject_id));
        const subjects = (knowledgeBase.subjects ?? []).filter((s) => s.is_active !== false || kept.has(s.id));
        const rules = knowledgeBase.rules ?? [];
        const offerings = knowledgeBase.offerings ?? [];
        const byId = new Map(subjects.map((s) => [s.id, s]));
        const rulesBySubject = /* @__PURE__ */ new Map();
        for (const r of rules) {
          if (!rulesBySubject.has(r.subject_id)) rulesBySubject.set(r.subject_id, []);
          rulesBySubject.get(r.subject_id).push(r);
        }
        const dependents = /* @__PURE__ */ new Map();
        for (const [subjectId, subjectRules] of rulesBySubject) {
          const groupSize = /* @__PURE__ */ new Map();
          for (const r of subjectRules) {
            const g = r.rule_group ?? 1;
            groupSize.set(g, (groupSize.get(g) ?? 0) + 1);
          }
          for (const r of subjectRules) {
            if (r.prerequisite_subject_id == null) continue;
            const weight = 1 / groupSize.get(r.rule_group ?? 1);
            if (!dependents.has(r.prerequisite_subject_id)) {
              dependents.set(r.prerequisite_subject_id, []);
            }
            dependents.get(r.prerequisite_subject_id).push({ id: subjectId, weight });
          }
        }
        const documented = rules.some((r) => r.requirement_type === STANDING && byId.has(r.subject_id));
        const gateFrom = options.yearGate === false || documented ? Infinity : Number(options.gateFromYear) || DEFAULTS.gateFromYear;
        const gateFor = (id) => {
          const s = byId.get(id);
          const y = Number(s?.year_level);
          if (!s || !Number.isFinite(y) || y < gateFrom) return null;
          const own = rulesBySubject.get(id) ?? [];
          if (own.some((r) => r.requirement_type === STANDING)) return null;
          return {
            subject_id: id,
            prerequisite_subject_id: null,
            requirement_type: STANDING,
            rule_type: "and",
            rule_group: 99,
            threshold_value: (y - 1) * 10 + 2,
            // through the end of the year before
            implicit: true
          };
        };
        const kb = {
          subjects,
          byId,
          rulesFor: (id) => {
            const own = rulesBySubject.get(id) ?? [];
            const gate = gateFor(id);
            return gate ? [...own, gate] : own;
          },
          dependentsOf: (id) => dependents.get(id) ?? []
        };
        const facts = buildFacts(student, records, subjects);
        const offeredIds = new Set(offerings.map((o) => o.subject_id));
        const useSchedule = options.respectOfferings !== false && offerings.length > 0;
        const blockOf = (s) => `${s.year_level ?? "-"}:${s.term ?? "-"}`;
        const scheduledBlocks = new Set(
          useSchedule ? subjects.filter((s) => offeredIds.has(s.id)).map(blockOf) : []
        );
        const scheduleStateOf = (s) => {
          if (!useSchedule) return "none";
          if (offeredIds.has(s.id)) return "offered";
          return scheduledBlocks.has(blockOf(s)) ? "not-run" : "pending";
        };
        const typeOf = (s) => s.elective_type ?? "IT";
        const isSlot = (s) => isElective(s) && s.year_level != null;
        const isCatalogue = (s) => isElective(s) && s.year_level == null;
        const positionOf = (s) => s.year_level * 10 + (Number(s.term) || 0);
        const slotFill = /* @__PURE__ */ new Map();
        const electives = {};
        let overflowUnits = 0;
        for (const type of new Set(subjects.filter(isElective).map(typeOf))) {
          const slots = subjects.filter((s) => isSlot(s) && typeOf(s) === type).sort((a, b) => positionOf(a) - positionOf(b) || a.code.localeCompare(b.code));
          const direct = slots.filter((s) => facts.passed.has(s.id));
          const open = slots.filter((s) => !facts.passed.has(s.id) && !facts.enrolled.has(s.id));
          const picked2 = subjects.filter((s) => isCatalogue(s) && typeOf(s) === type && facts.passed.has(s.id));
          picked2.forEach((c, i) => {
            if (i < open.length) slotFill.set(open[i].id, c);
            else overflowUnits += Number(c.units) || 0;
          });
          const filled = direct.length + Math.min(open.length, picked2.length);
          electives[type] = {
            slots: slots.length,
            filled,
            remaining: Math.max(0, open.length - picked2.length),
            options: 0
          };
        }
        const unitsEarned = Math.max(0, facts.unitsEarned - overflowUnits);
        const eligible = [];
        const locked = [];
        const completed = [];
        const inProgress = [];
        const takeable = new Set(subjects.filter((s) => !facts.passed.has(s.id) && !facts.enrolled.has(s.id) && !slotFill.has(s.id)).map((s) => s.id));
        for (let pass = 0; pass < DEFAULTS.maxIterations; pass++) {
          const withTakeable = { ...facts, alongside: takeable };
          let changed = false;
          for (const id of [...takeable]) {
            const s = byId.get(id);
            if (!evaluateSubject(s, kb.rulesFor(id), withTakeable, byId).satisfied) {
              takeable.delete(id);
              changed = true;
            }
          }
          if (!changed) break;
        }
        const factsTogether = { ...facts, alongside: takeable };
        for (const subject of subjects) {
          if (facts.passed.has(subject.id)) {
            completed.push(subject);
            continue;
          }
          if (facts.enrolled.has(subject.id)) {
            inProgress.push(subject);
            continue;
          }
          if (slotFill.has(subject.id)) {
            completed.push({ ...subject, filledBy: slotFill.get(subject.id) });
            continue;
          }
          if (isCatalogue(subject)) {
            const t = electives[typeOf(subject)];
            if (t.slots > 0 && t.remaining === 0) continue;
          }
          const subjectRules = kb.rulesFor(subject.id);
          const { satisfied, trace } = evaluateSubject(subject, subjectRules, factsTogether, byId);
          const scheduleState = scheduleStateOf(subject);
          const entry = {
            subject,
            trace,
            /* True when a student could enrol now as far as the schedule
               goes: it has a section, or there is no schedule to judge by. */
            offered: scheduleState === "offered" || scheduleState === "none",
            scheduleState,
            sections: offerings.filter((o) => o.subject_id === subject.id),
            retake: facts.failed.has(subject.id),
            /* Subjects this one must be taken together with, when a co-requisite
               is met only because the other is taken in the same term. */
            alongside: trace.flatMap((g) => g.conditions).filter((c) => c.alongside).map((c) => ({ id: c.subjectId, code: c.code, title: c.title }))
          };
          if (satisfied) {
            eligible.push(entry);
          } else {
            entry.unmet = trace.filter((g) => !g.met).flatMap((g) => g.conditions.filter((c) => !c.met));
            locked.push(entry);
          }
        }
        for (const type of Object.keys(electives)) {
          electives[type].options = eligible.filter((e) => isCatalogue(e.subject) && typeOf(e.subject) === type).length;
        }
        for (const e of eligible) {
          if (!isSlot(e.subject)) continue;
          e.slotOptions = eligible.filter((o) => isCatalogue(o.subject) && typeOf(o.subject) === typeOf(e.subject)).map((o) => ({ code: o.subject.code, title: o.subject.title, units: o.subject.units }));
        }
        for (const e of eligible) {
          e.unlocks = unlockImpact(e.subject.id, facts, kb);
          e.priority = scoreSubject(e, facts);
        }
        eligible.sort((a, b) => b.priority - a.priority || b.unlocks - a.unlocks || (a.subject.year_level ?? 9) - (b.subject.year_level ?? 9) || a.subject.code.localeCompare(b.subject.code));
        const enrolledUnits = inProgress.reduce((t, s) => t + (Number(s.units) || 0), 0);
        const totalUnits = subjects.filter((s) => s.year_level != null).reduce((t, s) => t + Number(s.units || 0), 0);
        const remainingUnits = Math.max(0, totalUnits - unitsEarned - enrolledUnits);
        const gradCap = Number(options.maxUnitsGraduating) || DEFAULTS.maxUnitsGraduating;
        const graduating = remainingUnits > 0 && remainingUnits <= gradCap;
        const maxUnits = graduating ? Math.max(Number(options.maxUnits) || 0, gradCap) : Number(options.maxUnits) || DEFAULTS.maxUnits;
        const availableUnits = Math.max(0, maxUnits - enrolledUnits);
        const term = Number(options.term) || null;
        for (const e of eligible) {
          let ok;
          if (e.scheduleState === "offered") ok = true;
          else if (e.scheduleState === "not-run") ok = false;
          else if (isCatalogue(e.subject)) ok = false;
          else ok = e.retake || term === null || Number(e.subject.term) === term;
          e.availableThisTerm = ok;
        }
        const recommended = [];
        let units = 0;
        const eligibleById = new Map(eligible.map((e) => [e.subject.id, e]));
        const picked = /* @__PURE__ */ new Set();
        const bundleOf = (e) => {
          const bundle = /* @__PURE__ */ new Map();
          const stack = [e];
          while (stack.length) {
            const cur = stack.pop();
            if (bundle.has(cur.subject.id)) continue;
            bundle.set(cur.subject.id, cur);
            for (const p of cur.alongside) {
              const partner = eligibleById.get(p.id);
              if (!partner) return null;
              stack.push(partner);
            }
          }
          return [...bundle.values()];
        };
        for (const e of eligible) {
          if (picked.has(e.subject.id)) continue;
          if (isCatalogue(e.subject)) continue;
          if (!e.availableThisTerm) continue;
          const bundle = bundleOf(e);
          if (!bundle) continue;
          if (bundle.some((b) => isCatalogue(b.subject) || !b.availableThisTerm)) continue;
          const fresh = bundle.filter((b) => !picked.has(b.subject.id));
          const need = fresh.reduce((t, b) => t + (Number(b.subject.units) || 0), 0);
          if (units + need > availableUnits) continue;
          for (const b of fresh) {
            picked.add(b.subject.id);
            recommended.push({ ...b, reason: recommendationReason(b, facts) });
          }
          units += need;
        }
        const rank = new Map(eligible.map((e, i) => [e.subject.id, i]));
        recommended.sort((a, b) => rank.get(a.subject.id) - rank.get(b.subject.id));
        const baseline = chainForward(facts, kb);
        for (const l of locked) {
          l.termsAway = baseline.get(l.subject.id) ?? null;
        }
        return {
          facts: {
            unitsEarned,
            completedThroughPosition: facts.completedThroughPosition,
            passedCount: facts.passed.size,
            failedCount: facts.failed.size,
            enrolledCount: facts.enrolled.size
          },
          completed,
          inProgress,
          eligible,
          locked,
          recommended,
          recommendedUnits: units,
          maxUnits,
          enrolledUnits,
          availableUnits,
          graduating,
          totalUnits,
          electives
        };
      }
      function scoreSubject(entry, facts) {
        const s = entry.subject;
        let score = 0;
        if (entry.retake) score += 1e3;
        score += entry.unlocks * 25;
        if (facts.yearLevel && s.year_level != null) {
          const behind = facts.yearLevel - s.year_level;
          if (behind > 0) score += behind * 60;
          if (behind < 0) score += behind * 30;
        }
        if (!isElective(s)) score += 20;
        return score;
      }
      function recommendationReason(entry, facts) {
        if (entry.alongside && entry.alongside.length) {
          return `Taken together with ${entry.alongside.map((a) => a.code).join(" and ")}: both are enrolled in the same term.`;
        }
        if (isElective(entry.subject) && entry.subject.year_level != null) {
          const n = entry.slotOptions?.length ?? 0;
          const kind = entry.subject.elective_type === "FREE" ? "free elective" : "programme elective";
          return n > 0 ? `Elective slot: choose one of ${n} ${kind}${n === 1 ? "" : "s"}.` : "Elective slot: no electives are listed for it yet.";
        }
        if (entry.retake) {
          return entry.unlocks > 0 ? `Retake. Passing this opens ${Math.round(entry.unlocks)} further subject${entry.unlocks === 1 ? "" : "s"}.` : "Retake. This subject was not passed and is still required.";
        }
        if (entry.unlocks >= 3) {
          return `Opens ${Math.round(entry.unlocks)} later subjects \u2014 taking it now avoids a bottleneck.`;
        }
        if (facts.yearLevel && entry.subject.year_level != null && entry.subject.year_level < facts.yearLevel) {
          return "Outstanding from an earlier year level.";
        }
        return "On track for this year level.";
      }
      function explain(entry) {
        if (!entry.trace || entry.trace.length === 0) {
          return ["No conditions \u2014 this subject is open to any student."];
        }
        return entry.trace.map((group) => {
          const parts = group.conditions.map((c) => c.detail);
          const body = group.kind === "any_of" ? "Any one of: " + parts.join(" or ") : parts.join(" ");
          return (group.met ? "\u2713 " : "\u2717 ") + body;
        });
      }
      return {
        assess,
        buildFacts,
        evaluateSubject,
        chainForward,
        highestCompletedPosition,
        firstIncompletePosition,
        isElective,
        describePosition,
        standingPosition,
        explain,
        DEFAULTS,
        PASSED,
        FAILED,
        ENROLLED,
        PREREQUISITE,
        CO_REQUISITE,
        STANDING
      };
    });
  }
});

// shared/js/curriculum/curriculumstart.js
var require_curriculumstart = __commonJS({
  "shared/js/curriculum/curriculumstart.js"(exports, module) {
    (function(root, factory) {
      if (typeof module === "object" && module.exports) module.exports = factory();
      else root.CurriculogicCurriculumStart = factory();
    })(typeof self !== "undefined" ? self : exports, function() {
      "use strict";
      function notStarted({ curriculumYear, currentYear, ownProspectus, recordCount }) {
        if (!Number.isInteger(curriculumYear) || !Number.isInteger(currentYear)) return false;
        if (curriculumYear <= currentYear) return false;
        return !ownProspectus || !(recordCount > 0);
      }
      function message(curriculumYear) {
        return `The curriculum for your programme takes effect in ${curriculumYear}\u2013${curriculumYear + 1}, so you cannot choose subjects from it yet. Please contact your department.`;
      }
      return { notStarted, message };
    });
  }
});

// supabase/functions/submit-advising-request/index.ts
var import_core = __toESM(require_core());
var import_engine = __toESM(require_engine());
var import_curriculumstart = __toESM(require_curriculumstart());
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
var json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});
function fallbackProspectus(programId, actives) {
  if (programId !== null && programId !== void 0) {
    return actives.find((p) => p.program_id === programId) ?? null;
  }
  return actives.length === 1 ? actives[0] : null;
}
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anon) {
      console.error("SUPABASE_URL / SUPABASE_ANON_KEY are not set.");
      return json(500, { error: "Server is not configured." });
    }
    const db = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: userData, error: authError } = await db.auth.getUser();
    if (authError || !userData?.user) return json(401, { error: "Not signed in." });
    let body = null;
    try {
      body = await req.json();
    } catch {
    }
    const selections = body?.items;
    if (!Array.isArray(selections) || selections.length === 0) {
      return json(400, { error: "Select at least one subject." });
    }
    const dryRun = body?.dryRun === true;
    const { data: student, error: studentError } = await db.from("university_student").select("id, year_level, prospectus_id, program_id, record_verified").eq("user_id", userData.user.id).maybeSingle();
    if (studentError || !student) {
      return json(403, { error: "No student record found for this account." });
    }
    if (!student.record_verified) {
      return json(403, { error: "Your academic record has not been verified yet." });
    }
    let prospectusId = student.prospectus_id ?? null;
    if (prospectusId === null) {
      const { data: actives } = await db.from("prospectus").select("id, program_id").eq("is_active", true);
      prospectusId = fallbackProspectus(student.program_id, actives ?? [])?.id ?? null;
    }
    if (prospectusId === null) {
      return json(403, { error: "No curriculum is assigned to your account yet." });
    }
    const { data: program } = student.program_id == null ? { data: null } : await db.from("program").select("max_units, max_units_graduating").eq("id", student.program_id).maybeSingle();
    const { data: subjects, error: subjectError } = await db.from("subject").select("id, code, title, units, year_level, term, is_elective, elective_type, is_active").eq("prospectus_id", prospectusId);
    if (subjectError) {
      console.error("subjects failed:", subjectError.message);
      return json(500, { error: "Could not load your academic data." });
    }
    const subjectIds = (subjects ?? []).map((s) => s.id);
    const { data: config } = await db.from("system_config").select("current_term, current_academic_year").eq("id", 1).maybeSingle();
    const term = config?.current_term ?? 1;
    const year = config?.current_academic_year ?? (/* @__PURE__ */ new Date()).getUTCFullYear();
    const [rulesRes, offeringsRes, recordsRes, requestsRes] = await Promise.all([
      db.from("prerequisite").select("subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value").in("subject_id", subjectIds),
      db.from("subject_offering").select("id, subject_id, is_open").eq("academic_year", year).eq("term", term),
      db.from("academic_record").select("subject_id, status, grade, grade_points, taken_term, taken_year").eq("student_id", student.id),
      db.from("request").select("id, status, registrar_status, created_at, request_item(subject_id, status)").eq("student_id", student.id).order("created_at", { ascending: false })
    ]);
    if (rulesRes.error || offeringsRes.error || recordsRes.error) {
      console.error("data load failed:", rulesRes.error, offeringsRes.error, recordsRes.error);
      return json(500, { error: "Could not load your academic data." });
    }
    if (requestsRes.error) {
      console.error("existing request load failed:", requestsRes.error.message);
      return json(500, { error: "Could not verify your existing requests. Please try again." });
    }
    const { data: chosenVersion } = await db.from("prospectus").select("academic_year").eq("id", prospectusId).maybeSingle();
    if (import_curriculumstart.default.notStarted({
      curriculumYear: chosenVersion?.academic_year,
      currentYear: year,
      ownProspectus: student.prospectus_id != null,
      recordCount: (recordsRes.data ?? []).length
    })) {
      return json(403, { error: import_curriculumstart.default.message(chosenVersion.academic_year), reason: "curriculum_not_started" });
    }
    const lockedIds = import_core.default.lockedSubjectIds(requestsRes.data ?? []);
    const blocked = selections.filter((sel) => lockedIds.has(sel.subjectId));
    if (blocked.length > 0) {
      const byId = new Map((subjects ?? []).map((s) => [s.id, s]));
      const codes = blocked.map((sel) => byId.get(sel.subjectId)?.code).filter(Boolean);
      return json(409, {
        error: codes.length ? `Already submitted and awaiting a decision: ${codes.join(", ")}. Refresh Build Your Plan and try again.` : "One or more selected subjects already have a request awaiting a decision. Refresh Build Your Plan and try again."
      });
    }
    const idSet = new Set(subjectIds);
    const offerings = (offeringsRes.data ?? []).filter((o) => idSet.has(o.subject_id));
    const evaluated = import_core.default.evaluateSelections({ engine: import_engine.default }, {
      student,
      program,
      records: recordsRes.data ?? [],
      subjects: subjects ?? [],
      rules: rulesRes.data ?? [],
      offerings,
      term,
      selections
    });
    const flaggedCount = evaluated.filter((e) => !e.valid).length;
    const unavailable = evaluated.filter((e) => e.unavailable);
    if (unavailable.length > 0) {
      const byId = new Map((subjects ?? []).map((s) => [s.id, s]));
      const codes = unavailable.map((e) => byId.get(e.subjectId)?.code).filter(Boolean);
      return json(422, {
        error: `Not available this semester: ${codes.join(", ")}. Refresh Build Your Plan and choose again.`
      });
    }
    if (dryRun) return json(200, { requestId: null, items: evaluated, flaggedCount, dryRun: true });
    const limit = import_core.default.submissionLimit(requestsRes.data ?? []);
    if (!limit.ok) return json(429, { error: limit.error });
    const { data: request, error: requestError } = await db.from("request").insert({
      student_id: student.id,
      prospectus_id: prospectusId,
      requested_term: body?.term ?? null,
      requested_year: body?.year ?? null,
      status: "submitted"
    }).select("id").single();
    if (requestError) {
      console.error("request insert failed:", requestError.message);
      return json(500, { error: "Could not create the request." });
    }
    const { error: itemsError } = await db.from("request_item").insert(
      evaluated.map((e) => ({
        request_id: request.id,
        subject_id: e.subjectId,
        offering_id: e.offeringId,
        status: e.valid ? "valid" : "flagged",
        remarks: e.reason
      }))
    );
    if (itemsError) {
      console.error("request_item insert failed:", itemsError.message);
      return json(500, {
        error: "The request was created but its subjects failed to save. Contact support with request ID " + request.id + "."
      });
    }
    return json(200, { requestId: request.id, items: evaluated, flaggedCount });
  } catch (err) {
    console.error("Unexpected error in submit-advising-request:", err);
    return json(500, { error: "Something went wrong submitting your request." });
  }
});
