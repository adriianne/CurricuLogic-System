<!-- The browser side of Cura, the CurricuLogic student chat: the chat panel
     logic, the saved-chats list, the suggested questions, and the summary
     of the student's standing that Cura reads. Calls the Supabase Edge
     Function eligibility-chat, which uses the Gemini API.

     Does NOT include engine.js -- the rule-based inference engine is
     deliberately kept separate under shared/engine/, since it is
     symbolic, deterministic reasoning, not generative AI.

     (This folder was called ai-assist/ until 21 Oct 2026.) -->
