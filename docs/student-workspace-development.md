# Student workspace development

## Consolidated local engineering acceptance — 2026-10-25

The working agreement is to continue local implementation/testing without asking after each passing checkpoint, and batch hands-on acceptance into the final development review. Real-data access, commits/PR/merge and production rollout remain separately authorized.

Additional implementation and regression coverage:

- Course owns both new plan versions and reviewed inherited-plan changes. The legacy student-profile migration editor is removed. Course previews show effective/calculated outcomes, credits, warning flags and retained attempts without raw audit JSON; incompatible accepted items block application. Selecting a different version invalidates the displayed preview, stale saves are rejected, and the failed-save reason remains visible.
- Course scope was narrowed following the user's 2026-10-25 clarification: preserve the existing overview, visible module/term editors and all term-grouped offerings. The only added module control is collapsed Exam rules in edit mode, with inherited-plan review under Advanced: existing enrolments. No separate plan list is placed above normal Course content and no offering-term selector is added. Closed offering groups mount their editors on first opening and retain drafts after collapsing, avoiding unnecessary browser work without changing the familiar grouping. Narrow plan-review layouts wrap long identifiers without horizontal overflow.
- `scripts/course-assessment-smoke.mjs` covers immutable future versions, inherited historical thresholds, reviewed single-enrolment adoption, concurrent edits, incompatible evidence, actual CSV routes and teacher restrictions. It accepts Chromium, Firefox or WebKit as the optional final argument.
- The specialist suite reruns 65 browser/database groups: assessment actions 20, attendance 7, teaching 8, enrolment 7, cancellation 7, finance 9 and creation 7. This includes shared/specialist parity, role boundaries and independent records, not just the compact student overview.
- `scripts/student-recovery-smoke.mjs` passes seven real-service recovery groups: no-write request loss; committed student retry with one audit; private upload rejection; database photo-save rejection and cleanup; cleanup failure; committed photo response loss with protected retry; and separate-key private-byte restoration. Evidence: `.context/student-recovery-review/86a5df46-eeb7-49da-93de-0920fcd3ab96/`.
- The current migration rehearsal builds all repository migrations, covers seven legacy statuses, conservatively backfills three of seven legacy results, retains duplicate/ambiguous cases, verifies retries and real PostgreSQL concurrency, and compares a separate SQL backup restoration. It preserves the existing review stack. Current evidence is selected by `.context/assessment-rehearsal/latest.json`.
- With the user's explicit authorization, the separate synthetic live-mode stack passes six application/SQL groups: off mode, shadow/official-export separation, missing sign-off and workspace-flag independence, live official history and legacy-write guards, browser correction/pass reversal and later resit, and rollback preserving live-only evidence. Evidence: `.context/assessment-live-review/a633c583-07cc-48e9-9458-9bd7e42aceca/`. It is back in shadow and stopped with volumes retained.
- The real authenticated API exposed a cutover defect missed by database-owner SQL: safe-update protection rejected the unfiltered rollout update. Migration `0072` scopes the existing command to its singleton row, preserving authorization, sign-off requirements, audit and rollback. Safe-update protection is not disabled.

The final unit/integration run passes 602 tests across 55 files; the guarded shadow production build, lint and local target/browser-selector guards also pass. Core and Course browser manifests are recorded separately so their coverage is not confused with the earlier specialist counts. Read `results.json` for the actual engine/group list, not just a `latest.json` filename.

The subsequent familiar-Course refinement passes 607 tests across 56 files, including unchanged overview/feature-off behaviour, Course permission checks, visible module/term fields and deferred offering groups. The Course browser harness additionally checks that historical offerings remain accessible, offering and exam-rule drafts survive collapse/reopen, and existing-enrolment review is hidden under Advanced. Its six groups pass on each engine: Chromium `.context/course-assessment-review/e786177d-329b-49be-992f-0d3103db0ef1/`, Firefox `.context/course-assessment-review/a9c01437-de0b-4e98-b664-520d36a08979/`, WebKit `.context/course-assessment-review/13a35703-0e85-41c7-86ed-35a66d9b2ec4/`. This supersedes the earlier Course layout evidence, not the unchanged student-workspace acceptance.

Final browser evidence: the complete 99-group core rerun is `.context/student-cross-browser-review/ab6539d2-7503-4ee2-891f-2e43d8e40394/results.json`. Course passes six groups per engine (18 total): Chromium `.context/course-assessment-review/42ad38f4-8c68-4c8d-b203-b9ab1dee0d49/`, Firefox `.context/course-assessment-review/b3a6d061-d6df-4c97-9ac9-c09ceaec7096/`, WebKit `.context/course-assessment-review/c98cc098-1239-4c16-abf6-5385fd9c61d6/`. Combined with the 65 specialist, seven recovery and six live-mode groups above, this engineering pass records 195 browser/service groups, not 195 distinct business workflows. Final migration/restore evidence: `.context/assessment-rehearsal/assessment_rehearsal_49_1792923806766/`, through `0072`. Both local database modes were verified as shadow; no recovery fault triggers remain in the review database.

See [recovery and private-photo operations](student-workspace-recovery.md) for request-loss handling, the read-only retention inventory, backup limitations, exact local targets and rollback stop conditions. No automatic orphan deletion or production retention period is introduced. A SQL dump is not an image-byte backup, and synthetic restoration is not production recovery sign-off.

The next hands-on checkpoint is final development acceptance: review the Course plan/version workflow and a connected student journey in the browsers/devices staff actually use. All deployed-data reconciliation, production plan reviews, retention decisions, PR/main permissions and live cutover approvals remain in the [release checklist](student-workspace-release-checkpoints.md).

For the ordered checkpoints from this development build through main, real-data reconciliation, pilot and live cutover, see [Release checkpoints](student-workspace-release-checkpoints.md). Local acceptance, main merge and production rollout are separate approval gates.

## Current checkpoint

The integrated student workspace is behind `STUDENT_WORKSPACE_ENABLED=true` and requires the assessment workflow to be enabled. This checkpoint connects saved records to the selected split-rail layout, shared assessment table/board and complete attempt/revision history. It does not import the prototype component or its in-memory example data.

The workspace now supports **administrator assessment actions**: independent outcome/credit/warning decisions and individual clears; initial Manual results and resits; current Manual and imported-result corrections; reasoned result exclusion/restoration; arrange/cancel resits; postpone/clear assessment postponements. Both the student and cross-student views use the same task dialogs and command boundary. Saved decisions include readable actor/date/reason history. Failed or stale saves retain input; closing a dirty editor offers Keep editing / Discard changes, and browser Back/reload are guarded.

New Manual attempts inherit their course-plan pass marks. Corrections preserve the existing threshold, date, term and attempt identity. Earlier attempts with later active attempts require dependent-result review and cannot be corrected in this checkpoint. Imported thresholds remain immutable source evidence.

`Correct result` on accepted imported evidence saves a linked Manual replacement in one transaction using `CorrectImportedAttempt`. It locks/checks the source and enrolment revisions, requires an administrator/reason, fixes ownership/component/sitting, preserves the recorded threshold and validates items against the inherited plan. It recalculates once and reports the net outcome/credit change, without an intermediate unmatch. Invalid/stale/conflicting saves leave the import accepted and retain the draft. Unresolved source conflicts require reconciliation rather than being silently overridden. The correction dialog and history show readable, immutable source versions alongside accepted score revisions; raw import payloads are not passed to the browser. Subsequent source refreshes cannot overwrite the Manual replacement. No matching/search/reassignment controls are introduced.

`Result history` now provides secondary `Exclude result` and `Restore excluded result` tasks for Manual, imported and Manual-replacement results. Exclusion retains all evidence and records an immutable reason/actor/date event. Incorrect ownership leaves imported evidence Unmatched for later reconciliation; duplicates/invalid evidence becomes Voided. Restoration requires review of the exact exclusion and, for imported evidence, acknowledgement of the latest source version. It restores the original score/revision/identity, never a refreshed source score, and keeps automatic source overwrite disabled. Stale edits, later active attempts, conflicting earlier passes, changed carried evidence and incompatible plans block restoration. Independent overrides remain active. Excluded attempts are absent from assessment-backed accepted-attempt/CCCU exports; reconciliation and result history retain their evidence. Shadow mode does not change the separate legacy export projection.

Both lifecycle commands are atomic, administrator-only and revision-checked. Legacy generic source commands cannot bypass a source's new exclusion/restoration history. Older withdrawals without a recorded exclusion snapshot remain visible with a reconciliation explanation rather than offering an unsafe restore; no historical audit facts are invented.

`Add student / prospect` in the directory, `Edit student details`, photo management, enrolment management, attendance, teaching and individual finance tasks now open integrated dialogs. Specialist workspaces remain available for bulk and advanced operations through Other student tools and contextual links. Prototype URLs remain available for reference. Do not enable this checkpoint in production.

The new UI does not expose matching or assessment-plan editing. Migration 0058 also disables older public matching/reassignment and source-mutation commands, as detailed below. Hiding a control is not the authorization boundary; the new imported correction and lifecycle commands independently enforce fixed ownership in PostgreSQL. Reintroducing matching requires a separate scope decision.

## Isolated Docker target

Only the synthetic `assessment-yangon-49` project is authorized here:

- API: `http://127.0.0.1:56321`
- Database: `127.0.0.1:56322/postgres`
- Database container: `supabase_db_assessment-yangon-49`
- Application: `http://127.0.0.1:3100` (optional port `3102`)

The launcher validates the checked-in project identity and ports before Docker operations, then validates the running stack's API and database addresses. It never falls back to a remote database. It overrides inherited application credentials with this stack's local credentials and disables external Portal integrations and admissions email.

Prerequisites: Node/npm, Docker, Supabase CLI. Run from the repository root:

```sh
npm ci
npm run assessment:local -- check
npm run assessment:local -- start
npm run assessment:local -- migrate
npm run assessment:local -- serve shadow 3100
```

`start` enables Storage and links the repository migrations into `dev/assessment/supabase/`. Existing Docker volumes are retained. It does not reset or reseed an existing database. Supabase applies the repository migrations when initializing a fresh local database. `migrate` checks the running target and applies pending repository migrations only to this local project. Migration 0055 adds the Manual-revision guards; 0056 adds atomic imported corrections; 0057 adds immutable exclusion/restoration events and commands; 0058 disables legacy manual matching/source mutations; 0059 adds the atomic student profile editor and revision guard. All have been applied locally after private backups, not in production.

Stop the application with Ctrl+C. Stop only this Docker project, retaining its volumes:

```sh
npm run assessment:local -- stop
```

Do not use the old private prototype launcher or the default rehearsal script as substitutes. Other local Supabase projects and production are outside this authorization.

## Modes and review routes

`shadow` keeps the existing legacy assessment projection authoritative outside this new assessment-backed preview. Shadow is not read-only: the connected assessment dialogs save into the isolated database. They do not overwrite the legacy assessment projection.

`serve live 3100` selects the application's live mode but **does not change the database rollout state**. Live reads require the existing database reconciliation/sign-off gate. Local live cutover, rollback and full workflow acceptance remain later-stage work.

- `/students`: existing directory capabilities, URL-preserved filters/sorting and assessment-backed credits/risk in the integrated preview.
- `/students/<student-id>`: saved student records, role-scoped finance and structured teaching/attendance sections.
- `/students/<student-id>?tab=modules`: shared assessment table/board and all saved attempts, including earlier failures and correction versions.
- `/assessments`: the same assessment views across students, including all teaching terms rather than only active terms. The Teaching term filter combines with outcome and search filters in both table and board views. It uses the original module-enrolment teaching term, not the latest resit's sitting term; later passes resolve the current failure without removing earlier attempts from history.
- `/students/<student-id>?view=legacy&mode=edit`: temporary administrator path for remaining specialist editing, also reachable through Other student tools. Student details and photo management now have integrated dialogs.

The default flag is off. The isolated launcher enables it explicitly. Production/main deployment is not part of this checkpoint.

Manual import matching, cross-student identity overrides/reassignment and legacy source mutation controls are unavailable, including on legacy administrator pages. Migration 0058 rejects `MatchSourceResult`, `UnmatchSourceResult`, `ReplaceSourceResult`, `VoidSourceResult` and `RestoreSourceResult` at the public command endpoint, even for administrators. Previous command helpers remain private. There is no UI toggle to bypass this restriction. Automatic ingestion/matching, immutable source evidence and unresolved pending imports remain intact. Existing accepted results use the guarded correction/exclusion/restoration tasks in Results history; an incorrect-ownership exclusion does not reassign the result. Older withdrawals without a recorded exclusion snapshot and unmatched imports still require a future reconciliation workflow, not a legacy restore/match bypass.

## Repeatable checks

```sh
npm run assessment:local:test
npm test -- --maxWorkers=2
npm run lint
npm run assessment:local -- build shadow
npx playwright install chromium
npm run student-workspace:smoke -- /path/to/private-local-login.json
```

The browser harness uses declared Playwright tooling and its installed Chromium, not a hard-coded macOS executable. It only reads fixture records; it can be rerun without altering attempts. The private JSON contains `adminEmail`, `teacherEmail`, `password`, and optionally `studentId`. If `studentId` is omitted it selects the original synthetic rehearsal student (`49000000-0000-4000-8000-000000000002`), never the lowest randomly generated student ID. Use only synthetic local accounts. Never commit credentials or browser authentication state. The selected student must have a PGCert enrolment, a recorded resit and a correction history.

### Cross-browser matrix

```sh
npx playwright install chromium firefox webkit
npm run student-workspace:browser:test
npm run student-workspace:cross-browser -- /path/to/private-local-login.json
```

The matrix runs the layout/history/navigation, profile, photo and connected multi-role journey harnesses serially on Firefox, WebKit and Chromium. Each engine runs 33 check groups; browser name and version are recorded with the result. It preflights the selected engine installations before running fixtures, stops at the first failure and records completed suites rather than reporting a partially green matrix as complete. Existing Docker target guards still run in every child harness. No resets, migration or rollout-state changes are part of this command.

The 2026-10-25 complete run passes all **99 groups** on Firefox 157.0, WebKit 27.2 and Chromium 156.0.8078.4. Evidence: `.context/student-cross-browser-review/1ea9806a-fe9c-4e17-a64e-9f05b9755699/results.json`. The same checkpoint passes **596 tests in 53 files**, three environment guards, two browser-selector tests, lint, guarded shadow build/TypeScript and diff checks. A competing test/browser run encountered test timeouts; the successful final pipeline runs tests with `--maxWorkers=1`, then build/lint, then the browser matrix serially without increasing timeouts.

For a single engine, append `firefox`, `webkit` or `chromium`. Those four individual smoke commands accept the same optional final engine argument and default to Chromium. Unknown names fail rather than falling back. Profile cases include a long student name on mobile, dirty-dialog Keep editing/Discard, focus restoration, browser Back and a real browser-owned reload warning. Photo cases use actual private Storage upload/replacement/removal and enlargement. The connected journey repeats administrator/teacher/reception saves and permission checks in each engine.

Matrix manifests and copied suite results live under `.context/student-cross-browser-review/<run-id>/`; screenshots and synthetic fixture records remain in the referenced suite directories. Read-only layout screenshots are separated by engine; Chromium retains its existing evidence path. `latest.json` points to the latest fully completed selected-engine run, which may be a single engine rather than all three. Review its `engines` and `groups`, not just its existence.

Playwright WebKit is engine-level coverage, **not certification of installed Safari or physical iOS devices**. Mobile checks use a narrow viewport, not a real touch-device/browser combination. Other dedicated specialist harnesses and operational storage-failure/live-rollout rehearsals remain separate acceptance gates.

Keyboard focus checks activate dialog triggers with the keyboard instead of assuming that a pointer click focuses buttons in every engine. The App menu explicitly focuses its trigger on activation so Escape works after a pointer click too. Dirty-dialog navigation retains early Navigation API cancellation in Chromium/Firefox. Apple-vendor WebKit uses the existing history-restoration handler for same-document Back/Forward: cancelling its Navigation API traversal could otherwise skip the intended destination on the next Back action. Applying that fallback to Chromium instead lost the draft, so the compatibility branch is deliberately scoped and covered by the three-engine profile checks; installed Safari/device acceptance remains separate. Reception timestamps use fixed punctuation and explicit London-time parts so server/client locale-formatting differences do not cause hydration errors. Photo and journey saves wait for their action and refresh responses to complete before forcing a reload/navigation; runtime-error assertions remain strict.

Profile fixtures include both long names and long, wide identifiers. Dialog-header text can shrink and wrap without pushing the close control beyond the viewport; document/dialog overflow assertions remain strict.

The read-only layout harness compares the UI against saved database attempts/revisions before and after reload, checks the shared register and board, directory filter return/clear, mobile identity/navigation/actions, dialog focus restoration and teacher access. Sanitized screenshots and a result summary go under `.context/student-workspace-review/`, with an engine subdirectory for Firefox/WebKit. It explicitly does not claim full workflow acceptance.

### Saved-workflow fixture and browser checks

```sh
npm run student-workspace:actions:smoke -- /path/to/private-local-login.json
```

This guarded script creates a **fresh synthetic student, term and five modules/enrolments on every run** inside the authorized project. It preserves existing review records rather than reseeding or resetting them. The private file supplies the existing synthetic administrator and teacher accounts. It tests MCQ, Coursework/Viva, weighted physics, independent Practical results, carried items, result corrections, independent decisions/clears, resit arrangements, postponements, stale saves and dirty-editor navigation through the real application. Imported-correction checks cover fixed fields, source-revision conflicts, retained drafts, net changes, source refresh protection, immutable history, teacher denial and mobile evidence. One imported failure is left ready for hands-on correction. Failure takes precedence over postponement, as specified; postponing a failed assessment does not erase its failure.

Each fixture and its screenshots/results are retained under `.context/student-workspace-actions/<run-id>/`; `.context/student-workspace-actions/latest.json` identifies the latest successful review URL. Navigation protection is browser-tested in Chromium; Safari/Firefox acceptance remains outstanding. This is an assessment-actions fixture, not yet the complete multi-role/profile/photo/attendance/finance acceptance fixture. It does not approve live cutover.

Lifecycle browser checks additionally exclude/restore Manual, imported and replacement results, verify accepted-attempt and CCCU export removal/reinstatement, retain credit overrides, reject stale source restoration without losing input, review changed evidence on mobile, and verify readable event history and teacher denial. The synthetic lifecycle checks finish with the results restored so the fixture remains available for hands-on review.

### Student profile editor

Administrators can open **Edit student details** from the main identity, pinned desktop identity or mobile Student actions. The grouped dialog preserves all existing identity, contact, programme, start-term, lifecycle, admission-stage and notes fields. Save updates the real student with an atomic before/after audit; it does not change module outcomes, scores, enrolments or credits, send email, or modify the private photo. Optional fields can be cleared. Photo changes use the separate Manage photo task.

Every student update advances a database-owned revision, including writes from legacy screens or other writers. The new dialog freezes its original revision and fields. A stale save fails without overwriting the newer record or refreshing away the draft; discard and reopen to review it. Duplicate-identifier and validation errors keep inputs. Assessment and profile tasks share the existing close/navigation guard. In-app navigation has Keep editing / Discard; document unload/reload uses the browser-owned warning where supported. The cross-browser matrix records profile navigation coverage per engine; it is not installed Safari or physical-device sign-off.

```sh
npm run student-workspace:profile:smoke -- /path/to/private-local-login.json
```

This guarded harness creates two fresh synthetic students, a term and one passing module enrolment, retaining all previous fixtures. It verifies every editable field and audit after reload, unchanged assessment facts, directory/term/section context, cancel/focus restoration, duplicate errors, concurrent legacy edits, frozen drafts, navigation warnings, optional-field clearing on mobile and teacher UI/direct-RPC denial. Results and screenshots live in `.context/student-profile-review/<run-id>/`; `latest.json` identifies the latest successful review. Profile photos, student creation, attendance and the remaining editors are not covered by this checkpoint.

### Attendance and shared teaching sessions

Migration 0060 adds atomic, audited attendance corrections and shared term-session creation. It has been applied only to the isolated Docker project after a private backup. Administrators can edit an individual's attendance or add a shared session from the Attendance section of a participating student's profile. The selected term scopes the shared session, not the student: it appears for other participating students and in the specialist term register. Creation does not automatically mark anyone expected or attended. Session editing/deletion and bulk register work remain in the existing term register.

The editor distinguishes Not recorded from Expected. Corrections require a reason, preserve existing reception check-in/out timestamps, and recalculate all affected module enrolments without changing exam scores or clearing exceptional decisions. Clearing an actual record requires confirmation; its prior evidence remains in the audit. Both attendance and shared-session writes roll back if their audit fails. Teachers remain read-only; reception retains its existing workflow and cannot use these administrator commands.

Database-owned per-student/session revisions track attendance and expected-list changes, including reception and legacy writers. A separate session revision detects changed dates, times or locations. Stale saves preserve the draft and require reopening; successful saves return a fresh attendance snapshot so immediate reopening does not reuse the old revision. Dialogs retain the shared unsaved-change protection. Shared-session retries use a stable identifier to prevent duplicate creation.

```sh
npm run student-workspace:attendance:smoke -- /path/to/private-local-login.json
```

This guarded Chromium harness creates a fresh two-student, two-module synthetic fixture without resetting earlier data. Seven groups cover cross-profile shared sessions, no automatic attendance, duplicate creation, Expected/Not recorded, recalculation and retained credit overrides, reception timestamps, stale attendance/session edits, deliberate clearing with audit evidence, mobile layout and teacher denial. Results and screenshots live in `.context/student-attendance-review/<run-id>/`; `latest.json` identifies the latest successful review URL. Specialist register and reception refresh invalidation also includes the shared student and assessment views. Full specialist-workflow and cross-browser acceptance remain outstanding.

## Remaining acceptance work

The 2026-10-24 resumed regression checkpoint passes 592 unit/integration tests, three local-environment guard tests, lint, the guarded shadow build and 90 Chromium/Docker browser/database check groups across all ten workspace harnesses. The specialist finance notes hydration regression is resolved and covered by delayed-script and ordinary-reload checks. These are regression results, not completion of the broader acceptance and rollout work below.

- Extend the connected core journey below with remaining edge cases and specialist coverage; reconciliation of unmatched imports and older withdrawals remains deferred.
- Extend the now-passing connected multi-student/admin/teacher/reception and three-engine core matrix with remaining error/specialist cases, actual supported-browser/device review and storage-failure/retention operational rehearsal.
- Full specialist attendance/reception, teaching, finance and enrolment mutation parity; course-owned plans and migrations; exports and original workflow regressions.
- Guarded disposable migration/backfill/concurrency rehearsal, shadow/rollback and synthetic local live-mode handover.
- User visual/workflow approval. The Wayfinder execution map stays open; production reconciliation, main merge and live deployment remain separate gates.

### Connected multi-role journey

```sh
npm run student-workspace:journey:smoke -- /path/to/private-local-login.json
```

This guarded Chromium/Docker harness follows the same student across real administrator, teacher and reception sessions rather than treating each editor as an isolated fixture. It creates two students and enrols them through the UI; course/offering setup uses the existing administrator plan command and synthetic fixture inserts. It reuses the existing active synthetic term without changing its status or dates. That term must already have ended so final compliance failures can be exercised. A new shared session uses today's date for the real reception kiosk, even though this deliberately synthetic active term has historical dates; no clock spoofing or production-shaped chronology is claimed.

Eight groups cover creation/enrolment, shared sessions and peer isolation, reception check-in/out and a conflicting administrator draft, timestamp-preserving attendance correction, teacher-authored mobile presentation evidence, failed Theory followed by a later-term passing resit with retained Practical and failed-attempt history, original-cohort assessment table/board and directory risk/credits, finance specialist navigation and independent amounts, role restrictions, audited authorship and evidence-blocked cancellation. The final overview must show one passed module, ten credits, one attended session and the exact remaining finance balance. Early reception checkout remains Part attended; the test makes an explicitly reasoned correction rather than weakening that rule.

A fresh synthetic reception account is created locally with a random password and confirmed email without sending mail. Its staff profile is deactivated on exit, including failure, while retained records keep their author identity. The password is neither printed nor saved. Existing administrator/teacher credentials remain private. Each run leaves its synthetic students/evidence available for review and writes screenshots, fixture IDs and results under `.context/student-journey-review/<run-id>/`; `latest.json` points to the latest successful journey. Run mutation harnesses serially. This adds connected-core acceptance to the separate slice regressions, not Safari/Firefox, complete specialist, storage-failure or local-live/rollback sign-off.

## Module enrolment management

### Enrolments added in error

Migrations 0067–0071 add **Manage enrolment → Added in error — cancel enrolment**. This is an administrative correction, not a new academic outcome and not abandonment. An active administrator must identify the student/offering, confirm the mistake and supply a reason. The database rechecks the frozen revision/token and all evidence when saving; cancellation, its audit and peer recalculation commit together. A cancellation does not delete the enrolment, calculated history, participation decisions or any source record.

Automatically calculated history and an abandonment/deferral decision alone do not block cancellation. Actual assessment attempts (including excluded attempts), arrangements, active exceptional decisions, legacy outcomes and teaching evidence do. Attendance/expected-list evidence and finance records anywhere in the same student/term conservatively require separate review because their ownership may be shared across modules. The ordinary editor has no bypass. Immutable evidence-presence markers survive removal of underlying results, teaching, attendance and finance records; existing surviving evidence is backfilled, and available workspace audits/version records also protect historical evidence. Already-deleted legacy evidence without a surviving record or audit cannot be reconstructed by this migration.

Migration 0071 implements the user's clarified resolution policy: active exceptional decisions remain blockers, but the editor lists their type/value/reason and directs administrators to **View results → Exceptional decision → Restore automatic calculation**. Each decision must be explicitly cleared with a reason through the existing audited action before retrying cancellation. Cleared non-awarding administrative decisions and their retention markers no longer block by themselves; neither the decisions nor their markers are deleted. Previously awarded positive credits remain a blocker even after clearing the credit/outcome override. Assessment, teaching, attendance and finance evidence is not made cancellable by clearing an administrative decision. Reopen Manage enrolment after resolving decisions so the database rechecks all remaining blockers.

Normal student/module lists, assessment queues, academic exports, capacity counts, fee suggestions and shared practical attendance calculations use active enrolments only. Existing invoices, payments and attendance are never removed or adjusted by cancellation. Course-level plan requirements and all rollout sign-off requirements remain in force; cancelled legacy enrolments are excluded from the enrolment plan gate. New scores, imports, teaching/participation decisions and direct writes cannot attach to a cancelled enrolment. Imports without another unambiguous active owner remain unmatched. Cancelled rows cannot be mutated or deleted through legacy editors, and retained student/offering ownership still prevents duplicate enrolment creation.

Administrators can select **Show cancelled enrolments** inside Manage enrolment to read the cancellation reason, actor and timestamp. Reinstatement is intentionally not exposed in this slice: it requires a separately designed audited action, not Resume module or a duplicate Add enrolment. Genuine withdrawal continues to use Abandoned. **Remove unused enrolment is no longer offered in the student workspace**, including for eligible legacy rows, and the workspace server action rejects that command. Existing legacy database removal safeguards remain intact; this UI change does not weaken them.

The active-enrolment view preserves underlying row-level security and grants only SELECT; cancellation and evidence-retention tables are not directly writable by authenticated or service-role clients. Migration 0069 explicitly removes Supabase's default view mutation grants. Migration 0068 updates the legacy capacity and formally-awarded-credit readers against the same active-enrolment view; it requires the earlier admissions schema and is exercised on the complete Docker stack rather than the reduced assessment-only PGlite schema.

```sh
npm run student-workspace:cancellation:smoke -- /path/to/private-local-login.json
```

The guarded synthetic harness exercises actual Add enrolment, abandonment followed by cancellation, reload persistence, retained history/audit, desktop/mobile cancelled-record visibility, draft guarding, failed-result protection, role/direct-write restrictions, legacy admissions capacity and three real concurrent cancellation-versus-score races. It reuses the existing synthetic active term without changing its status. Evidence is saved under `.context/student-cancellation-review/<run-id>/`. Run the assessment PostgreSQL integration tests for shared requirement recalculation, historical evidence, audit rollback, import exclusion, stale drafts and invalid inputs. All migrations and browser exercises are Docker-only; production reconciliation, full rollout/rollback rehearsal and user acceptance remain separate gates.

Migration 0061 connects Add enrolment and Manage enrolment in Modules & results. It has been applied only to the isolated Docker project after a private backup. Management snapshots load afresh when opening a task, then freeze while editing. Administrators can:

- Add a teaching enrolment in a chosen offering/cohort, inheriting its reviewed global assessment plan. A changed offering configuration or duplicate enrolment is rejected. This does not create scores, attendance, finance records or an assessment-only resit enrolment.
- Set or clear individual practical attendance-day and presentation requirements with a reason. Blank attendance means inherit; zero is an explicit exception. Attendance requirements combine across practical enrolments, rather than representing a separate whole-term total for each module.
- Defer module teaching, abandon or resume participation, separately from exceptional outcome/credit/warning decisions and assessment deferrals. This does not change the student's lifecycle, exam scores or active exceptional decisions.
- The initial 0061 slice exposed guarded unused-enrolment removal; that workspace option has since been retired entirely in favour of Added in error cancellation. Calculated assessment history blocks deletion even without a visible exam score. Associated exam/teaching evidence and term attendance/expectations also block removal. No assessment history is deleted or foreign-key guard weakened; defer/abandon is the normal participation-change route.

Writes use the Assessment Recording Module command boundary with administrator authorization, required reasons, frozen revisions/tokens and atomic audit. Requirement changes already recalculate related enrolments; module defer/abandon/resume now also refresh the affected student's other assessment projections because shared attendance requirements can change. Existing scores and exceptional decisions remain intact. Course-owned plans, weighting, schemes and pass marks are not accepted by these task commands. Requirement edits are tested with database live-mode guards enabled, without reopening legacy outcome editing; this is not a local application cutover rehearsal or production sign-off.

The dialog preserves input on stale saves, supports Keep editing / Discard, and uses the shared browser unload/navigation guard. Teacher controls remain absent and database management reads/mutations require an active administrator. Legacy enrolments without a reviewed plan cannot use requirement or participation edits until their course-level reconciliation is resolved; their dependency check remains available. Specialist legacy workflows are not decommissioned.

```sh
npm run student-workspace:enrolment:smoke -- /path/to/private-local-login.json
```

This guarded Chromium harness creates a fresh synthetic student and teaching offerings on each run, retaining prior fixtures. Seven groups cover multi-module requirement effects, inheritance clearing, presentation exceptions, defer/abandon/resume, stale legacy/configuration edits, saved creation and reload, mobile cancellation restrictions, confirmed unused legacy cancellation, absence of hard removal and teacher denial. Results and screenshots live in `.context/student-enrolment-review/<run-id>/`; `latest.json` identifies the current successful fixture. Integration tests additionally verify live-mode requirement writes, invalid-field rejection, audit-failure rollback and database helper permissions. Full multi-role/specialist, cross-browser, migration/backfill and local-live/rollback acceptance remains outstanding.

## Structured teaching records

Migrations 0062 and 0063 connect three focused creation forms in the student's Teaching records section. Both have been applied only to the isolated Docker project after private backups. Administrator and teacher access uses the existing `record_teaching` permission; reception gains no access. The existing Staff workflow restriction is preserved: new records require an active student enrolled in the current active teaching term. Historical entries remain readable. An empty editor explains when that scope is unavailable rather than silently selecting a different student or term.

- Observations retain the teaching offering, date, details and concern level.
- Formative assessments select an active definition belonging to that module, one or more configured assessed items and a whole-number overall score on the definition's scale. Zero remains a recorded score. Existing per-item numeric evidence remains visible; formative records do not create module exam attempts or resits.
- Presentations retain type, duration, comments and all ten existing 1–5 rubric scores. The database computes the total; no client-supplied total or author is accepted. Rubric labels are readable in the chronological timeline. Presentation evidence uses the canonical completion evaluator and does not manufacture an exam score or clear an exceptional decision.

Every new record derives its author from the signed-in active staff account and commits together with its audit and existing recalculation hooks. A stable record identifier prevents duplicate retries. Fresh, student-scoped options load when opening a task, then freeze; changed enrolment/term/module or formative-definition configuration rejects a stale save without discarding inputs. The shared Save/Cancel, Keep editing/Discard and native unload protections apply. These are creation forms, not a new history deletion or correction facility.

The timeline preserves distinct record types, dates, authors, concerns, assessed items, scores and comments. The specialist Staff screen remains linked with student context and uses the same tables. Its existing three creation actions now invalidate shared views, including the assessment queue, rather than only Staff and the open student profile. No specialist workflow is decommissioned.

```sh
npm run student-workspace:teaching:smoke -- /path/to/private-local-login.json
```

This guarded Chromium harness creates a fresh synthetic student, modules, definitions and offerings. It reuses the isolated project's existing active term without changing it, or creates a synthetic active term if none exists. It requires a completed-date synthetic active term for the presentation-compliance assertions and refuses to alter existing term dates to force that setup. It also creates its own historical enrolment to check scope restrictions. Earlier fixtures and records are retained.

Eight browser groups verify observation persistence, formative validation/zero scores, stale drafts, presentation metadata and recalculation, mobile teacher author attribution, duplicate/author-spoof/anonymous denial, shared specialist records, and active-student/current-term restrictions with readable history. Screenshots and results are under `.context/student-teaching-review/<run-id>/`; `latest.json` identifies the latest successful review URL. Integration tests additionally cover inactive/reception denial, wrong-module definitions, malformed rubric values, private helpers and atomic audit rollback. Full specialist, cross-browser and local-live/rollback acceptance remains outstanding.

## Individual student finance

Migration 0064 adds fresh administrator-only finance snapshots and atomic, audited create/update commands. It has been applied only to the isolated Docker project after a private backup. The Finance section now offers Add finance record for missing enrolled terms and Edit for existing records, including historical records whose enrolment has since been removed. Expected fees initially use enrolled offering prices, excluding legacy deferred enrolments as in the existing finance workflow; administrators review and may change that amount. Changed enrolments/prices reject a stale creation draft. Existing records keep their student and term fixed in this editor.

Invoice amount/status, paid amount/status and notes retain the existing meaning. Amounts use exact integer pence; blank invoice/payment amounts remain unrecorded and distinct from explicit zero. Incomplete payment evidence does not display a misleading complete balance. Unexposed purchase-order references remain untouched. Saving only records reconciliation information: it sends no invoice, collects no payment and changes no assessment outcome, score or exceptional decision.

Every insert/update, including existing specialist writers, advances a database-generated opaque version. The new dialog freezes the version loaded on opening; changed, moved, deleted or recreated records reject its stale save without losing input. Reopening loads fresh data. Creation uses a stable identifier and student/term uniqueness, and successful writes require their before/after audit in the same transaction. Shared Save/Cancel, Keep editing/Discard and native unload safeguards apply. Teacher/reception payloads omit finance data and controls; reads and writes require an active administrator independently at the database boundary.

The existing specialist finance workspace retains bulk generation, reassignment, deletion and exports. Links and initial filters retain student/term context, with a return link to student Finance. Existing specialist mutations now invalidate shared views, including the previous owner's profile after reassignment. This does not retrofit optimistic editing into every legacy specialist form; full specialist concurrent-editor acceptance remains outstanding.

The specialist reconciliation table keeps its controls disabled until client hydration completes. Previously, editing notes immediately in a newly opened tab could reset the text selection during hydration and prepend the replacement to the old notes. The finance browser harness deliberately delays application scripts, verifies editing is unavailable before hydration, then checks exact replacement/clearing and the persisted value. It also repeats replacement after an ordinary reload without a script delay. This protects early interaction rather than adding a timing workaround to the test; finance calculations and write permissions are unchanged.

```sh
npm run student-workspace:finance:smoke -- /path/to/private-local-login.json
```

This guarded harness creates fresh synthetic students, closed terms and an enrolled module without changing existing fixtures or active terms. Nine Chromium/Docker groups cover creation/reload, blank-versus-zero and exact amounts, statuses/totals, validation and dirty drafts, specialist save conflicts, fixed ownership after reassignment, mobile editing, teacher payload/RPC denial, audit/assessment separation, and competing saves against the same version. Evidence lives in `.context/student-finance-review/<run-id>/`; `latest.json` identifies the current review URL. Database tests additionally cover deletion/recreation, orphaned historical records, preserved purchase-order references, invalid direct RPC fields, inactive/reception/anonymous denial, private helpers and audit-failure rollback. This remains a local shadow-mode checkpoint, not production or cross-browser acceptance.

## Private profile photos

Manage photo beside the student avatar, and in pinned mobile Student actions, opens a separate task for upload, replacement or deliberate removal. Clicking the avatar still enlarges the current photo. Selection previews locally; nothing uploads until Save photo. PNG, JPEG and WEBP retain the existing 10MB limit. Client checks size/type and requires a displayable preview; the server independently checks size, declared type and file signature. This is not a malware-scanning or image-transcoding service. Invalid or failed saves retain the selection, with shared Keep editing/Discard and native unload protection.

Migration 0065 adds administrator-only fresh snapshots and an atomic photo-reference/audit command. It has been applied only to the isolated Docker project after a private backup. Both integrated and legacy photo actions now use the same safe service, with a frozen student profile revision. A concurrent photo or student-details change rejects the old draft, including before uploading when already stale. The database verifies a new private object exists in the correct student namespace, has supported metadata and has not already been used. Actor identity is database-derived; the photo reference, revision and before/after audit commit together. No identity, lifecycle, enrolment, assessment or finance facts are changed.

Uploads use new unique paths with overwrite disabled. Storage and PostgreSQL are **not one transaction**: the new object is uploaded first, then the guarded reference/audit transaction commits. Only afterwards does the service attempt to remove the previous unreferenced object. Objects referenced by another student or managed document are retained rather than deleting shared evidence. A confirmed PostgreSQL rollback allows cleanup of the unsuccessful new upload. An ambiguous network/commit response never triggers blind object deletion; reopening checks the saved state before retrying. Cleanup failures are reported without falsely rolling back a successful profile save. Retained/unconfirmed private objects require administrator reconciliation before any later cleanup; full storage-failure/retention operational rehearsal remains an acceptance item.

The existing private bucket and permission model remain unchanged. Administrators can mutate; teachers can view but cannot upload, replace or remove. Anonymous and reception users have no photo-route access. The authenticated serving route returns `private, no-store` and `nosniff`; unsupported content types are not served. Revisioned image URLs refresh thumbnails/enlargement after replacement, while even an old URL returns the current authorized photo or a non-cacheable 404 after removal. No public/signed image URLs are sent to the workspace client.

```sh
npm run student-workspace:photo:smoke -- /path/to/private-local-login.json
```

The guarded harness creates a fresh synthetic student and two explicitly labelled synthetic PNG fixtures, retaining earlier review data. Eight Chromium/Docker groups test real Storage upload, local preview versus persisted save, reload/enlargement, replacement and old-object cleanup, invalid/oversized selection, dirty/unload protection, a legacy replacement conflicting with an open workspace draft, teacher read/write separation, anonymous/public-bucket denial, mobile removal/cache behaviour and re-upload. It verifies all five successful changes have audit evidence and other student fields are unchanged. Screenshots and results live under `.context/student-photo-review/<run-id>/`; `latest.json` identifies the review URL. Unit/database tests add signature checks, ownership/path/object metadata validation, retired-object reuse rejection, inactive/reception/anonymous denial, stale revisions, failed audit rollback, shared-file retention, upload/cleanup failure and ambiguous commit handling. Cross-browser and production acceptance remain outstanding.

## Student and prospect creation

Add student / prospect in the Students directory now opens a focused dialog when the integrated workspace is enabled. Existing `?mode=add` links also open it; the flag-off legacy form remains available. All existing fields are retained: names, email, phone, temporary/CCCU identifiers, programme, start term, student lifecycle, admission stage and notes. Defaults remain PGCert, Prospect and Interest, with no start term. Blank temporary ID generates a stable UUID-based BETAR identifier rather than relying on a timestamp. Other blank optional values remain null. The existing person-linking trigger creates the associated person; this manual workflow does not silently merge by email or replace admissions conversion.

Migration 0066 requires an active administrator and atomically commits the student, existing person-linkage effects and creation audit. No enrolments, assessments, fees, portal account or invitation are created. A start term is metadata, not a teaching enrolment. Unknown fields, identity links, photos, credits and supplied revisions are rejected. Duplicate identifiers and deleted start terms return readable errors with the draft retained.

Each open dialog holds one stable creation UUID. An identical retry by the same administrator returns the originally created student without another student/person/audit, even if that student has subsequently been edited. A changed request under the used UUID is rejected, not applied as an update. A removed prior student is not silently recreated. Database locking serializes simultaneous identical commands; transaction failures leave no orphaned person. This protects the same draft against retries, not separate deliberate records with matching email addresses.

Save opens the new workspace and preserves directory search, programme/status/admission/credit/risk filters and sorting in the return link. Cancel/discard retains the directory context and removes obsolete add mode. Validation/save errors retain the form; Keep editing/Discard and native unload guards are shared with the other task dialogs. Teacher and reception permissions are unchanged, with server and database authorization independent of button visibility.

```sh
npm run student-workspace:creation:smoke -- /path/to/private-local-login.json
```

The guarded harness creates a fresh synthetic closed term and duplicate-identifier fixture, then creates records through the real application. Seven Chromium/Docker groups cover default prospect creation and nulls/generated ID, all explicit fields, directory return context/reload, duplicate correction in the same draft, Keep editing/discard/unload, mobile/deep-link creation, teacher/anonymous denial and concurrent identical RPC retries with one audit. Unit/database tests additionally cover inactive/reception denial, invalid fields and identity spoofing, invalid terms, identifier constraints, existing person linkage, later edits/deletion, no implicit email merging and full audit-failure rollback. Evidence lives under `.context/student-creation-review/<run-id>/`; `latest.json` identifies the saved review student. Migration 0066 has been applied only to the isolated Docker project after a private backup. Full specialist/multi-role/cross-browser and local-live/rollback acceptance remains outstanding; no production/main authorization is implied.
