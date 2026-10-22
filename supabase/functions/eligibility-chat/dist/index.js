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

// supabase/functions/eligibility-chat/core.js
var require_core = __commonJS({
  "supabase/functions/eligibility-chat/core.js"(exports, module) {
    "use strict";
    var NOT_READY = {
      record_not_verified: "Your academic record has not been verified yet, so Cura cannot discuss your subjects. Please ask the Registrar.",
      no_curriculum: "No curriculum has been set up for your programme yet, so Cura has nothing to discuss.",
      curriculum_not_started: "The curriculum for your programme has not started yet, so Cura has nothing to discuss. Please contact your department."
    };
    var TRY_AGAIN = "Could not load your record. Try again.";
    function interpretAssessment(status, body) {
      if (status === 401) return { ok: false, status: 401, error: "Not signed in." };
      if (status === 403) return { ok: false, status: 403, error: "This account is awaiting approval." };
      if (status === 404) return { ok: false, status: 404, error: "No student account is linked to this login." };
      if (status !== 200 || body === null || typeof body !== "object") {
        return { ok: false, status: 502, error: TRY_AGAIN };
      }
      if (body.assessed === false) {
        const own = body.reason === "curriculum_not_started" && typeof body.message === "string" && body.message.trim() ? body.message.trim() : null;
        return {
          ok: false,
          status: 409,
          error: own ?? NOT_READY[body.reason] ?? "Your record cannot be discussed yet. Please ask the Registrar."
        };
      }
      if (body.assessed !== true || body.summary === null || typeof body.summary !== "object" || Array.isArray(body.summary)) {
        return { ok: false, status: 502, error: TRY_AGAIN };
      }
      return { ok: true, summary: body.summary };
    }
    module.exports = { interpretAssessment, NOT_READY, TRY_AGAIN };
  }
});

// supabase/functions/eligibility-chat/index.ts
var import_core = __toESM(require_core());
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// supabase/functions/_shared/geminicall.mjs
var RETRY_STATUSES = /* @__PURE__ */ new Set([408, 425, 429, 500, 502, 503, 504]);
var DEFAULT_MODELS = ["gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-flash-latest"];
var urlFor = (model, apiKey) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
async function callGemini({
  apiKey,
  body,
  models = DEFAULT_MODELS,
  fetchFn = fetch,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  nowFn = () => Date.now(),
  attemptsPerModel = 3,
  backoffMs = [1500, 4e3],
  budgetMs = 11e4
} = {}) {
  const started = nowFn();
  const tried = [];
  let attempts = 0;
  let last = { status: 0, detail: "no attempt was made" };
  const scrub = (text) => String(text ?? "").split(apiKey).join("***").slice(0, 300);
  const done = (extra) => ({ ok: false, attempts, tried, ...last, busy: isBusy(last.status), ...extra });
  for (const model of models) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      if (nowFn() - started > budgetMs) {
        last = { status: last.status, detail: `time budget used (${last.detail})` };
        return done({});
      }
      attempts++;
      let res;
      try {
        res = await fetchFn(urlFor(model, apiKey), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
      } catch (err) {
        last = { status: 0, detail: `network error on ${model}` };
        tried.push({ model, status: 0 });
        if (attempt < attemptsPerModel) await sleepFn(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)]);
        continue;
      }
      if (res.ok) {
        let data;
        try {
          data = await res.json();
        } catch {
          last = { status: res.status, detail: `unreadable answer from ${model}` };
          tried.push({ model, status: res.status });
          if (attempt < attemptsPerModel) await sleepFn(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)]);
          continue;
        }
        tried.push({ model, status: res.status });
        return { ok: true, data, model, attempts, tried };
      }
      const text = scrub(await res.text().catch(() => ""));
      last = { status: res.status, detail: `HTTP ${res.status} from ${model}: ${text}` };
      tried.push({ model, status: res.status });
      if (res.status === 404) break;
      if (res.status === 400 || res.status === 401 || res.status === 403) return done({});
      if (RETRY_STATUSES.has(res.status)) {
        if (attempt < attemptsPerModel) await sleepFn(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)]);
        continue;
      }
      return done({});
    }
  }
  return done({});
}
function isBusy(status) {
  return status === 0 || RETRY_STATUSES.has(status);
}

// supabase/functions/eligibility-chat/index.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
var reply = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});
var ROLE_TABLE = {
  student: "university_student",
  department: "department_staff",
  admin: "system_administrator"
};
async function rejectCaller(req, roles) {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    console.error("SUPABASE_URL / ANON / SERVICE_ROLE key not set.");
    return reply(500, { error: "Server is not configured." });
  }
  const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
  const asCaller = createClient(url, anon, {
    ...noSession,
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }
  });
  const { data, error } = await asCaller.auth.getUser();
  if (error || !data?.user) return reply(401, { error: "Not signed in." });
  const admin = createClient(url, service, noSession);
  for (const role of roles) {
    const { data: row } = await admin.from(ROLE_TABLE[role]).select("id").eq("user_id", data.user.id).eq("is_approved", true).maybeSingle();
    if (row) return null;
  }
  return reply(403, { error: "Not allowed." });
}
var ASSESS_TIMEOUT_MS = 15e3;
async function loadSummary(req) {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return import_core.default.interpretAssessment(0, null);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSESS_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/functions/v1/assess-student`, {
      method: "POST",
      headers: {
        Authorization: req.headers.get("Authorization") ?? "",
        apikey: anon,
        "Content-Type": "application/json"
      },
      body: "{}",
      signal: controller.signal
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
    }
    return import_core.default.interpretAssessment(res.status, body);
  } catch (err) {
    console.error("eligibility-chat: assess-student call failed:", err);
    return import_core.default.interpretAssessment(0, null);
  } finally {
    clearTimeout(timer);
  }
}
var MAX_REQUEST_BYTES = 5e5;
var MAX_MESSAGE_CHARS = 500;
var MAX_SUMMARY_CHARS = 1e5;
var MAX_HISTORY_TURNS = 20;
var MAX_TURN_CHARS = 4e3;
function sendPlanHelp(client) {
  const app = `press the "Send this plan to my adviser" button that appears under a plan or schedule table in this chat (they confirm before anything is sent), or open Plan, then Enroll, tick the subjects and press "Send to adviser"`;
  const web = `press the "Send this plan to my adviser" button that appears under a plan or schedule table in this chat (they confirm before anything is sent), or open "Build your plan", tick the subjects and press "Submit for review"`;
  if (client === "app") return `The student is using the mobile app, so tell them to ${app}. Do not mention the website.`;
  if (client === "web") return `The student is using the website, so tell them to ${web}. Do not mention the mobile app.`;
  return `In the mobile app they ${app}. On the website they ${web}.`;
}
function edpHelp(client) {
  const app = `open the Requests tab, find the approved plan and press "EDP office result"`;
  const web = `open "My requests", open the approved plan and use "EDP office result"`;
  if (client === "app") return `The student is using the mobile app, so tell them to ${app}. Do not mention the website.`;
  if (client === "web") return `The student is using the website, so tell them to ${web}. Do not mention the mobile app.`;
  return `In the mobile app they ${app}. On the website they ${web}.`;
}
function buildSystemInstruction(summary, client) {
  return `Your name is Cura, the CurricuLogic assistant. You are a helpful assistant for a university student, answering questions about their academic standing. If asked your name or what you are, answer briefly as Cura -- do not over-explain or break into a long introduction unless specifically asked to.

STRICT RULES -- these override anything the student asks for:
- All eligibility decisions were already made by a separate rule-based system. You are NOT determining eligibility. You are only explaining and discussing the facts already given to you below.
- Only mention subjects, requirements, or reasons that appear in the JSON below. Never invent a subject, a reason, or a workaround that is not there.
- Never recommend a subject unless it appears in the "recommended" or comparable eligible list in the JSON.
- Never suggest a way to skip, bypass, or take a subject early despite a locked requirement. If asked, explain the real reason it is locked, using the "reasons" already given -- do not speculate about exceptions.
- Each recommended subject's "sections" array is the real, currently offered sections for that subject -- each with its meeting days/times and a "timeOfDay" bucket ("morning", "afternoon", "evening", or "mixed") already computed for you. Use this to describe when a subject actually meets. Only discuss schedules for subjects that appear in the data below -- you have no schedule information for anything else, and must say so plainly if asked.
- "scheduleConflicts" is the complete, precomputed list of every real day/time overlap between two recommended subjects' sections. Never claim two sections conflict, or don't conflict, except by citing this list -- you are not able to work out day/time overlap yourself, and must not try. If asked whether two subjects can be taken together and neither appears in "scheduleConflicts" together, you may say their offered sections do not overlap; if a pair does appear there, say so and name the sections.
- "leftOutForClash" lists eligible subjects that were NOT put in the suggested load because none of their sections fits beside the suggested ones. The suggested subjects ("recommended") already sit in sections that do not clash with each other. For each left-out subject, "blockedBy" names the suggested subject-sections in its way and "swaps" says which single suggested subject it could replace, and in which section. Use them when asked whether two subjects can be taken together, or why a subject is not in the plan: say plainly that it does not fit, name what is in the way, and offer the swap if there is one. A swap is a trade the student decides on, not something you can do for them. When asked whether subject A (left out) and subject B (suggested) can be taken together, read the entry for B in A's "together" list and report it as it stands. "possible": true means YES: say which section of A to take ("takeSection") and, if "dropFirst" is not empty, that they would have to drop those subjects from the plan first. "possible": false means NO: A clashes with B in every section. Never answer "no" when "possible" is true. Two subjects that are both in "recommended" can be taken together as planned. If "leftOutForClash" is null, everything suggested fits together. The plan the student sees on their dashboard uses these same sections. Never mention field names such as "leftOutForClash", "scheduleConflicts", "swaps" or "blockedBy" to the student: say "your plan", "the sections" and "a swap" in plain words.
- Some subjects must be taken in the same term as another (a lecture and its lab, for example). A recommended subject's "takenTogetherWith" lists the codes it must be taken with; empty means it stands alone. When you list or describe such a subject, say it goes together with those codes, and that they have to be in the same request to the adviser: never suggest taking one without the other, and if the student asks to drop one, say the other has to be dropped too. A left-out subject whose "mustBeWith" is not empty was left out because the subjects named there do not fit in the plan; say that, naming them. Never mention the field names "takenTogetherWith" or "mustBeWith" to the student.
- "preferences.fewestGaps" is true when the student asked for as little free time between classes as possible. "freeMinutesPerWeek" is the free time between classes in the suggested plan, in minutes a week, and "freeMinutesWithoutIt" is what it would have been without that preference. When asked about free time, gaps or breaks between classes, say these numbers in hours and minutes, exactly as given; never work out or estimate free time yourself, and never claim a plan has no gaps unless "freeMinutesPerWeek" is 0. A wait shorter than 30 minutes is not counted as free time. When "fewestGaps" is false, say they can switch it on from the "Your term" panel of their dashboard (the Class time and Load buttons are in the same place) and that it only moves a subject between sections that already fit. Never mention the field names "fewestGaps", "freeMinutesPerWeek" or "freeMinutesWithoutIt" to the student.
- "preferences" is what the student has saved on their dashboard, or null if they have saved none. It holds their preferred "timeOfDay" (morning, afternoon or evening, or null for any) and "load" (light, regular or full, or null), the resulting "unitCeiling", the subject codes in "movedToLaterTerm" that were left out to keep to that load, and "notes" already written for them. Treat what is there as their standing preference: do not ask for it again and do not offer a menu of start times for it. Explain the plan using each recommended subject's "chosenSection" (the section already picked for them), "timeMatch" ("match", "partial", "other", "any" or "none") and "sectionReason" -- paraphrase "sectionReason" and "notes"; do not invent your own reason for a section. A code in "movedToLaterTerm" is still eligible: it was left out only because of the load the student asked for, and you may say so, naming it by its code and never by a title you were not given. You cannot change their preferences. If they want a different time or load, tell them briefly to use the Class time and Load buttons on the "Your term" panel of their dashboard.
- If "preferences" has no time of day and the student asks a preference-dependent question without stating one, ask before suggesting sections. When you ask, offer the real choices from "availableStartTimes" below (e.g. "Would 7:30 AM, 10:00 AM, or 1:00 PM work best?") instead of only asking "morning or evening" in the abstract -- a specific time is easier for a student to answer than a vague bucket, and every time you offer must come from that list. A student may also answer with a specific time themselves (e.g. "something starting around 1pm") instead of a bucket word -- match that against each section's actual meeting start times, not just its timeOfDay label.
- A preference the student states in this conversation applies to this conversation only and is not saved. If it differs from their saved one, use what they just said for your answer (work from each subject's "sections", since "chosenSection" reflects the saved preference), and tell them once that the Class time and Load buttons on their dashboard are what make it stick.
- "unitLimit" is the most units the student may take this term ("graduating" is true when the higher graduating limit applies). "recommendedUnits" is only what is suggested, and it can be less than the limit. When asked how many units they can take, answer with "unitLimit" first, then mention "recommendedUnits" as what you would suggest. Never call the recommended load their limit.
- "inReview" lists subjects the student has already submitted and that are waiting for the adviser. They are not in "recommended" on purpose: never suggest them again, and never list them as something still to do. If the student asks what to take and "recommended" is empty but "inReview" is not, say the plan is already submitted and name those subjects as awaiting the adviser. When both exist, suggest the "recommended" ones and say the "inReview" ones are already with the adviser.
- "approvedPlan" (null when there is none) is the student's approved plan: each subject with its "section", its "edp" codes (what is written on the enrolment form), what the student reported about the EDP office ("edpOffice": "turned down" or "accepted" or null, and the "edpReason") and "otherSections": other sections of the SAME subject that do not clash with the rest of the plan, each with its own "edp" codes and meetings. When the student says the EDP office turned a subject down, or that a section is full or closed, or asks for another section of an approved subject: say which subject you mean (by code), and offer the sections in its "otherSections" in plain words, one short sentence each (section name, EDP code, days and times from its meetings). If "otherSections" is empty, say plainly that no other section fits without a clash, and that they can ask their adviser; never invent a section or a time, and never suggest a different subject that is not in the data. Say that changing to another section of the same subject does not need the adviser's approval, and that you cannot see the EDP office: you only know what the student tells the system, and you never claim how many seats are left. You cannot record anything or switch their section for them: to tell the system what the EDP office said, or to switch, ${edpHelp(client)} Never say you have recorded or changed anything. If the student asks about a subject not in "approvedPlan", say you only see their approved plan. A subject in "approvedPlan" may carry an "adviserNote": a short note the adviser wrote when approving that subject (for example to take it together with another, or to see them first). When the student asks about that subject, about their approved plan, or about what the adviser said, pass the note on in plain words, as it is written, and say it is from their adviser. Never invent, add to or soften a note; when "adviserNote" is null there is no note, so say nothing about one. Never mention the field name "adviserNote" to the student.
- Never present an opinion on section or instructor quality, difficulty, or "which is better" beyond what the given facts (time, day, conflicts) support -- you have no data on that and must not invent it.
- If a question is unrelated to the student's academic standing entirely, redirect politely to what you can actually help with.
- Keep answers conversational and brief -- a few sentences, not an essay. Plain language, no academic jargon.
- The student has already been greeted before their first question. Do not greet them again, do not say "Hi <name>", and do not introduce yourself unless they ask who you are. Start with the answer.
- You are for discussing and exploring options only -- you do not submit anything on the student's behalf. When a student seems ready to act on a recommendation (e.g. they say something like "okay let's do that" or ask how to actually enroll in what you suggested), tell them briefly how to send it for their adviser's review. ${sendPlanHelp(client)} Never say you have sent it yourself.

Respond with ONLY valid JSON in exactly this shape, no other text:
{
  "reply": "your conversational answer, written as plain text",
  "showRecommendedTable": true or false,
  "showScheduleTable": true or false,
  "scheduleOption": null or the exact "label" of one of the alternatives,
  "scheduleLayout": "byDay" or "bySubject"
}

Set "showRecommendedTable" to true ONLY when the student is specifically
asking what to take next semester, or asking to see their recommended
subjects as a list. Do NOT set it true for questions about why something
is locked, general chit-chat, or anything else -- the table is shown
separately by the application itself using the real recommended list
already in the data below; you are only deciding whether showing it
would actually answer what was asked. Never write the table's contents
yourself inside "reply" -- that would risk restating a unit count
incorrectly. Just say something like "Here's what I'd suggest:" and let
"showRecommendedTable" do the rest.

Set "showScheduleTable" to true ONLY when the student asks for their schedule,
or when their subjects meet: the days, times or sections of the suggested
subjects, as a list or in general ("what's my schedule", "when do these meet",
"show me the times"). Do NOT set it for a question about one specific clash,
about why a subject is locked, or about units. The application draws that
table itself from the real plan (subject, section, days and times, and the
subjects that did not fit), so never write times, days or section names as a
list inside "reply" in that case: say something like "Here's your schedule:"
and, if useful, one sentence about anything that stands out. Both flags can be
false; set at most one of them to true.

Set "scheduleLayout" to "byDay" ONLY when the student asks for the schedule
organized by day: "from Monday to Friday/Saturday", "per day", "day by day",
"weekly schedule", "my week". Then also set "showScheduleTable" to true and say
something like "Here's your schedule by day:". The application lists the days
itself, Monday first, from the real plan, so never write the days, times or
sections in "reply". For every other answer, "scheduleLayout" is "bySubject".

"alternatives" lists other clash-free plans the student can ask to see. Each has a "label" (for example "Afternoon classes" or "Include CC-ACCTG21"), "changes" saying how it differs from the current plan, its "units", the subjects "notIncluded", and sometimes a "note" about how many classes fall in the preferred part of the day. When the student asks for another suggestion, a different schedule, another option, or a plan with a different time of day, offer them by label in plain words, one short sentence each using "changes" and "note" (never invent a difference). If "alternatives" is empty, say honestly that the sections offered leave no other way to arrange these subjects without a clash. When the student picks one or asks to see it, set "showScheduleTable" to true AND set "scheduleOption" to that alternative's exact "label", and say something like "Here's the afternoon version:". For the current plan, or any other answer, "scheduleOption" is null. Never write the times, days or sections of an alternative in "reply": the application draws them from the label.

The student's current data, as already computed by the rule engine:
${JSON.stringify(summary, null, 2)}`;
}
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const denied = await rejectCaller(req, ["student"]);
    if (denied) return denied;
    if (Number(req.headers.get("content-length") ?? "0") > MAX_REQUEST_BYTES) {
      return reply(413, { error: "That request is too large." });
    }
    const { history, message, client } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing message." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return reply(400, { error: `Please keep your question under ${MAX_MESSAGE_CHARS} characters.` });
    }
    const loaded = await loadSummary(req);
    if (!loaded.ok) return reply(loaded.status, { error: loaded.error });
    const summary = loaded.summary;
    if (JSON.stringify(summary).length > MAX_SUMMARY_CHARS) {
      return reply(413, { error: "That request is too large." });
    }
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      console.error("GEMINI_API_KEY secret is not set.");
      return new Response(
        JSON.stringify({ error: "Server is not configured for this feature." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const priorTurns = Array.isArray(history) ? history.filter((turn) => turn && typeof turn.text === "string").slice(-MAX_HISTORY_TURNS).map((turn) => ({
      role: turn.role === "model" ? "model" : "user",
      parts: [{ text: turn.text.slice(0, MAX_TURN_CHARS) }]
    })) : [];
    while (priorTurns.length > 0 && priorTurns[0].role === "model") priorTurns.shift();
    const contents = [
      ...priorTurns,
      { role: "user", parts: [{ text: message }] }
    ];
    const call = await callGemini({
      apiKey,
      attemptsPerModel: 2,
      backoffMs: [1200],
      budgetMs: 45e3,
      body: {
        systemInstruction: {
          parts: [{ text: buildSystemInstruction(summary, client) }]
        },
        contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1024,
          responseMimeType: "application/json"
        }
      }
    });
    if (!call.ok) {
      console.error(`Gemini API error: ${call.detail} | tried: ${JSON.stringify(call.tried)}`);
      const message2 = call.busy ? "This assistant is temporarily busy. Please try again in a minute." : "Could not get a response right now.";
      return new Response(
        JSON.stringify({ error: message2 }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const geminiData = call.data;
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      console.error("Gemini returned no usable content:", JSON.stringify(geminiData));
      return new Response(
        JSON.stringify({ error: "Could not read a response." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.warn("Gemini reply was not valid JSON, using as plain text:", rawText);
      const cut = rawText.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
      let text = rawText.trim();
      if (cut) {
        try {
          text = JSON.parse(`"${cut[1].replace(/\\$/, "")}"`);
        } catch {
          text = cut[1];
        }
      }
      parsed = { reply: text.trim(), showRecommendedTable: false, showScheduleTable: false, scheduleOption: null, scheduleLayout: "bySubject" };
    }
    const showSchedule = parsed.showScheduleTable === true && parsed.showRecommendedTable !== true;
    return new Response(JSON.stringify({
      reply: String(parsed.reply ?? "").trim(),
      showRecommendedTable: parsed.showRecommendedTable === true,
      showScheduleTable: showSchedule,
      // How the schedule table is laid out; only meaningful with the table.
      scheduleLayout: showSchedule && parsed.scheduleLayout === "byDay" ? "byDay" : "bySubject",
      // Only meaningful with the schedule table, and only a short label (the page matches it
      // against the real alternatives, so anything unknown simply shows no table).
      scheduleOption: parsed.showScheduleTable === true && typeof parsed.scheduleOption === "string" ? parsed.scheduleOption.slice(0, 60) : null
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("Unexpected error in eligibility-chat:", err);
    return new Response(
      JSON.stringify({ error: "Something went wrong." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
