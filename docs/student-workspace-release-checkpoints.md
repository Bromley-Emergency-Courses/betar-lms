# Student workspace and assessment release checkpoints

Updated 2026-10-28. Integration map: GitHub #51. Parent assessment implementation: #49. Later legacy removal: #50.

This checklist joins the approved workspace integration to the original assessment rollout. It records remaining gates, not permission to merge, access real data or deploy. Local work uses the isolated synthetic Docker projects and the separately authorized, retained pseudonymized academic copy within its agreed handling scope. Passing one checkpoint does not waive the next.

## Current position

Protected-review finding (2026-10-28): PR #63 and the Students/Staff shadow-review activation completed; public access remains blocked. Owner review then found that existing active-term enrolments were labelled historical and could not receive teaching records. Reproduced locally: legacy outcome protection includes current enrolments without a new assessment plan, while teaching eligibility incorrectly required that plan. The local follow-up `0080_protected_current_teaching.sql` separates protected current teaching from exam-plan readiness without rewriting any academic records or weakening outcome/credit protection. It retains active-student/module/term, disposition, deferral, cancellation, presentation carryover, author and stale-draft checks. Protected badges now say “Recorded” rather than implying that teaching has ended. New exam entry and assessment live-mode readiness remain separate reviewed-plan/reconciliation gates.

The owner approved committing, pushing and merging this focused follow-up, applying its function-only migration and refreshing the protected review deployment. Execution and preservation receipts remain separate from this authorization. Validation: 818 tests across 67 files, lint, TypeScript, guarded synthetic shadow build, full isolated Docker migration/restore rehearsal and a focused authenticated PostgreSQL teaching save with unchanged baseline. Verify original-data preservation before/after, then the owner confirms current teaching options without test writes to production. Keep public maintenance and shadow authority until the remaining release gates below pass. Do not replay migrations `0049`–`0079`, delete historical baselines, automatically assign plans or insert synthetic records into production.

Approved next operation (2026-10-28): the owner authorized committing, pushing and merging the focused compatibility follow-up, then enabling the new Students/profile and Staff interfaces on a protected shadow-mode review build. Public access must remain blocked. No new migration, backfill, live assessment cutover or production test edits are authorized. The validation includes 800 tests, lint, TypeScript and a guarded synthetic-only shadow build. Execution receipts and the eventual review deployment are recorded separately; this approval is not proof that activation or new-interface acceptance has completed.

Compatibility follow-up (2026-10-28, local only): an import regression reproduced a saved score followed by a rejected automatic update to its protected historical enrolment. The shared status-sync helper now skips preserved historical baselines, batches the protection lookup and fails closed on lookup errors; new enrolments retain existing sync behaviour. The immutable database protection is unchanged. All 800 tests across 67 files, ESLint and TypeScript checks pass. This fix is not yet committed or deployed. The owner has logged into the off-mode review build; new-interface acceptance is still pending. Proposed protected activation uses shadow mode with the Students and Staff flags enabled, not live assessment authority. Shadow mode permits real writes, so initial owner review must be view-only and imports remain stopped. Commit/follow-up release and flag activation need explicit approval.

Maintenance continuation (2026-10-28): the owner approved replacing project pause with a temporary firewall barrier. The exact merged Git SHA built successfully on Vercel as a staged production deployment; it is not promoted. Public aliases return firewall denial and automatic domain assignment remains disabled. Only the new deployment's direct host is exempt from the temporary rule, and it still requires Vercel SSO plus normal LMS authentication. A fresh read-only comparison confirms every original public row/field still matches the final backup, historical fields remain unchanged, and no backfill or synthetic data exists. All four workflow flags remain off. Authenticated owner review and legacy historical-edit/import compatibility remain gates before reopening. The vault is locked. This supersedes the paused/build-blocked state in the preceding window record below.

Release-window update (2026-10-28): the owner explicitly approved downtime, final encrypted backup/recovery, pinned migrations and PR #56 merge/deployment with all four new workflow flags disabled. The fresh backup and isolated full recovery passed, as did all 31 migrations on the recovered snapshot. Live migrations `0049`–`0079` then committed successfully; every original public-table row and field matched the backup before and after each migration. Historical baseline fields match, with no backfill or synthetic records. PR #56 merged as `1d79b98a0246a3bdfae501ef71bc2e8c11742f30`, with the exact approved candidate tree and Staff changes retained. Vercel created the production deployment but **blocked its build because the project is paused**. Public access remains paused; no new runtime, promotion, reopening or workflow activation has passed. A replacement maintenance barrier is needed before unpausing to build; do not expose the old application or replay migrations. Private receipts remain in `.context/release-window-20261028/` and the locked encrypted vault. Earlier positions below are historical, not the current deployment state.

Pre-window packaging position (2026-10-27): draft PR #56 was at pushed commit `6efbd27`, including Students/assessment, the accepted Staff companion and the production-safety/historical-preservation follow-up. All 442 committed-source manifest hashes matched; the clean-source checks passed 795 tests across 66 files, lint, the configured synthetic build, expected missing-configuration rejection and 17 helper checks. These are local checks, not hosted CI. All migrations `0049`–`0079` were release prerequisites against live `0048`. The review branch's deployment guard remains intact. Earlier counts and student-only scope notes below describe earlier checkpoints, not exclusions from the combined release.

Full encrypted local database/private-file backup and isolated logical recovery completed on 2026-10-27. A read-only consistent database snapshot, role definitions without database-role passwords, and all inventoried private object bytes were retained in the encrypted vault. Every restored table matched its source-snapshot row count and SHA-256 fingerprint; sequences, extensions, migration history, object checksums and encrypted lock/unlock rereads passed. Recovery used network-isolated, swap-disabled memory with no ordinary Docker data volume; persistent artifacts remain encrypted and the container is stopped. This does not certify a hosted platform restore, Storage API reupload, off-device backup or the final coordinated release-window recovery point. Detailed evidence remains gitignored.

The owner separately authorized an LMS-only database-password reset, which completed with certificate-verified read-only connectivity and unchanged migration history through `0048`. The new credential is held securely; unrelated API keys and Portal credentials were not rotated. The owner directed treating the Portal's hidden automation credentials as separate, an assumption rather than an independently verified target check. The [current execution order](student-workspace-release-preparation.md#current-execution-order) distinguishes completed packaging and local recovery from the remaining configuration, acceptance and production-authorization gates.

Production configuration follow-up: with separate owner approval, the three existing Vercel production Supabase settings were re-saved from the verified LMS project's URL and existing API keys. Both keys passed read-only API checks; no key rotation occurred. All three updates were accepted, sensitive production-only scope was retained, unrelated variable metadata was unchanged, and the running deployment remained unchanged. Saved sensitive values cannot be independently read back; the future authorized deployment still requires runtime validation. No merge, deployment, schema migration, application-record write or workflow-flag activation was performed.

The updated separate synthetic live-mode browser rehearsal passes seven groups, including protected historical Pass/credits despite unrecorded attendance, both original results in official exports, independent audited outcome/credit amendments, original-versus-effective exports and restoration to the preserved baseline. Off/shadow/live authority, modern result correction/resits, live write blocking and retained evidence after rollback still pass. The rehearsal returns its database to shadow and stops only its own stack, retaining volumes; the normal shadow review stack is unchanged. Evidence: `.context/assessment-live-review/e93e2aa8-f393-4ae6-ba73-56e9848bc8c9/`. No synthetic sign-off is reusable for production.

The connected development implementation includes profile/photo editing, creation, enrolment management, attendance, teaching, finance, shared assessment views, complete result history and audited exceptional decisions. Added-in-error cancellation retains the audit trail and protects evidenced enrolments; there is no hard-removal option in the workspace. The user has approved successive local workflows.

The earlier broad regression checkpoint passed 90 Chromium/Docker browser/database groups. The consolidated 2026-10-25 validation passes 602 unit/integration tests, five environment guard tests, two browser-selector tests, lint, the guarded shadow build and the complete 99-group core browser matrix: layout/navigation, profile, photo and connected administrator/teacher/reception journey on Chromium, Firefox and WebKit. Additional passes cover 65 specialist groups, 18 Course groups across the three engines, seven recovery groups and six synthetic live-mode groups. Installed Safari/physical-device acceptance and the real-data/release gates below are not replaced by these results.

The additional local engineering pass covers specialist workflows, Course-owned inherited-plan review, exports, real-service failure recovery, the complete migration chain through `0072`, SQL backup restoration and a separately authorized synthetic live-mode application rehearsal. Following the user's scope clarification, Course retains its familiar overview, visible module/term editors and term-grouped offerings. Only collapsed Exam rules are added within each module editor; changing existing enrolments' rules is an advanced action. Closed offering groups mount their editors on first opening and retain drafts thereafter, without introducing a term selector. The remaining human gate is consolidated development acceptance, including actual staff-browser/device checks; see the evidence record in the development guide.

The review application remains in local shadow mode. The separate live-rehearsal project returned to shadow and was stopped with its volumes retained. No production reconciliation, production migration, production pilot, main-branch merge or live deployment has been approved or completed by these checkpoints.

The earlier student-only PR checkpoint excluded unrelated Staff work; the later accepted combined release includes it. Source review identified import-reversion and repeated-teaching carryover defects. Follow-up migrations `0073`–`0074` address these with regression tests, preserve administrative decisions/history and invalidate stale later-enrolment drafts. At that checkpoint, all 163 assessment integration tests and a fresh synthetic Docker migration/backup-restoration rehearsal through `0074` passed. The subsequent validation below supersedes those counts. Final review and the human/real-data gates remain required; the branch's Vercel auto-deployment guard remains in place.

## Remaining checkpoints, in order

Combined-release follow-up (2026-10-26): the user separately authorized a local pseudonymized academic rehearsal. A dedicated network-isolated Docker database loaded an allowlisted academic subset from the deployed `0048` baseline, with identifying IDs replaced and names/contact information, credentials, documents, raw import payloads and free-text excluded. Applying `0049`–`0077` preserved every original loaded field after each migration; an independent database restored and compared all public-table rows in the resulting SQL backup. Unreviewed assessment plans and ambiguous presentation history remained held rather than guessed or rewritten. This completes the academic-subset migration/preservation drill, not whole-production backup/restore, browser acceptance against real-shaped data, finance/admissions coverage, module-plan approval or release sign-off. The private dataset and detailed findings stay outside source control. Main remains unmerged and the production schema unchanged.

### 1. Finish cross-browser and responsive acceptance

- Completed: the layout/navigation, profile, photo and connected multi-role matrix on Chromium, Firefox and WebKit, with strict runtime-error checks.
- Completed in the automated core matrix: long names/identifiers, narrow layouts, enlargement, keyboard/focus behaviour and unsaved edits. Extend coverage when later specialist work identifies additional browser-sensitive cases.
- Perform hands-on checks in the actual supported staff browsers/devices, including Safari/iOS if used. Playwright WebKit and narrow desktop viewports do not certify those devices.

Exit: recorded green automated evidence and agreed manual-browser acceptance, with no unresolved blocking defect.

### 2. Finish specialist, course configuration and reporting acceptance

Automated local pass completed; final user acceptance is batched into checkpoint 6. The legacy profile's inherited-plan editor has been removed and its reviewed replacement lives in Course configuration. Existing result thresholds, incompatible-evidence blocking, stale-preview rejection and preserved failed-save drafts are covered.

- Verify shared-session and specialist attendance/reception operations, teaching records, bulk finance, enrolment requirements and their effects on the integrated workspace.
- Exercise all assessment schemes, independent components, resits, schedules, deferrals, corrections, exclusion/restoration, exceptional decisions and complete history against the current build.
- Verify versioned plans and reviewed inherited-plan changes through Course configuration only. Existing enrolments and recorded pass marks must not change silently.
- Verify original teaching-term filtering versus actual sitting term, current-risk resolution, cancelled-enrolment exclusion, current outcomes, attempt history, reconciliation and CCCU exports.
- Recheck unaffected admissions/directory/legacy paths and administrator, teacher and reception permissions. No matching/reassignment UI is enabled by this work.

Exit: capability-parity checklist and export comparisons accepted; fixes covered by regression tests.

### 3. Rehearse failure recovery and private-photo retention

Local failure-recovery checks completed using real browser/Storage/database operations, including dropped pre-commit requests, lost post-commit responses, upload/save/cleanup rejection and private-byte restoration to a separate key. The read-only photo inventory deliberately never deletes uncertain files. A production retention period and deletion approval remain owner decisions, not invented defaults. See [recovery runbook](student-workspace-recovery.md).

- Exercise failed upload/save/cleanup, interrupted or ambiguous responses, retries and concurrent edits against the real local services, not only mocks.
- Confirm drafts survive rejected saves and retries do not duplicate students, enrolments, attempts or shared sessions.
- Reconcile retained/unconfirmed private photo objects safely; prove an uncertain save cannot cause deletion of a referenced object. Establish an operator procedure for retention and cleanup.

Exit: recoverable failure paths and documented storage handling, with no silent data loss or authorization bypass.

### 4. Rehearse the complete migration and backfill in disposable Docker databases

The latest synthetic rehearsal runs from a fresh `0048` baseline through `0079`, covering legacy statuses, imported and Manual backfill, held duplicate sequences, idempotent retries, real PostgreSQL concurrency, historical protection and unchanged original evidence. A separate database restores and compares the SQL backup. The authorized pseudonymized academic subset also passed its recorded migration/preservation checks, including transaction-rolled-back historical protection. Neither drill is whole-production database/private-file recovery or final deployed-data reconciliation.

- Use the current migration chain, including workspace/cancellation safeguards, on a disposable baseline. Do not reset the review stack or use another local project's database by default.
- Exercise legacy statuses, ambiguous ownership, duplicate/predecessor cases, manual/imported rows, old Final mark/Grade values and assessment-only duplicate enrolments.
- Prove conservative, retry-safe backfill, unchanged original evidence, atomic audit and real PostgreSQL concurrency. Resolve rehearsal-script assumptions that no longer match the approved workflow.
- Repeat against an authorized sanitized production-shaped dataset before release; synthetic fixtures alone are not reconciliation of deployed records.

Exit: reproducible migration/preflight/backfill evidence and a documented exception list; no guessed historical ownership or scores.

### 5. Rehearse local live-mode handover, backup/restore and rollback

Local SQL and application rehearsals completed. The user authorized the separate synthetic-only `assessment-yangon-live-rehearsal` project on 2026-10-25; it does not alter or waive the review stack's deliberately incomplete-plan cases. Off/shadow/live behaviour, the independent workspace flag, official export authority, sign-off rejection, live legacy-write blocking, pass reversal and retained live-only evidence after rollback are exercised. Migration `0072` fixes the real API safe-update failure found during this drill. Production coordinated database/object recovery and the operating response to live-only differences still need their release-owner sign-offs.

- Exercise off/shadow/live boundaries in the isolated environment, including database sign-off guards and matching application mode.
- Confirm live projections drive screens/risk/credits/exports, legacy writes are blocked, and the integrated workspace flag behaves correctly.
- Verify backup restoration in a disposable target, including required private-storage recovery, and rehearse rollback without dropping additive evidence.
- Account for records written only in the new workflow: reverting a flag does not copy them into legacy fields. Agree how to preserve/reconcile these writes during rollback.

Exit: tested operating runbook, explicit stop/rollback conditions and local evidence. Synthetic sign-off references are never reused for production.

### 6. Obtain final development acceptance

- Present the integrated build for the user's final desktop/mobile and real-workflow review, including the outstanding specialist and error cases.
- Fix blocking findings and rerun affected checks plus the complete test/lint/build/migration suite.
- Record the accepted build and known deferred scope. Close map #51 only when its implementation and user-acceptance destination is met; parent #49 remains subject to real-data rollout gates.

Exit: explicit acceptance of the development build, not implicit production approval.

### 7. Package and review the release; hold merge for the release window

- Inventory all tracked/untracked implementation files and migrations; include required source/docs/tooling but exclude private credentials, browser state, local evidence and unrelated prototype work.
- Review the diff against origin/main, security/RLS/role boundaries, migration order, configuration and tests. Check CI and a clean-checkout build.
- Authorized packaging is complete in draft PR #56 at `6efbd27`. Keep the combined Staff/student work and review-branch guard. Recheck any later changes against the tested candidate; commit/push approval is not merge or deployment approval.
- This release also has unconditional additive-schema dependencies (active-enrolment reads and revisioned legacy photo RPCs). Flags alone do not make it compatible with the old database. If main auto-deploys, stop at PR review until deployment is explicitly paused or the authorized migration/deployment window is ready. Reorder merge relative to checkpoint 10 rather than deploying code prematurely.

Exit: a reproducible reviewed draft release with deployment controls agreed. Hold merge until checkpoint 10's explicitly authorized migration/deployment window; main auto-deploys and flags cannot make the candidate compatible with the old schema.

Local preparation evidence and candidate exclusions are recorded in [release preparation](student-workspace-release-preparation.md). This preparation does not mark the merge or final-review gate complete.

### 8. Authorize and run read-only real-data preflight

- Agree the production/staging target, read-only access, data-handling arrangements and the responsible administrator before accessing real records.
- Generate the deployed-data exception report: ownership, duplicate enrolments, source identities, predecessor/attempt ordering, legacy outcomes/credits and uncertain module plans.
- Review a sanitized production-shaped rehearsal dataset under the agreed handling rules. Keep identifiable exports and secrets out of GitHub and source control.

Exit: administrator-reviewed exception inventory and migration scope. This step performs no production writes.

### 9. Approve module plans and the historical-data reconciliation decisions

The user confirmed the ongoing rules on 2026-10-26: Theory and applicable Practical pass marks are 50%; Departmental Leadership and Evidence to Implementation are online with both Coursework and Viva, no MCQ or Practical; Image Acquisition and Optimisation is online MCQ-only without physics weighting or Practical; the remaining 13 modules use 50/50 MCQ and physics/equipment Theory plus Practical. Coursework/Viva combined Theory remains independently supplied, not calculated by the LMS. These decisions are recorded for the release configuration, not applied to production or hard-coded as seed data.

Image Acquisition and Optimisation's historical Practical results must remain unchanged. New module-plan versions govern new enrolments; existing enrolments retain their inherited plan or remain unassigned pending historical review. Do not bulk-apply the ongoing rules to historical enrolments, discard incompatible results, fabricate supporting scores or treat this confirmation as backfill/cutover authorization. Historical reconciliation and its reporting impact remain a separate gate.

Focused validation after this confirmation: 229 assessment/database and Course-plan tests pass, including a regression proving that saving an online-only plan leaves an unassigned historical enrolment and its Practical result unchanged, while a new enrolment inherits the plan and rejects Practical entry. Targeted ESLint and whitespace checks pass. This is local test evidence, not production configuration or historical reconciliation approval.

The user subsequently approved implementing a historical-record preservation route locally. Migration `0078` adds a staff-scoped, read-only view of original results and explicit links to accepted attempts without updating source rows. The connected profile/register and exports now retain historical scores, recorded outcomes, credits, Final mark and Grade without inventing supporting items or applying current rules retrospectively. Unknown historical statuses stay explicitly historical rather than being converted to deferral/abandonment decisions. A linked source row is not a second export attempt, and excluded accepted attempts are not resurrected from their original source. Automatic source linking alone does not constitute reviewed backfill or change historical credit authority. Ordinary assessment decisions on unreconciled historical records are blocked in PostgreSQL; Course plan review and existing cancellation safeguards remain available. Historical administrative review flags are separate from unresolved academic-risk flags.

This read-only route does not approve the accuracy of historical records, resolve existing failures or authorize adopting them into the new editable workflow. Cutover guards remain unchanged: a historical record is not a substitute for approved inherited plans or reconciliation/sign-off evidence. Preserve and verify the old records first; resolve their future editable/reporting disposition separately before cutover. Detailed snapshot counts and limitations remain in gitignored local evidence.

Historical-continuity validation (2026-10-26): 783 tests across 66 files, ESLint, the configured isolated build and 17 environment/browser-helper checks pass. The dedicated synthetic browser scenario passes in Chromium, Firefox and WebKit. A fresh Docker migration/backfill/backup-restore rehearsal passes through `0078`; the separately authorized pseudonymized subset also passes a transaction-rolled-back `0078` rehearsal, with all original results, outcomes, credits, Final marks, Grades and teaching-term identities preserved. Its network-isolated container is stopped again and retained. These are local checks, not permission to merge/deploy or a certification of whole-production recovery.

Permanent-protection follow-up (2026-10-27): a PostgreSQL regression reproduced a historical Pass becoming Fail after reviewed backfill because attendance/presentations were unrecorded. Migration `0079` fixes the authority at the evaluator, rather than only hiding the recalculation in the UI. The captured legacy baseline survives backfill and later course rules. Reasoned administrator Exceptional decisions can amend effective outcomes, credits and warning flags, with before/after audit and revision checks; clearing them restores the historical baseline. Original scores and legacy academic fields are not silently overwritten. New enrolments retain ordinary calculation. Production scope/count confirmation, maintenance/writer containment, backups and deployment/cutover permissions remain outstanding.

The isolated pseudonymized-copy rehearsal through `0079` preserves all 678 enrolments, 841 original results and 5,070 recorded credits, verifies audited amendment/restore without an assigned plan, and creates no automatic historical failure flags. It rolls back all rehearsal changes and stops the network-isolated container again; its data and volume are retained. A fresh synthetic Docker migration/backfill/concurrency/cutover/rollback/backup-restore rehearsal also passes, now including immutable historical baselines in restoration checks. Evidence stays in gitignored `.context/`; no live database was accessed for this follow-up.

Permanent-protection validation: 795 tests across 66 files, ESLint, the configured synthetic build and 17 helper guards pass. Browser amendment, restoration, decision-history and effective/original export checks pass in Chromium, Firefox and WebKit. The final Docker migration rehearsal is `.context/assessment-rehearsal/assessment_rehearsal_49_1793136655076`; academic-copy evidence is `.context/pseudonymized-release-rehearsal-2026-10-26/historical-protection-result.json`. These changes remain local and require reviewed commit/push and separately authorized production release.

- Review every active module's mode, MCQ versus Coursework/Viva, physics weighting, required items, pass marks and credits in Course configuration.
- Agree inherited plans for historical enrolments in scope; do not infer missing evidence or silently convert old Overall values.
- Resolve or explicitly document legacy contradictions, unknown predecessors, ambiguous ownership and duplicate enrolments. Do not automatically merge records.
- Keep manual matching/reassignment disabled as agreed. Unresolved imports remain visible and excluded; any case requiring a new reconciliation tool is a separate approved scope decision, not a hidden bypass. The administrator must accept its reporting impact or block cutover.

Exit: reviewed plan/reference set and approved disposition of every material exception.

### 10. Authorize additive production migration and shadow validation

Staff read-only results follow-up (2026-10-28): the teaching companion's plan-review gate also hid retained historical exam scores and protected effective statuses. The local application-only correction shows existing historical scores as recorded evidence, distinguishes absent records from unavailable data and ambiguous result history, and retains current protected lifecycle/explicit outcomes. It does not infer attendance or presentation completion from missing assessment-plan evidence, expose private override notes, change teaching eligibility, enable exam entry or alter stored results/credits. Historical Practical evidence remains visible even when a reviewed plan is online. This display correction requires no database migration and is separate from assessment activation.

Protected ongoing lifecycle follow-up (2026-10-28): the owner confirmed that existing 10-credit awards must remain unchanged. A local regression reproduced protected current-term Planned enrolments remaining "Recorded · planned" even while actively studying. Migration `0081` changes only the read-time evaluator: active students on active modules in an active term whose dates contain the evaluation date receive `In progress` for protected Planned/In progress records. It retains the immutable original status and credits, explicit status/credit amendments, historical Pass/Fail authority and original history. The profile/register badge uses this current lifecycle while exports retain both effective and original statuses. Future, closed, draft and inactive participation are not promoted; no automatic attendance failures are introduced. This does not assign existing assessment plans, unlock protected exam entry, backfill results or enable live authority. Commit, production migration and protected-review deployment still require their separate release approval.

- Approve the deployment window, operators, backup/restore references, target/configuration checks and stop conditions before any production write.
- The coordinated final backup remains a hard stop here, not an assumed completion. Establish writer containment and a final database/private-file recovery point; the completed local recovery drill does not protect later production writes or certify hosted recovery.
- Apply reviewed additive migrations and deploy compatible code in the agreed order, keeping the legacy assessment workflow authoritative during shadow validation.
- Verify preservation after `0049`–`0079` before the separately approved main merge/deployment. Keep Staff companion and teaching flags disabled until their approved activation, alongside the assessment/workspace gates. Follow the [release-window stop points](student-workspace-release-preparation.md#release-window-stop-points); never seed production or restore a rehearsal dump into it.
- Perform only reviewed eligible backfill and controlled Portal/CSV shadow ingestion. Preserve source hashes, original rows and immutable audit evidence; retries must be safe.
- Compare counts, source hashes, current component results, outcomes, indicators, credits and exports. Investigate or document each difference before proceeding.

Exit: accepted shadow comparison on real data and verified backups. Shadow mode can write additive data; it is not a read-only trial.

### 11. Run the administrator pilot and obtain release sign-off

- Agree a cohort/module set and a controlled operator workflow; avoid conflicting legacy/new edits during the pilot.
- Exercise first results, failed components and later-term resits, retained earlier failures, carried supporting items, correction/replacement, deferrals, exceptional decisions, attendance/presentation failures and pass reversal.
- Check term queues, awarded credits, history/audit and all required exports against staff expectations.
- Record the real reconciliation review, sanitized rehearsal, module-plan review, pilot sign-off and verified backup/restore references required by the rollout gate.

Exit: explicit administrator/user authorization for live cutover, with an owner and rollback decision process.

### 12. Enable the live workflow and verify the deployed LMS

- Use the authenticated rollout command with genuine sign-off evidence; align the database rollout state, application assessment mode and student-workspace flag.
- Verify the deployed build on the live target: authorized logins, student/module lists, results/history, term queues, credits, reports, photo access and role restrictions.
- Confirm legacy exam/outcome writes are blocked while retained legacy evidence remains available read-only. Enable only the intended production integrations.
- Monitor unmatched/conflicting imports, changed-pass warnings, credit differences, errors and failed saves. Stop or roll back using the rehearsed runbook if acceptance checks fail.

Exit: the live-data LMS is updated and operating on the accepted workflow, with immediate checks passed and monitoring assigned.

### 13. Observe, stabilize and only then consider legacy removal

- Complete the agreed observation period, reconcile post-cutover changes and close #49 only when its accepted release scope and evidence are satisfied.
- Keep legacy tables/evidence read-only for the agreed retention period. Their removal is separate issue #50 with its own authorization, backup/restore and retention gates.
- Revisit deferred matching/reassignment only if the user explicitly requests it; live rollout does not silently reintroduce it.

This checkpoint follows the live update; destructive legacy removal is not a prerequisite for using the new LMS.

## Authorization boundaries

Working agreement (2026-10-25): continue routine local implementation and validation without asking for approval after each passing checkpoint. Batch hands-on browser/device and workflow review into final development acceptance. Pause earlier only for a material business decision, unavailable authorized input, or an explicit authorization boundary; do not treat this agreement as release or real-data approval.

Normal continuation covers local implementation/testing only. Real-data access, production changes, commits/PR/merge and live cutover require their respective explicit approvals. Real-data preflight can be scheduled earlier to reveal migration risks, but only with its separate access authorization; it cannot replace local acceptance or the later write/cutover gates.

Detailed operating context: [development and acceptance](student-workspace-development.md) and [assessment rollout](assessment-workflow-rollout.md). If those documents contain older checkpoint counts or superseded staff actions, use the approved decisions in #51 and the current command guards; reconcile the runbooks before release rather than treating historical evidence as current approval.
