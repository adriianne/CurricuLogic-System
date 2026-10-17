// analyze-curriculum-document
//
// Receives a PDF (as base64), sends it to Gemini with a strict prompt
// asking it to (a) confirm this is actually a curriculum/prospectus
// document, and (b) if so, extract structured subject rows matching
// the same shape the manual curriculum builder already uses.
//
// The Gemini API key never leaves this server-side function -- it is
// read from a Supabase secret, never sent to or embedded in the
// frontend.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { BUSY_MESSAGE, callGemini, DEFAULT_MODELS } from "./geminicall.mjs";

// A curriculum is read once per upload, and telling the colours of the titles apart is where the smaller
// model went wrong, so the stronger model goes first here; the others stay as fallbacks if it is busy.
const MODELS = ["gemini-flash-latest", ...DEFAULT_MODELS.filter((m) => m !== "gemini-flash-latest")];

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

// A curriculum PDF is a few hundred KB. 10 MB of PDF is 13.4 million base64
// characters; the request limit leaves room for the JSON around it.
const MAX_REQUEST_BYTES = 15_000_000;
const MAX_BASE64_CHARS = 14_000_000;

// The exact JSON shape Gemini must return. Kept narrow and explicit --
// asking an LLM to "extract the curriculum" with no schema invites
// inconsistent field names on every response, which the frontend table
// can't render reliably.
const EXTRACTION_PROMPT = `You are analyzing a document to determine if it is a university curriculum or academic prospectus.

A valid curriculum/prospectus document contains things like: program name, academic year, year levels, semesters, subject codes, subject titles, units, lecture hours, laboratory hours, and prerequisites.

IMPORTANT -- exhaustiveness is required, not optional:
This document likely spans MULTIPLE PAGES and covers ALL YEAR LEVELS
(typically Year 1 through Year 4, each with multiple semesters). You must
read and extract from EVERY page and EVERY year level table present in
the document -- do not stop after the first table, do not treat Year 1
as representative of the rest, and do not summarize or sample. If the
document shows four years of curriculum, your subjects array must
contain rows from all four years, not just the first one you encounter.
Process the entire document from beginning to end before responding.

IMPORTANT -- reading lecture_units vs laboratory_units correctly:
Units are typically printed as three adjacent sub-columns under a
shared "Units" header, in this fixed left-to-right order: lec, lab,
total. A subject's row has a number under some of these sub-columns
and blanks under the others -- which sub-columns are blank is part of
the data, not noise, and tells you what the units actually are.

Worked example of the trap to avoid: a row reads "CC-PRACT40
Practicum" followed by two numbers before the pre-requisite column,
laid out as blank, 6, 6 under lec/lab/total. Read this positionally --
blank under lec, 6 under lab, 6 under total -- giving lecture_units: 0
and laboratory_units: 6. A first pass tends to grab the lone visible
number (6) and put it under lecture_units by habit, since most other
rows in the same document only ever fill the lec sub-column (a normal
lecture-only subject shows a number under lec with lab blank, e.g.
lecture_units: 3, laboratory_units: 0). That habit is exactly what
produces the wrong answer here: this row's number sits one column
over, under lab, not lec. Determine each row's sub-column positions
independently by their horizontal alignment with the lec/lab/total
headers -- never by assuming a lone number defaults to lecture_units.

IMPORTANT -- footnote marks:
Some prospectuses print a mark such as ** or *** in a subject's pre-requisite
/ remarks column, explained by a footnote near the bottom of the document, for
example "**must finish all 1st year to 2nd year courses". Return every such
footnote in the top-level "footnotes" array, with "marker" exactly as printed,
"text" as printed, and "through_year" as the LAST year level the footnote says
must be finished (2 for "1st year to 2nd year", 3 for "1st year to 3rd year"),
or null if the footnote is not about finishing year levels. For each subject
that carries such a mark, set "footnote_marker" to that marker exactly as
printed, otherwise null. Do not invent markers. A bullet, a unit-summary line
or a note about laboratory hours is NOT a footnote mark. If the document prints
no such marks, "footnotes" is an empty array and every "footnote_marker" is null.

IMPORTANT -- pre-requisites that are not subject codes:
The "prerequisites" array must contain ONLY subject codes, exactly as printed.
If the pre-requisite column also holds something that is not a subject code --
a group name such as "GEC", a phrase such as "All prof courses", or a standing
such as "3rd year standing" -- put that text, exactly as printed, in
"prerequisite_notes" and never in "prerequisites". If there is nothing of that
kind, "prerequisite_notes" is an empty array.

IMPORTANT -- co-requisites:
Some prospectuses print a separate "Co requisite" (or "Co-requisite") column beside the "Pre requisite" column.
Its subject codes belong in the subject's "corequisites" array, exactly as printed, one code per element, and
NEVER in "prerequisites". A subject that goes with several others lists them all. Read each row's own cells:
a co-requisite is listed on the row of the subject that needs it, and the subjects it names may themselves list
the first one back. If the document has no Co requisite column, "corequisites" is an empty array for every subject.

IMPORTANT -- kind of course ("category"):
Many prospectuses show what kind of course each subject is: the subject titles are printed in different
colours, and a "Summary of Courses" box totals the units for each kind (for example General Education
Courses, Core Computing Courses, Professional IT Courses, IT Electives / Free Electives). When the document
does this, set each subject's "category" to exactly one of:
  "GE"                 general education (a document that counts PE and NSTP with General Education uses "GE" for them too)
  "COMMON_COMPUTING"   core / common computing courses
  "PROFESSIONAL_IT"    professional courses of the programme
  "ELECTIVE"           the elective slots inside a semester
  "OTHER"              a kind the summary lists separately that fits none of the above
Decide from the title colour together with the wording of the summary, so that the unit totals of your
categories match the summary where the document gives one. If the document gives no way to tell the kinds
apart (no colours and no summary), set "category" to null for every subject. Never decide a category from the
subject code alone, and do NOT sort subjects by the prefix of their code: in one document, codes with the same
prefix are often printed in different colours (for example one CC- course in red and another CC- course in
blue), and the printed colour is what counts. Look at the actual colour of each subject's title text. When the
summary box prints its lines in colours (for example green for General Education, red for Core Computing, blue
for Professional IT, black for electives), a title printed in that colour belongs to that line. Before you
answer, add up the units of each category and compare with the summary; where they differ, look again at the
subjects whose colour you were unsure of.

IMPORTANT -- elective course lists:
Some prospectuses end with boxes such as "IT ELECTIVE COURSES" and "FREE ELECTIVE COURSES": lists of
elective courses a student may choose from (code, title, units, pre-requisite). They belong to no year or
semester. Return every course in those lists as its own subject with "year_level": null, "term": null and
"elective_type": "IT" for the IT / programme elective list or "FREE" for the free elective list, with its
units, pre-requisites and "category": "ELECTIVE". These boxes usually print a single "units" column with
one number (for example 3) and no lec / lab split: put that number in "lecture_units" and 0 in
"laboratory_units", never leave both null. Do NOT list here the placeholder rows that sit inside a
semester ("IT Elective 1", "Free Elective 2"): those stay ordinary subjects of their year and semester, with
"elective_type": null. If the document has no such lists, return no such subjects.

Respond with ONLY valid JSON, no other text, in exactly this shape:

{
  "is_curriculum_document": true or false,
  "rejection_reason": "string explaining why, only if is_curriculum_document is false, otherwise null",
  "program_name": "string or null",
  "academic_year": "string or null, e.g. 2023-2024",
  "footnotes": [
    { "marker": "string", "text": "string", "through_year": number or null }
  ],
  "subjects": [
    {
      "year_level": number or null,
      "term": number or null (1 for 1st semester, 2 for 2nd semester, 3 for summer),
      "code": "string",
      "title": "string",
      "lecture_units": number or null,
      "laboratory_units": number or null,
      "prerequisites": ["array of subject code strings, empty array if none"],
      "prerequisite_notes": ["array of non-code pre-requisite text, empty array if none"],
      "corequisites": ["array of subject code strings from the Co requisite column, empty array if none"],
      "footnote_marker": "string or null",
      "category": "GE" or "COMMON_COMPUTING" or "PROFESSIONAL_IT" or "ELECTIVE" or "OTHER" or null,
      "elective_type": "IT" or "FREE" for a course in an elective list that belongs to no year, otherwise null
    }
  ]
}

If the document is clearly NOT a curriculum or prospectus (e.g. it is a resume, an invoice, a random essay, a photo of a landscape, etc.), set is_curriculum_document to false, explain briefly why in rejection_reason, and return an empty subjects array.

Be conservative: if you are not confident a field's value is correct, use null rather than guessing. Do not invent subjects that are not clearly present in the document.`;

// The call itself (a busy answer retried with waiting, another model tried when one is
// gone or still busy, the key never logged) lives in geminicall.mjs, shared with
// analyze-schedule-document. What stays here is the part only this function knows: an
// answer that arrives but is empty or cut off is worth one more go, because the same PDF
// that fails once usually succeeds on the next call.
const MAX_ATTEMPTS = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Attempt =
  | { ok: true; parsed: any }
  | { ok: false; retry: boolean; detail: string; busy: boolean };

async function askGemini(
  apiKey: string,
  fileBase64: string,
  mimeType: string,
): Promise<Attempt> {
  const call = await callGemini({
    apiKey,
    models: MODELS,
    body: {
      contents: [
        {
          parts: [
            { text: EXTRACTION_PROMPT },
            { inline_data: { mime_type: mimeType, data: fileBase64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        // Explicit and generous. A 4-year, multi-semester subject
        // list is long; leaving this unset risks the response being
        // cut off mid-array, which silently drops later years. Raised
        // from 8192 when each subject gained two more fields.
        maxOutputTokens: 16384,
      },
    },
  });

  if (!call.ok) {
    return {
      ok: false,
      retry: false, // geminicall already retried and tried the other models
      busy: call.busy,
      detail: `${call.detail} | tried: ${JSON.stringify(call.tried)}`,
    };
  }

  const rawText = call.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    return {
      ok: false,
      retry: true,
      busy: false,
      detail: `no usable content: ${JSON.stringify(call.data).slice(0, 500)}`,
    };
  }

  try {
    return { ok: true, parsed: JSON.parse(rawText) };
  } catch {
    return {
      ok: false,
      retry: true,
      busy: false,
      detail: `response was not valid JSON (possibly cut off): ${rawText.slice(-200)}`,
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const denied = await rejectCaller(req, ["department", "admin"]);
    if (denied) return denied;

    if (Number(req.headers.get("content-length") ?? "0") > MAX_REQUEST_BYTES) {
      return reply(413, { error: "That file is too large (10 MB maximum)." });
    }

    const { fileBase64, mimeType } = await req.json();

    if (!fileBase64 || !mimeType) {
      return reply(400, { error: "Missing fileBase64 or mimeType." });
    }

    if (typeof fileBase64 !== "string" || mimeType !== "application/pdf") {
      return reply(400, { error: "Only a PDF file can be analysed." });
    }

    if (fileBase64.length > MAX_BASE64_CHARS) {
      return reply(413, { error: "That file is too large (10 MB maximum)." });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      console.error("GEMINI_API_KEY secret is not set.");
      return new Response(
        JSON.stringify({ error: "Server is not configured for document analysis." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let parsed: any = null;
    let lastDetail = "";
    let lastBusy = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await askGemini(apiKey, fileBase64, mimeType);
      if (result.ok) {
        parsed = result.parsed;
        if (attempt > 1) console.log(`Succeeded on attempt ${attempt}.`);
        break;
      }
      lastDetail = result.detail;
      lastBusy = result.busy;
      console.error(`Gemini attempt ${attempt}/${MAX_ATTEMPTS} failed: ${result.detail}`);
      if (!result.retry || attempt === MAX_ATTEMPTS) break;
      await sleep(1500 * attempt);
    }

    if (!parsed) {
      console.error("Giving up after retries:", lastDetail);
      // 503 when Google is busy (the page shows "busy, try again in a few minutes"); 502 otherwise.
      return new Response(
        JSON.stringify({
          error: lastBusy ? BUSY_MESSAGE : "The document analysis service failed. Try again.",
        }),
        { status: lastBusy ? 503 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Diagnostic: how many subjects Gemini itself returned, before this
    // response ever reaches the frontend. If a future upload comes back
    // thin again, this number in the function logs tells us immediately
    // whether Gemini under-extracted (this number is already low) or
    // the frontend dropped rows afterward (this number is high but the
    // table is not).
    console.log(
      `Extraction result: is_curriculum_document=${parsed.is_curriculum_document}, ` +
      `subjects_returned=${Array.isArray(parsed.subjects) ? parsed.subjects.length : 0}`
    );

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Unexpected error in analyze-curriculum-document:", err);
    return new Response(
      JSON.stringify({ error: "Something went wrong while analyzing the document." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
