# Cura chat: how it works

Cura is the assistant on the student dashboard (Ask AI) and in the Android app. It explains results
that the rule engine has already decided; it never decides anything itself. Written 14 Oct 2026.

## 1. Where the facts come from

- The `eligibility-chat` Edge Function (v18) asks `assess-student` for the student's standing, using the
  student's own sign-in token, and gives that summary to the AI model. **Any `summary` in the request is
  ignored**, and there is no fallback to what the browser or app sent. See section 7 of
  `docs/SECURITY-OPERATIONS.md`.
- The AI model is Gemini (`gemini-3.1-flash-lite`) through Google's API. What it receives is described in the
  privacy notice (`features/auth/html/privacynotice.html`, section 3).
- The tables and chips under an answer are drawn by the page or app from its own copy of the summary. The model
  only says whether to show them.
- If the function fails, it answers `{ error: "..." }` with a message written for students ("Your academic record
  has not been verified yet...", "This assistant is temporarily busy...", "Please keep your question under 500
  characters."). The web chat and the app show that text; if there is none they show a generic line.

## 2. Conversations (db `073` to `075`)

- A student has many chats, like ChatGPT. Table `ai_chat_conversation`; every message has a `conversation_id`.
- The title is the first question (cut at 60 characters) until the student renames it (1 to 60 characters).
- A blank chat has **no row** until its first answer comes back, so pressing New chat never leaves an empty entry.
- The page and the app open the most recent chat. A message that arrives with no `conversation_id` is filed in
  the latest chat by a trigger.
- A student can rename and delete their own chats. Delete removes the chat and its messages for good, after a
  confirmation. Staff cannot read these tables.
- Chats older than six months are deleted by the daily cleanup (`048`); a conversation left empty is removed too.
- Cura is sent only the open chat's earlier messages; the function keeps the last 20 of them (the app sends up to 40).

## 3. The screens

**Website** (`features/student/studentdashboard.{html,js}`, `cura/`):
- On the Ask AI page the chat list appears **inside the app's left menu**, under the main links
  (`#side-chats`, shown only on that page). It has **New chat**, and the chats grouped by day (`chatlist.js`,
  tested in `tests/chatlist.test.mjs`). Each chat has a "..." menu with Rename and Delete.
- Rename is in place (Enter saves, Esc cancels). Delete uses a `<dialog>` that names the chat, then a short
  notice. On a phone the list is inside the menu drawer, and a "New chat" button sits in the chat header.
- Styling is in `cura/css/ai-chat.css`: frosted glass, with dark-mode variants.
- Two things that cost time to find, so they are written down: the page's `rise-in` animation leaves a transform
  on the card, which makes the card the reference box for `position: fixed` (fixed with
  `animation-fill-mode: backwards` on `.ai-chat-card`); and the page's CSS reset removes a modal dialog's automatic
  margin (restored with `margin: auto; inset: 0`).

**Android** (`ui/ai/`, `data/repository/ChatRepository.kt`, `data/mapper/ChatList.kt`):
- Header buttons **Chats** and **+ New**. Chats opens a bottom sheet (days, chats, a "⋮" menu with Rename and
  Delete, a delete confirmation). Same rules as the website; tested in `ChatConversationsTest`.
- Checked on a phone on 14 Oct 2026.

## 4. Deploying the function

```
node supabase/functions/eligibility-chat/build.mjs     # makes dist/index.js (core.js is bundled in)
```
Deploy `dist/index.js` as `index.js`, name `eligibility-chat`, with sign-in verification on. Deploying creates a
new version (the previous one is the rollback). Test it as a real student: a reply, the plan table and the
schedule table must still appear. The Android app needs no change when only the function changes.

## 5. Tests

`tests/eligibility-chat-core.test.mjs` (what the function does with the assessment), `tests/chatlist.test.mjs`
(day grouping and titles). In the Android repo: `ChatConversationsTest`, `ChatRepositoryTest`, `AiPresenterTest`.
The database rules (RLS, triggers) are checked by hand in a rolled-back transaction as the student; there is no
automated test for them.
