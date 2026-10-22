# supabase/functions

The server functions. Each folder is one function; the folder name is the
function's name (and part of its web address), so do not rename them.

Every function is deployed with the JWT check **on**. The Gemini functions need
the `GEMINI_API_KEY` secret.

## How each one is deployed

There are two ways, because three functions share the rules engine with the
website and the others are single files.

| Function | What it does | What you deploy |
|---|---|---|
| `assess-student` | Works out what a student may take, on the server | Built file: `dist/index.js`, entrypoint `index.js` |
| `submit-advising-request` | Checks and saves a student's plan | Built file: `dist/index.js`, entrypoint `index.js` |
| `eligibility-chat` | Cura, the student chat | Built file: `dist/index.js`, entrypoint `index.js` |
| `analyze-curriculum-document` | Reads an uploaded curriculum file (AI) | Two files: `index.ts` **and** `geminicall.mjs` (see below) |
| `analyze-schedule-document` | Reads a photo of a schedule form (AI) | Two files: `index.ts` **and** `geminicall.mjs` (see below) |
| `sign-in` | Turns an ID or school email plus a password into a session | One file: `index.ts` |
| `explain-eligibility` | Retired: always answers 410. Can be deleted in the dashboard | One file: `index.ts` |

### The built three

`assess-student`, `submit-advising-request` and `eligibility-chat` each have
`index.ts` (the entry), `core.js` (the rules, tested in Node), `build.mjs` and
`dist/`. Edit `index.ts` and `core.js`, never `dist/`.

```
node supabase/functions/<name>/build.mjs      # writes <name>/dist/index.js
```

`dist/index.js` is one file that already contains everything the function
imports: for `assess-student` and `submit-advising-request` the shared engine
(`shared/engine/`) and helpers from `shared/js/` and `cura/`, and for
`eligibility-chat` its `core.js` and `_shared/geminicall.mjs`. It is not
minified, so you can read it in the dashboard. Rebuild after any change to
`index.ts`, `core.js`, or any file under `shared/` or `cura/` that the function
imports.

### The two document readers

`analyze-curriculum-document` and `analyze-schedule-document` import
`./geminicall.mjs`, a file that sits **next to** `index.ts` when deployed. That
file is not in their folders in this repo: the one copy lives in
`_shared/geminicall.mjs`. When you deploy either function, upload both files:

1. `index.ts` from the function's folder
2. `geminicall.mjs`, a copy of `supabase/functions/_shared/geminicall.mjs`

This is how the live functions are laid out (checked 21 Oct 2026). If
`_shared/geminicall.mjs` changes, redeploy **all three** functions that use it:
the two readers (upload the new copy) and `eligibility-chat` (rebuild first, as
the file is bundled into it).

## Tests

```
node --test tests/*.test.mjs
```

`tests/geminicall.test.mjs` covers the shared Gemini helper. The rules inside
the built functions are covered by `tests/assess-student.test.mjs`,
`tests/submit-request.test.mjs` and `tests/eligibility-chat-core.test.mjs`.
