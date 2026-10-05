// eligibility-chat
//
// A conversational version of explain-eligibility. Same boundary, same
// underlying data, different shape: this handles a back-and-forth
// conversation instead of producing one fixed paragraph.
//
// The compact summary (from summarizeForExplanation()) and the strict
// rules both live in Gemini's systemInstruction, set once per request --
// not repeated inside every message. The actual conversation history is
// held by the browser and sent whole each time, since this function has
// no server-side session of its own.
//
// v7: the student's saved preferences (class time, load) arrive inside the
// summary as "preferences", together with the section already picked for
// each recommended subject. Cura explains those; it does not ask for them
// again and cannot change them.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Who may call this function.
//
// verify_jwt (on in the dashboard) only proves the token is validly signed,
// and the public anon key IS a validly signed token, so on its own it lets a
// signed-out visitor straight through to a paid AI call. This checks that the
// token belongs to a real, approved account with one of the allowed roles.
// Returns null when the caller may proceed, otherwise the response to send.
type CallerRole = "student" | "department" | "admin";
const ROLE_TABLE: Record<CallerRole, string> = {
  student: "university_student",
  department: "department_staff",
  admin: "system_administrator",
};

async function rejectCaller(req: Request, roles: CallerRole[]): Promise<Response | null> {
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
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data, error } = await asCaller.auth.getUser();
  if (error || !data?.user) return reply(401, { error: "Not signed in." });

  const admin = createClient(url, service, noSession);
  for (const role of roles) {
    const { data: row } = await admin
      .from(ROLE_TABLE[role])
      .select("id")
      .eq("user_id", data.user.id)
      .eq("is_approved", true)
      .maybeSingle();
    if (row) return null;
  }
  return reply(403, { error: "Not allowed." });
}

// What one request may carry. The browser holds the conversation and sends it
// whole each time, so none of this can be left to the browser to keep small.
const MAX_REQUEST_BYTES = 500_000;
const MAX_MESSAGE_CHARS = 500;     // same as the chat box's maxlength
const MAX_SUMMARY_CHARS = 100_000;
const MAX_HISTORY_TURNS = 20;
const MAX_TURN_CHARS = 4_000;

function buildSystemInstruction(summary: unknown): string {
  return `Your name is Cura, the CurricuLogic assistant. You are a helpful assistant for a university student, answering questions about their academic standing. If asked your name or what you are, answer briefly as Cura -- do not over-explain or break into a long introduction unless specifically asked to.

STRICT RULES -- these override anything the student asks for:
- All eligibility decisions were already made by a separate rule-based system. You are NOT determining eligibility. You are only explaining and discussing the facts already given to you below.
- Only mention subjects, requirements, or reasons that appear in the JSON below. Never invent a subject, a reason, or a workaround that is not there.
- Never recommend a subject unless it appears in the "recommended" or comparable eligible list in the JSON.
- Never suggest a way to skip, bypass, or take a subject early despite a locked requirement. If asked, explain the real reason it is locked, using the "reasons" already given -- do not speculate about exceptions.
- Each recommended subject's "sections" array is the real, currently offered sections for that subject -- each with its meeting days/times and a "timeOfDay" bucket ("morning", "afternoon", "evening", or "mixed") already computed for you. Use this to describe when a subject actually meets. Only discuss schedules for subjects that appear in the data below -- you have no schedule information for anything else, and must say so plainly if asked.
- "scheduleConflicts" is the complete, precomputed list of every real day/time overlap between two recommended subjects' sections. Never claim two sections conflict, or don't conflict, except by citing this list -- you are not able to work out day/time overlap yourself, and must not try. If asked whether two subjects can be taken together and neither appears in "scheduleConflicts" together, you may say their offered sections do not overlap; if a pair does appear there, say so and name the sections.
- "leftOutForClash" lists eligible subjects that were NOT put in the suggested load because none of their sections fits beside the suggested ones. The suggested subjects ("recommended") already sit in sections that do not clash with each other. For each left-out subject, "blockedBy" names the suggested subject-sections in its way and "swaps" says which single suggested subject it could replace, and in which section. Use them when asked whether two subjects can be taken together, or why a subject is not in the plan: say plainly that it does not fit, name what is in the way, and offer the swap if there is one. A swap is a trade the student decides on, not something you can do for them. When asked whether subject A (left out) and subject B (suggested) can be taken together, read the entry for B in A's "together" list and report it as it stands. "possible": true means YES: say which section of A to take ("takeSection") and, if "dropFirst" is not empty, that they would have to drop those subjects from the plan first. "possible": false means NO: A clashes with B in every section. Never answer "no" when "possible" is true. Two subjects that are both in "recommended" can be taken together as planned. If "leftOutForClash" is null, everything suggested fits together. The plan the student sees on their dashboard uses these same sections. Never mention field names such as "leftOutForClash", "scheduleConflicts", "swaps" or "blockedBy" to the student: say "your plan", "the sections" and "a swap" in plain words.
- "preferences" is what the student has saved on their dashboard, or null if they have saved none. It holds their preferred "timeOfDay" (morning, afternoon or evening, or null for any) and "load" (light, regular or full, or null), the resulting "unitCeiling", the subject codes in "movedToLaterTerm" that were left out to keep to that load, and "notes" already written for them. Treat what is there as their standing preference: do not ask for it again and do not offer a menu of start times for it. Explain the plan using each recommended subject's "chosenSection" (the section already picked for them), "timeMatch" ("match", "partial", "other", "any" or "none") and "sectionReason" -- paraphrase "sectionReason" and "notes"; do not invent your own reason for a section. A code in "movedToLaterTerm" is still eligible: it was left out only because of the load the student asked for, and you may say so, naming it by its code and never by a title you were not given. You cannot change their preferences. If they want a different time or load, tell them briefly to use the Class time and Load buttons on the "Your term" panel of their dashboard.
- If "preferences" has no time of day and the student asks a preference-dependent question without stating one, ask before suggesting sections. When you ask, offer the real choices from "availableStartTimes" below (e.g. "Would 7:30 AM, 10:00 AM, or 1:00 PM work best?") instead of only asking "morning or evening" in the abstract -- a specific time is easier for a student to answer than a vague bucket, and every time you offer must come from that list. A student may also answer with a specific time themselves (e.g. "something starting around 1pm") instead of a bucket word -- match that against each section's actual meeting start times, not just its timeOfDay label.
- A preference the student states in this conversation applies to this conversation only and is not saved. If it differs from their saved one, use what they just said for your answer (work from each subject's "sections", since "chosenSection" reflects the saved preference), and tell them once that the Class time and Load buttons on their dashboard are what make it stick.
- "unitLimit" is the most units the student may take this term ("graduating" is true when the higher graduating limit applies). "recommendedUnits" is only what is suggested, and it can be less than the limit. When asked how many units they can take, answer with "unitLimit" first, then mention "recommendedUnits" as what you would suggest. Never call the recommended load their limit.
- "inReview" lists subjects the student has already submitted and that are waiting for the adviser. They are not in "recommended" on purpose: never suggest them again, and never list them as something still to do. If the student asks what to take and "recommended" is empty but "inReview" is not, say the plan is already submitted and name those subjects as awaiting the adviser. When both exist, suggest the "recommended" ones and say the "inReview" ones are already with the adviser.
- Never present an opinion on section or instructor quality, difficulty, or "which is better" beyond what the given facts (time, day, conflicts) support -- you have no data on that and must not invent it.
- If a question is unrelated to the student's academic standing entirely, redirect politely to what you can actually help with.
- Keep answers conversational and brief -- a few sentences, not an essay. Plain language, no academic jargon.
- You are for discussing and exploring options only -- you do not submit anything on the student's behalf. When a student seems ready to act on a recommendation (e.g. they say something like "okay let's do that" or ask how to actually enroll in what you suggested), tell them briefly to go to the Advising Requests tab to select those subjects and submit them for their adviser's review.

Respond with ONLY valid JSON in exactly this shape, no other text:
{
  "reply": "your conversational answer, written as plain text",
  "showRecommendedTable": true or false,
  "showScheduleTable": true or false,
  "scheduleOption": null or the exact "label" of one of the alternatives
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

    const { summary, history, message } = await req.json();

    if (!summary || typeof summary !== "object") {
      return new Response(
        JSON.stringify({ error: "Missing student summary data." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing message." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (message.length > MAX_MESSAGE_CHARS) {
      return reply(400, { error: `Please keep your question under ${MAX_MESSAGE_CHARS} characters.` });
    }

    if (JSON.stringify(summary).length > MAX_SUMMARY_CHARS) {
      return reply(413, { error: "That request is too large." });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      console.error("GEMINI_API_KEY secret is not set.");
      return new Response(
        JSON.stringify({ error: "Server is not configured for this feature." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // history is an array of { role: 'user' | 'model', text: string },
    // held entirely by the browser -- this function is stateless.
    // Only the most recent turns, each cut to a sensible length.
    const priorTurns = Array.isArray(history)
      ? history
          .filter((turn: any) => turn && typeof turn.text === "string")
          .slice(-MAX_HISTORY_TURNS)
          .map((turn: { role: string; text: string }) => ({
            role: turn.role === "model" ? "model" : "user",
            parts: [{ text: turn.text.slice(0, MAX_TURN_CHARS) }],
          }))
      : [];
    // A conversation sent to Gemini has to open with the student's turn, and
    // cutting to the last N can leave a reply first.
    while (priorTurns.length > 0 && priorTurns[0].role === "model") priorTurns.shift();

    const contents = [
      ...priorTurns,
      { role: "user", parts: [{ text: message }] },
    ];

    const MAX_ATTEMPTS = 2;
    const RETRY_DELAY_MS = 3000;

    let geminiResponse: Response | null = null;
    let lastErrorText = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: buildSystemInstruction(summary) }],
            },
            contents,
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 512,
              responseMimeType: "application/json",
            },
          }),
        },
      );

      if (geminiResponse.ok) break;

      lastErrorText = await geminiResponse.text();
      console.error(`Gemini API error (attempt ${attempt}/${MAX_ATTEMPTS}):`, lastErrorText);

      const isRetryable = geminiResponse.status === 503 || geminiResponse.status === 429;
      if (isRetryable && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      break;
    }

    if (!geminiResponse || !geminiResponse.ok) {
      const isBusy = lastErrorText.includes("UNAVAILABLE") || lastErrorText.includes("high demand");
      const message = isBusy
        ? "This assistant is temporarily busy. Please try again in a minute."
        : "Could not get a response right now.";
      return new Response(
        JSON.stringify({ error: message }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const geminiData = await geminiResponse.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      console.error("Gemini returned no usable content:", JSON.stringify(geminiData));
      return new Response(
        JSON.stringify({ error: "Could not read a response." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      // Fall back to plain text if Gemini ever ignores the JSON
      // instruction -- the chat still works, it just never shows a table
      // for that one reply.
      console.warn("Gemini reply was not valid JSON, using as plain text:", rawText);
      parsed = { reply: rawText.trim(), showRecommendedTable: false, showScheduleTable: false, scheduleOption: null };
    }

    return new Response(JSON.stringify({
      reply: String(parsed.reply ?? "").trim(),
      showRecommendedTable: parsed.showRecommendedTable === true,
      showScheduleTable: parsed.showScheduleTable === true && parsed.showRecommendedTable !== true,
      // Only meaningful with the schedule table, and only a short label (the page matches it
      // against the real alternatives, so anything unknown simply shows no table).
      scheduleOption: parsed.showScheduleTable === true && typeof parsed.scheduleOption === "string"
        ? parsed.scheduleOption.slice(0, 60)
        : null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Unexpected error in eligibility-chat:", err);
    return new Response(
      JSON.stringify({ error: "Something went wrong." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
