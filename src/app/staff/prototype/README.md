# Approved mobile teaching prototype A

Implementation planning resumed on 25 October 2026 against commit `733178e` in draft PR #56. The canonical integration plan and current code-to-requirement mapping now live in [GitHub issue #57](https://github.com/Bromley-Emergency-Courses/betar-lms/issues/57); the first real-data, read-only slice is [issue #58](https://github.com/Bromley-Emergency-Courses/betar-lms/issues/58). The student-profile result interface is available locally, so that dependency no longer blocks development. The notes below remain the prototype's design history; use #57 for current implementation gaps, existing teaching/attendance interfaces, rollout authority and unresolved write-policy distinctions. The local prototype remains fictional, untracked and excluded from PR #56's committed release.

Variant A was selected on 22 October 2026. Requirements were corrected on 23 October 2026. This document replaces the previous two-presentations-per-module proposal.

**One presentation per Module Enrolment, potentially two across different modules in a term. Multiple staff can independently score the same presentation.**

The prototype is fictional and in-memory. The production integration described below is planned, not implemented.

## Run and review

Use the existing local preview: http://127.0.0.1:3100/staff?variant=A.

If no development server is running, use **npm run staff:prototype** and http://localhost:3101/staff?variant=A. Run only one Next development server per checkout. Normal staff authentication applies.

A is now the selected phone surface; the previous mobile B/C comparison controls are removed. Legacy B/C query links also render A unless the tablet study is explicitly enabled with `tablet=1`. The normal /staff workflow without a variant parameter is unchanged.

Try:

1. **By module:** term attendance actual/required, one presentation tick and formative count.
2. **All students · dates:** student rows, teaching-date columns, horizontally scrollable dates and sticky student names.
3. Amara has VA and EC presentations on **8 October**, with two assessors on VA. Her term total is **2/2**, not 3/2.
4. Expand her VA presentation to inspect both assessors' full rubrics. Edit Alan's submission in the popup; Nina's remains read-only.
5. Try adding another VA score as Alan: the duplicate message opens his existing submission.
6. Switch the preview staff account under “Prototype assumptions & current state” to check the inverse author permissions.
7. Filter profile attendance by term. Dates have no module attribution; planned dates are blue and explicitly labelled.
8. Plan a date, change a presentation plan or cancel a future attendance expectation. Two modules can present on the same date.
9. Expand an encounter to see staff, module, concern (including None), date and comment.

Changes reset on reload. Native dialogs trap focus, support Escape and restore focus. No aggregate assessor score is invented.

## Tablet study — 24 October 2026

Question: how should the approved phone workflow use tablet space without becoming a separate application or changing the data model? Three structural variants on the same `/staff` route, selected with `tablet=1&variant=A|B|C`. This is a throwaway comparison, not a selected production design.

| Variant | Local preview | Design trade-off |
| --- | --- | --- |
| A · Roomier register | http://127.0.0.1:3100/staff?tablet=1&variant=A | Familiar register and navigation; profile uses two columns for teaching records alongside attendance. Least conceptual change; changing students still needs navigation or the selector. |
| B · Split workspace | http://127.0.0.1:3100/staff?tablet=1&variant=B | Register remains beside the selected student and teaching-entry workspace at 1000px and above. Faster student-to-student work; less room for long rubrics and date matrices. |
| C · Term board + drawer | http://127.0.0.1:3100/staff?tablet=1&variant=C | Starts with the term matrix; tapping a student opens a right-hand detail drawer. Good for session planning and comparing dates; the modal drawer covers some dates while open. |

Use the floating comparison arrows, or left/right keys outside interactive controls. The URL preserves the chosen option. Changing layout retains saved in-memory records and plans, but discards unsaved form drafts, as does changing student/module. The expandable state inspector includes the layout and tablet flag. A fresh URL opens each variant's starting view, not the last student or subview.

Tablet-only refinements:

- At 768px and above, use the available width, with bounded reading widths rather than stretched phone content. Move teaching navigation into the header and group overview controls into two columns.
- At 1000px and above, B retains a sticky, independently scrollable register alongside the workspace. Remove the redundant profile student selector and back link in that layout. In portrait/narrow windows, return to one workspace at a time, with Overview available in navigation rather than squeezing two panes.
- Expand score popups to a maximum of 720px, placing criteria beside their 1–5 score buttons. Retain 44px score targets, native dialog focus handling and author-only editing. The narrower split-view entry form keeps vertically stacked criteria.
- Keep student names and date headers pinned within the scrollable term matrix. Horizontal overflow stays inside the matrix, never the page. Full sample-term dates fit in landscape; portrait can scroll.
- Keep All / Here today / At risk, current-presence highlights, two distinct module presentations on one day, term attendance and active-enrolment guards unchanged. Colours remain accompanied by explicit text and symbols.

Recommendation to validate with staff: keep A as the simple portrait baseline, offer B's persistent register for landscape teaching work, and retain C's wide term board for planning. These can be responsive views of the same workflow, not separate tablet data, routes, permissions or persistence. B's filter controls still consume substantial vertical space; a real-device review should assess whether a collapsible filter area improves roster scanning. A longer real calendar will still need horizontal scrolling in any layout.

Browser review uses Chromium at 768×1024, 820×1180, 1024×768 and 1180×820, plus narrow phone fallback. This checks layout and interaction, not physical iPad/Safari behaviour or the on-screen keyboard. Before production, validate those on real tablets, especially landscape keyboard space, long rosters and long comments. Production must also handle unsaved drafts deliberately rather than copying the prototype's reset behaviour.

Validation: TypeScript and targeted ESLint pass. Browser checks found no page overflow or runtime errors and no mutation requests. Checked presence/risk filters, inactive enrolments and closed-term locks, eligible module planning, saved plans surviving variant changes, two presentations on one date, own-score editing, 44px rubric buttons, dialog arrow-key isolation, portrait navigation and the unchanged 320px/390px phone preview.

No database tables, mutations, permissions or production read projections are changed by this study. It reuses the existing fictional prototype state and eligibility functions; the existing integration plan below remains authoritative. The study is development-only and the original phone preview URL remains unchanged.

## Confirmed rules

### Manual presentation time penalty — 24 October 2026

Repository review found **no presentation time-limit threshold, deduction formula or penalty field** in the existing application, migrations or checked-in specifications. This is a source-code finding, not verification of a deployed database or an external assessment policy. Existing evidence:

- `src/lib/presentation-rubric.ts`: ten rubric criteria, each scored 1–5; no timing deduction criterion.
- `src/lib/admin-actions.ts`, `createPresentationScore`: validates positive integer duration and computes `total_score` as the sum of the rubric scores, without any duration-dependent adjustment.
- `src/app/staff/staff-workflow.tsx`: records duration, type, rubric and comments; no penalty entry.
- `supabase/migrations/0001_betar_lms_schema.sql` and `0011_presentation_score_details.sql`: duration and score storage, but no time-limit or deduction field.
- `src/lib/types.ts`, `PresentationScore`, and `src/lib/lms-data.ts`: duration, rubric and total only. `docs/staff-user-guide.md` describes presentation scoring without a timing rule.

The requested fallback is therefore modelled as a **manual points deduction**, separate from the unchanged rubric. No threshold, points-per-minute formula, percentage deduction or new pass/fail criterion is invented. Staff decide whether a time penalty applies using the applicable assessment policy; duration alone never applies one automatically.

Prototype policy choices to confirm before production:

- Default to 0 points. Use whole points from 0 through the rubric subtotal, consistent with the existing integer score storage. Reject blank, negative, fractional and excessive deductions rather than silently clamping the final score. A full-rubric deduction may produce 0/50.
- Final score = rubric subtotal − time penalty. Show all three values both during entry/editing and in each assessor's historical breakdown. Preserve each original criterion score.
- Treat the deduction as part of the assessor's own submission, not shared presentation metadata. Only that author may edit it, while the enrolment and term remain eligible for teaching. One assessor's change cannot change another's score. A shared/event-wide penalty would require a separate policy decision.
- Use a numeric keypad-compatible field with 52px decrement/increment buttons. Saving requires all rubric criteria and a valid deduction. A lowered rubric subtotal that makes the deduction excessive must be corrected before saving.

Production integration requirement (planned, not implemented): extend the existing `presentation_scores` row with a narrowly scoped integer `time_penalty_points` field, defaulting to 0, rather than a new score table or pseudo-rubric criterion. Reuse `total_score` as the final score; derive the raw subtotal from the recognised rubric criteria instead of introducing another independently mutable total. Update the existing score type/read mapper, both desktop and companion forms, author edit path, relevant exports and any total-score consumers together. Compute and validate the deduction/final score on the server and database write boundary, not from client-supplied totals. Validate recognised rubric keys; never sum a penalty into the rubric JSON.

Preserve original IDs, rubric values and existing historical totals when introducing the zero-default field. Preflight legacy missing/partial rubrics and totals that differ from the current ten-criterion sum; do not silently recalculate or “repair” these during migration. Keep their recorded final score visible and mark missing rubric details as unavailable. Record before/after deduction and final score in the existing audit path, retaining author ownership, active-teaching checks, submission uniqueness and stale-edit protection. Presentation completion/counting remains evidence-based, not dependent on the numeric final score.

Release checks: zero and non-zero penalty; all points deducted; blank/negative/fractional/over-subtotal rejection; recalculation after rubric changes; saved breakdown and edit round-trip; unchanged second assessor; historical totals and absent rubric preservation; author/inactive-enrolment restrictions; parity across phone/tablet/desktop. The prototype does not modify production scoring or apply a database migration.

### Multi-term module enrolments — 24 October 2026

The profile and tablet detail drawer now show **all of the student's module enrolments grouped by original teaching term**, active first, then historical terms. Each group shows the term name and Active/Closed state; each row shows its enrolment status and presentation evidence scoped to that specific student/module/term. Only eligible active rows have a teaching-input action. Completed/deferred rows in an active term and all rows in closed terms remain readable but non-interactive for teaching entry.

The profile's **Teaching context** selector scopes upcoming plans and general Add record actions; it does not hide historical enrolments. Selecting an eligible module row explicitly selects that row's term/module before opening entry, even if a historical term was previously selected. Attendance retains its independent term filter. Timeline records now show the original term as well as date, module and author, avoiding ambiguity when a module recurs.

Examples: Priya studies VA and LU in Autumn 2026, with a passed EC enrolment in Spring 2026; Amara studies VA and EC with historical LU. Oliver deliberately has VA in both terms to model a separate repeat-teaching enrolment. His Spring score must never satisfy, block or receive edits intended for his Autumn enrolment. This is not an assessment-only resit, which stays attached to its original Module Enrolment.

Production must group existing `enrolments → module_offerings → terms` records, retain stable enrolment IDs and use the existing lifecycle/eligibility projection. No duplicate “historical enrolments” table or date-based eligibility rule is needed. The demo has two terms; production should load older groups on demand for long histories while preserving term ownership and read-only controls.

### Active teaching and presence refinement — 23 October 2026

Both overview modes restore **All / Here today / At risk** filters and green highlighting for students currently checked in. Presence requires a check-in on today's session in the selected term and no checkout. Expected/planned attendance, past attendance and a student who checked out earlier today must not imply current presence. Search and filters combine with the selected term/module. The prototype fixes today at 23 October 2026 and adds a demo session on that date; production uses the teaching timezone and existing reception records. At risk currently demonstrates the existing prototype's academic concerns and explicitly labelled attendance planning gaps; production must use the shared approved risk/read projections.

All ordinary staff writes require an **actively studied module enrolment in an active term**, as well as an active module and the existing user permissions. The same rule applies to adding or editing teaching records, editing one's own presentation score, adding/moving/cancelling presentation plans and adding/moving/cancelling expected attendance. Attendance is term-wide, so it requires at least one eligible enrolment in that term rather than an arbitrary module field.

Historical, passed, deferred, abandoned and otherwise non-active enrolments remain visible but read-only. A presentation being complete does not itself close an otherwise active teaching enrolment: another assessor may still score that existing presentation, or its author edit their submission, while the enrolment remains active. Author ownership is necessary but no longer sufficient for editing; active teaching eligibility is also required. Module enrolment rows open entry only when eligible. Entry selectors contain eligible modules only; with none, entry/planning is unavailable and the profile explains why.

Centralise this eligibility check for desktop and mobile. Map the existing legacy/live enrolment and term states to actual active teaching participation; do not infer eligibility merely from a module being in the catalogue or a term date being current. Recheck eligibility transactionally at every server/database mutation, including edit and cancellation, so a form opened before term closure cannot submit afterwards. Do not create new lifecycle statuses or allow old desktop actions/direct API calls to bypass the gate. Exceptional historical corrections, if ever needed, require a separate explicitly authorised workflow and are not included in normal staff controls.

Amara's screenshot showed no available module because both required presentations were complete. The eligibility decision was correct, but displaying an empty dropdown was a prototype usability bug. The revised popup instead explains that no presentation can be scheduled and offers **Plan attendance instead**. Attendance needs no module selection. A student with outstanding presentations sees only eligible active modules; if no enrolment is eligible the planning control is unavailable. Date creation remains admin-only. No-dates and no-presentation cases must have distinct, useful explanations in production.

Prototype review examples: Amara is here now and has completed both presentations; James checked out and still has LU to present; Priya is expected today but not checked in. Daniel's VA is active while EC is complete; Mei has no active enrolments; Grace is deferred. Spring 2026 is closed. Check creation, amendment, cancellation and author editing against each case. Future attendance now has an explicit **Change** action that replaces just the selected expectation, preserving actual attendance and unrelated presentation plans.

Additional release checks: presence filters in both overview modes; no empty module dropdown; completed/inactive/closed-term entry rejection; author edits blocked after teaching becomes inactive; stale forms rejected after lifecycle changes; allowed active enrolments still work; future expectations can be changed without losing other records.

- One presentation per student/module enrolment when required; either presentation type counts.
- Retain the offering's presentation_required boolean and nullable enrolment override. **Do not introduce 0–2 requirement fields or migrate existing booleans to counts.**
- Derive the term requirement from applicable module enrolments: two requiring presentation means two in total.
- Multiple assessors can submit scores for that same presentation, once per assessor.
- A duplicate submission by the same assessor must direct them to edit their original.
- Only the score creator can edit it while its module enrolment is actively studied in an active term, including restrictions on other administrators during normal operation.
- Two modules can be presented on one date. Date is not a uniqueness key.
- Attendance uses the existing term requirement, partial-day, distinct-date and carry-over rules.
- Teachers plan against existing calendar sessions; admins control the calendar.
- Plans never count as completed evidence. Assessor submissions never count as additional presentations.

## Existing sources to preserve

| Information | Existing owner | Use |
| --- | --- | --- |
| Identity | students / existing photo access | Reuse authorised identity and photo reads |
| Ownership | enrolments → module_offerings | Scope to the original student/module/term enrolment |
| Calendar | attendance_sessions | Reuse admin-managed sessions |
| Attendance plans | expected_attendance | Reuse student/session expectations |
| Actual attendance | attendance_records | Preserve actual status and check-in/out evidence |
| Assessor submissions | presentation_scores | Preserve IDs, author, rubric and feedback |
| Formative work | assessment_attempts + assessment_definitions | Use configured skills and score ranges |
| Encounters | encounter_logs | Join staff and module names |
| Outcomes | Existing rules / src/lib/assessment according to rollout mode | Preserve authority, deadlines, overrides and credits |
| Audit | audit_events and existing outcome history | Record planning and score edits |

Formative assessment_attempts remains distinct from formal module_assessment_attempts. Presentation scheduling must not be forced into module_assessment_arrangements, which models Theory/Practical resits and deferrals.

## Interface

### Module register

Keep A's module tabs and compact student rows. Attendance is the term-wide attended/required fraction. Presentation is a tick, pending state, or N/A when not required. Another assessor scoring the presentation does not change the tick.

Attendance planning can additionally show remaining days and planned dates. “More dates needed” is operational information, separate from formal Current Academic Risk. Outstanding requirements before their deadline must not automatically invent an academic failure.

### Overall term register

Add “All students · dates” within Overview, without another bottom navigation destination.

- Select a term; include students across all relevant modules.
- Student rows show actual/required attendance and distinct completed/required presentations.
- Teaching dates form columns. Student identity stays fixed during horizontal scrolling.
- Attendance uses text, symbols and colour for attended, partial, missed, planned and no record.
- Presentation markers include the module and whether it was presented or is planned. Show both modules when on the same date.
- Multiple assessors collapse into one presentation marker. A cell opens details and links to the student.
- An elapsed expectation without actual evidence means “Expected · not recorded”, not automatically “Missed”.
- Multiple sessions on one date follow the existing distinct-day rule. Expose mixed statuses and all session detail rather than hiding them under one misleading badge.

The prototype has one session per date; multi-session aggregation needs production acceptance coverage.

### Student profile and teaching records

Filter attendance by **term**, displaying dates without module attribution. Show actual/required totals and visibly distinct planned dates. Historical terms use their own requirements and applicable carry-over policy.

Retain the screenshot's expandable teaching-record style. Group presentation submissions under one event. Each assessor's section includes name, total, all criteria and scores, feedback and an author-only edit action. The popup preloads the full rubric.

Encounters show staff name, module code and full name, concern level including None, date and comment. These are existing stored fields; this needs a joined read/display change rather than another table.

## Shared presentation identity

A presentation and its assessor submissions are different records. The prior proposal's unique plan-to-score link is superseded because one presentation may have many scores.

Propose one narrow **student_presentations** table (name provisional), replacing the earlier presentation_plans proposal:

- One row per enrolment_id, enforced by uniqueness.
- Optional planned session_id referencing the existing calendar.
- Actual date, presentation type and duration when delivered.
- Scheduling/cancellation metadata, staff attribution and conflict-detection revision.
- A cancelled plan does not cancel an already delivered presentation.
- Passing the planned date never establishes completion by itself.

Planned session date and actual presentation date are distinct facts. Student/module/original term derive through the enrolment. Event metadata belongs to the shared presentation; assessor-specific rubric, manual time penalty and feedback stay in presentation_scores.

Add a presentation foreign key to each existing score. Enforce uniqueness on presentation/author, equivalent to student/offering/staff. Keep legacy student/offering fields during compatibility but enforce matching ownership; they must not become competing sources.

Do not enforce one score per student/module code for life: repeating teaching produces a different Module Enrolment. Within an enrolment, changing dates or presentation type cannot bypass the one-submission rule.

Completion remains based on accepted evidence once per event. No automatic averaging, “best assessor” selection or new formal assessment result is implied.

### Recording and editing

Both desktop and mobile forms must share these operations:

1. Resolve the Module Enrolment and its single presentation.
2. If this staff member already submitted, return that submission with an edit-existing message.
3. If another staff member scored it, reuse the established event metadata and accept this assessor's rubric, manual time penalty and feedback.
4. For a first score, establish actual metadata and save the score atomically, including completion of an existing plan.
5. Database uniqueness and locks handle simultaneous first assessors; retries are idempotent. Conflicting shared dates/types must be rejected for review, not silently overwritten.
6. Editing updates the original score row, recomputes the final total from validated rubric criteria minus the validated manual time penalty, and audits before/after values. It never creates another event/submission.
7. Expected revision rejects stale edits from two browser tabs.
8. Derive author identity from the authenticated session. Enforce author-only updates and immutable ownership in both server operations and database policies.
   Recheck active teaching eligibility for the target enrolment/term inside the same transaction; the author's historical records are read-only too.
9. Audit and replace the existing blanket admin-update policy where it conflicts with creator-only editing. Hiding buttons is insufficient.
10. Shared date/module corrections affect everyone and require a separate audited correction path. An assessor editing feedback must not move other assessors' presentation.

Existing rows without a full rubric should display “Not recorded”, never fabricated criteria. Scores remain within the existing 1–5 rubric range; totals are computed server-side.

### Legacy reconciliation

Current presentation_scores rows combine event metadata with assessor submissions. A read-only preflight must identify:

- Multiple staff assessing the same event.
- Repeated rows from the same staff member.
- Conflicting date/type/duration values.
- Missing enrolment ownership or future-dated completed evidence.

Backfill one shared event for consistent evidence groups and retain every original score ID/payload. Do not infer presentation count from row count, automatically discard duplicate authors or choose a canonical date arbitrarily. Ambiguous groups require an audited reconciliation decision before uniqueness enforcement. Preserve legacy evidence/history when resolving duplicate author submissions.

The boolean requirement and existence-based completion rules remain appropriate. Term totals count distinct applicable enrolments, not assessor rows. Preserve existing carried evidence and overrides without double-counting authors.

## Planning integration

Use expected_attendance directly. Add narrow teacher-authorised operations to add/remove/move one student/session expectation. Do not reuse the existing whole-session delete-and-replace helper for one student's plan. Moving an expectation and auditing it must be atomic. Protect against stale admin bulk edits overwriting newer plans.

Teacher planning cannot delete recorded actual attendance. Reception/admin controls retain their existing attendance-correction responsibilities.

Presentation planning sets the shared presentation's planned session and module enrolment. Available dates come from the existing calendar; no free-text date should silently manufacture a session.

Offer “Also plan attendance”. Changing/cancelling one module's presentation must not automatically remove attendance: the student may still attend for another module or present twice that day. Attendance changes are explicit independent actions.

Two module presentations may use the same session; multiple assessors of one presentation share one event and plan. No unique student/date constraint is appropriate.

Calendar changes must expose affected plans. Avoid cascade deletion of presentations/scores when a session is removed; require retention or explicit audited reconciliation. Cross-term make-up scheduling remains a policy to verify: retain original enrolment ownership rather than invent an assessment-only duplicate enrolment.

## Application and permission boundaries

- Keep /staff authentication and existing server-side permissions. Rewrite the approved layout as production code; do not promote demo state/calculations unchanged.
- Add a small server-only teaching read projection over existing sources, scoped to term/student and paginated. Do not send all AppData, finance or admissions data to the phone.
- Reuse teaching action entry points, strengthening enrolment ownership and module/definition validation. Use database constraints/RPCs for atomic event, score and scheduling operations.
- Teachers gain scoped planning and editing their own presentation scores, not calendar, requirement, actual-attendance, finance or formal exam administration.
- Read access to authorised teaching records is separate from author-only editing.
- Keep existing presentation-score recalculation hooks and use the existing risk/credit evaluator. Do not add a mobile-specific evaluator.
- Honour off/shadow/live assessment authority; enabling the mobile surface must not trigger assessment cutover.
- Invalidate Staff, student profiles, Attendance/Reception and relevant outcome/risk views after changes. Reception currently omits /staff invalidation; include it.
- Refresh the visible register on focus and through scoped periodic polling, showing stale/failed refresh state. Use a consistent teaching timezone.
- Retain drafts after validation/network errors and guard navigation that discards them. Prototype draft reset is not approved production behaviour.

## Delivery sequence

1. Review corrected A: term matrix, presentation ticks, assessor breakdown/edit popup, duplicate-to-edit flow, term attendance and encounter metadata.
2. Inspect actual deployment migration state and assessment mode read-only; workspace files do not establish deployed state.
3. Reconcile legacy event/assessor evidence. Keep boolean requirements; prepare new additive event/link/uniqueness/audit/permission migrations, never edits to already-applied migrations.
4. Connect read-only real data; reconcile term/module counts and histories with existing screens.
5. Connect shared desktop/mobile recording and author editing, including atomic first scores, independent additional assessors, retries and stale revisions.
6. Connect scheduling and refresh, preserving actual-versus-planned distinctions.
7. Rehearse locally with synthetic data, then pilot a limited staff/module group behind a separate mobile flag.

Acceptance cases:

- One presentation scored by two staff counts once; two modules on one date count twice.
- Same-author duplicates fail through double taps, retries, alternate UI, changed dates and direct API calls.
- Independent assessors can submit concurrently without duplicate events; conflicting shared metadata is explicit.
- Only the creator can edit, including restrictions on other admins; edits preserve other submissions and audit history.
- Full rubric, totals, staff, module, concern and comments are accurate and visible.
- Term attendance requirements, partial days, carry-over and distinct-date counting match existing rules. Plans never inflate actual attendance.
- Multi-session dates, repeat enrolments and historical terms reconcile across matrix/profile.
- Changing one presentation plan cannot lose unrelated attendance or another module's presentation.
- Baseline boolean requirements remain unchanged; obsolete numeric-count migrations are not applied.
- No aggregate assessor score is introduced without a separate decision.
- Forged student/enrolment/author/event/definition IDs are rejected, including direct authenticated API requests.
- 320px layout, sticky-name date scrolling, complete histories, dialog focus/Escape, retained drafts and explicit offline save failures.

Rollback can disable the mobile interface while retaining shared evidence. Desktop writers must remain compatible with the new uniqueness and author policies; reverting to an old UI must not restore duplicate submissions or unrestricted editing. Keep migrations additive and rehearse rollback without dropping new history.

## Prototype boundaries

All people and records are fictional. Author-only editing is a UI/state simulation, not production security. Required attendance is illustrative (4 or 5 days in the current term); production must use the existing rule. Partial attendance counts as a day, matching current LMS semantics. Planning warnings are not a new academic-risk algorithm.

Presentation rubric uses the existing ten criteria; formative definitions remain illustrative. No production migrations, grants, emails, live records or persistent writes are changed. No commits, branch changes or tracker updates are part of this refinement.
