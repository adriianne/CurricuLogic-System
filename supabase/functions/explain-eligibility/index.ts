// explain-eligibility -- RETIRED.
//
// This was the one-paragraph version of the student advisor; eligibility-chat
// replaced it and nothing in the app calls it any more. v1 was deployed with
// verify_jwt off and no checks of its own, so anyone on the internet could run
// it against the paid Gemini key. v2 is this stub: it needs a valid token to
// reach it at all and then does nothing.
//
// The function can be deleted outright in the Supabase dashboard
// (Edge Functions -> explain-eligibility -> Delete).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({ error: "This function has been retired." }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
