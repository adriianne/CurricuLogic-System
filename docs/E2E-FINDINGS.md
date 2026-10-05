# End-to-end test findings (BSIT, 2026-10-04)

Plan: `docs/E2E-TEST-PLAN.md`. Test accounts: `zz.e2e.*@example.com`. Cleanup: `db/tools/e2e-cleanup.sql`.

## Cohort (all BSIT, existing path, IDs 9900001-9900004)
| ID | Profile | Records | Verified |
|---|---|---|---|
| 9900001 | Old (regular) | all of year 1 (16) | yes |
| 9900002 | Returnee | year 1 + year 2 sem 1, taken 2020-21 (24) | yes |
| 9900003 | Transferee | 11 general-education credits only | no (Registrar to verify in the browser) |
| 9900004 | Irregular | CC-COMPROG11 failed, CC-COMPROG12 never taken, part of year 2 (19) | yes |
A NEW student is to self-register on the Register page (the ID is issued on approval).

## Phase 1: Admin (website)
Works:
- Students page lists the new accounts (after a reload; the page loads its data once).
- Staff management lists all staff with role, programme, status; Edit changes the programme only.
  Saving moved ZZ Test Faculty from BSIT to BSN and the audit log recorded 7 -> 14.

Observations:
1. BSIT has TWO department accounts (EMP-00001 and EMP-00007) although the cap is one per
   programme. Older accounts predate the cap (db/047). Decide which is real and retire the other.
2. The admin cannot edit a student (e.g. correct a year level) or a staff member's name or e-mail;
   only the programme. If that matters for the demo it is a gap.
3. Not driven by me: the Create account form and the bulk upload (they need a password typed or a
   file with passwords); the creation path itself was exercised through the same `create_user_account`
   function the form calls.

## Phase 2: Registrar (website)
Works:
- Student detail shows the 11 credited subjects (31 units) of the Transferee; "Verify record" saved
  (record_verified, verified_by, verified_at set; audit row written) and the button flipped to "Mark unverified".
- Dashboard, Approved plans and Students pages load with no console errors.

Observations:
4. After clicking "Verify record" the page kept showing "Unverified" for a moment (the first screenshot,
   taken right after the click, was stale) before it flipped. A "Saving..." state would remove the doubt.
5. Approved plans lists 9 approved requests, 7 of them for the same student (Rachel New) with repeated
   subject sets (e.g. the same 4 subjects / 11 units four times). Older test data from before the duplicate
   guard in submit-advising-request; worth confirming that the guard now stops a repeat (Phase 4).
6. The "New student" self-registration for the account-request and possible-matches checks has not
   been done yet: no pending request exists.

## Phase 3/4: Student "Old" (9900001) on the website
Works:
- Sign-in with uc-9900001. Dashboard numbers match the records: 16 completed, 46 units earned,
  18 eligible, 20 locked. 8 suggested = the whole of year 2 sem 1 (23 of 24 units).
- Build your plan: submitted the 8 suggested subjects; request #17 saved with 8 items, 0 flagged.
  The submitted subjects then disappeared from the page (the duplicate guard works).
- Cura opens with a greeting and answers; the plan table in its reply is built from real data.

Findings (most important first):
7. `must_change_password` is never enforced. Admin-created accounts carry a temporary password and the
   flag is true, but nobody is made to change it: the student dashboard ignores the flag, and the
   faculty/registrar/department dashboards only set it to false on load. The temporary password stays.
8. The suggested plan contains subjects that clash in every section. The sample schedule puts every lab in
   one slot (2A: Fri 13:00-16:00, 2B: Sat 08:00-11:00), so at most two of the five lab subjects fit together,
   yet "Select all suggested" picks all eight and the page reports 10 clashes. A smarter planner would
   recommend the best clash-free subset and say what it left out and why.
9. The server accepts a plan with clashes: request #17 had 10 clashes and was saved, none flagged.
   Only the page warns; submit-advising-request does not check schedules.
10. Cura keeps recommending subjects the student has already submitted (pending request). The Build your plan page
    hides them; Cura does not.
11. Cura, "How many units can I take": answered "Your current recommended load is 23 units" instead of the
    limit (24, or 27 when graduating). It confuses recommended with allowed, and this is one of the
    suggestion buttons it offers.
12. Cura, "Can I take CC-ACCTG21 and IT-OOPROG21 together": said they clash (default sections 2A/2A) and to ask the
    adviser, but did not say that taking ACCTG in section 2B avoids the clash.
13. Cura, "Which subjects have no schedule conflict if I pick the right sections": says it has no tool for this
    and mentions "the scheduleConflicts data", an internal name. A clash-free-combination tool would answer it.
14. Cura, "Can I skip PE 103 and still graduate on time": refuses to speculate. A useful answer is available from
    the engine (PE 103 is the prerequisite of PE 104; what moves later, how the units shift).

## Fix log
- Finding 7 (temporary password never enforced): FIXED 2026-10-04. db/057 + shared/js/forcepasswordchange.js, hooked
  into all five dashboards. Verified: signed-out callers are refused; a person sees and clears only their own flag;
  the box appears on load and its validation shows; after the student chose a password the flag cleared
  (9900001 false; 9900002-4 still true) and the box did not return on reload. Android sign-in with a temporary
  password is not covered yet (the app has no equivalent screen).
- Findings 11 and 10 (Cura's unit-limit answer; Cura ignoring a pending request): FIXED and DEPLOYED 2026-10-04
  (eligibility-chat v9, assess-student v5). The summary now carries `unitLimit` / `graduating` and an `inReview`
  list; the plan table is drawn from what is still to submit; the phone's table follows the same rule.
  Verified live as the Old student on the website: "How many units can I take" -> "up to 24 units this term"
  (then what it suggests); "What should I take next semester" -> says the plan is already submitted and
  with the adviser, no table. Tests: tests/cura-summary.test.mjs (6) and 3 in the Android ChatRepositoryTest.
  Still to check on the phone (needs a student sign-in there).
- Findings 8, 12, 13 (clashing suggested plan; Cura could not combine sections): FIXED and DEPLOYED 2026-10-04
  (eligibility-chat v12, assess-student v7). `shared/engine/preferences.js` now plans sections: an exact search
  for the best clash-free mix (retakes first, then units, then what a subject unlocks; the preferred time breaks
  ties). Subjects with no section that fits beside the plan go to `plan.leftOutForClash`, each with what blocks it,
  the single swaps that would make room, and a per-subject "can it be taken together" answer. The website's plan page
  and "Select all suggested" use the planned sections; Cura reports the planner's answers instead of reasoning.
  Verified live (Old student): dashboard 14 of 24 units, 5 subjects, 3 left out with reasons; Build your plan
  "Select all suggested" gives 0 clashes; Cura: "You can take them together if you take CC-ACCTG21 in section
  BSIT-2B, but you would have to drop IT-SAD21 from your plan first."
  Tests: preferences (32) and cura-summary (8); full website suite 448. Not yet checked on the phone.
  Still open from this round: 9 (server accepts a clashing plan), 14 (Cura on "skip a subject").
- Schedule table in Cura (asked 2026-10-04): BUILT and DEPLOYED (db/058 applied; eligibility-chat v13). Cura returns
  `showScheduleTable` for "what's my schedule / when do these meet"; the app draws Code | Section | When (lecture and
  lab on separate lines) plus "Not in your plan: X (clashes with ...)", from shared/js/scheduletable.js (website) and
  ChatRepository.scheduleFrom / ChatAdapter (phone). The conversation saves only the flag; the table is rebuilt from the
  current plan when the chat is reopened. Verified live as the Old student: asked "What's my schedule?" and got the table
  (5 rows, the 3 left-out subjects named); after a reload the table was drawn again from history.
  Tests: scheduletable (6) and 6 new in the Android ChatRepositoryTest. Phone not yet checked on a device.
- Alternative schedules (asked 2026-10-04): BUILT and DEPLOYED (db/059 applied; eligibility-chat v14, assess-student v8).
  The planner offers up to four extra clash-free plans: "Morning/Afternoon/Evening classes" (same subjects, other sections,
  only when that changes something) and "Include X" for the first subjects that did not fit; each says what changes
  versus the current plan. Cura offers them by name; picking one draws that plan's table with a heading. The saved
  conversation keeps only the label (ai_chat_message.schedule_option); a label that no longer exists shows no table.
  Verified live (Old student): "Can you suggest another schedule option?" -> Cura named the Morning and Include
  options; "Show me the one that includes CC-DIGILOG21" -> "Include CC-DIGILOG21: CC-DIGILOG21 is added; PE 103 moves
  to section BSIT-2B; IT-SAD21 is left out", with a five-row table, checked by hand to have no overlaps.
  Tests: planner (alternatives, 4), scheduletable (5 more), Android ChatRepositoryTest (4 more). Phone not checked on a device.
