<!-- Frontend-side helpers for AI-assisted features. Prepares data for
     and calls Supabase Edge Functions that use the Gemini API.
     
     Does NOT include engine.js -- the rule-based inference engine is
     deliberately kept separate under shared/engine/, since it is
     symbolic, deterministic reasoning, not generative AI. -->