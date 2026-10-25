# Assessment workflow (#49)

The current end-to-end implementation and release sequence is recorded in [Student workspace release checkpoints](student-workspace-release-checkpoints.md), including the remaining local acceptance and separate real-data/main/production approvals.

The implementation is additive. Production has not been migrated or modified. The legacy `exam_results`, enrolment status, Final mark, Grade and credit values remain available for reconciliation. Formative `assessment_attempts` remains a separate teaching record.

For the current approved student-workspace integration and isolated Docker commands, follow [Student workspace development](student-workspace-development.md). The earlier rehearsal/browser evidence below is historical, not acceptance of the latest build. Do not use its old launchers against other local stacks. Migration 0058 disables manual matching and legacy source mutations; the current guarded correction/exclusion/restoration workflows replace those steps.

## Local verification

`npm run assessment:rehearse` is restricted to the isolated `assessment-yangon-49` project (API 56321, database 56322, container `supabase_db_assessment-yangon-49`). It refuses other container overrides. It creates uniquely named disposable databases, copies only the local Supabase platform schemas (`auth`, `storage`, `extensions`, without application storage policies), and applies the repository's complete application migration chain. It never copies review students or authentication rows, resets the review database, connects to a hosted database, or sends email.

The current review stack can already be migrated. The script builds its own `0048` baseline, inserts synthetic legacy evidence, then upgrades through every remaining repository migration. It retains the rehearsal and backup-restore databases for inspection and writes unique `.context/assessment-rehearsal/<database>/` artifacts (`latest.json` points to the last successful run):

- `preflight.csv`: read-only exceptions covering synthetic ambiguous ownership, missing predecessor, legacy marks, contradictory credits and plan review.
- `verification.txt`: safe backfill and Manual replacement/resit exercises.
- `concurrency.json`: two actual PostgreSQL connections; one accepts a resit and one rejects its stale revision.
- `shadow-comparison.csv`: legacy/new outcome differences, attempt counts and preserved legacy hashes.
- `result.json`: database identities, applied migrations, cutover write-guard, rollback and verified SQL backup-restore results.
- `synthetic-backup.sql`: synthetic rehearsal database backup, not a copy of the review stack and not a private-object byte backup.

The current rehearsal includes six synthetic students, all seven legacy enrolment statuses, three reviewed module plans, nine teaching enrolments and seven legacy results. Three unambiguous imported/Manual rows backfill; two duplicate sequences and ambiguous/unsupported rows remain for review. It verifies reviewed historical plan inheritance, idempotent backfill, pass reversal, zeroed credits, atomic Manual replacement of the same sitting, scheduling and passing a subsequent resit, unchanged teaching ownership, preserved original rows, real PostgreSQL concurrent writes, missing-signoff rejection and the legacy cutover write guard. A result written only in live mode survives rollback without being copied into legacy records. A separate database restores the SQL backup and compares legacy rows, attempts, revisions, audit and rollout state. This remains synthetic rehearsal, not reconciliation of the deployed dataset, a full infrastructure/storage recovery drill or administrator pilot sign-off.

Verification commands:

```sh
npm test -- --maxWorkers=2
npm run lint
npm run build
npm run assessment:rehearse
```

The worker limit avoids contention between the repository’s PostgreSQL/WASM test suites. The assessment tests cover the actual database functions, source adapters, CSV contracts, current-risk selection and rendered plan-specific forms. The Docker test adds real connection concurrency. A browser-operated cohort pilot remains a release gate.

Local verification on 15 October 2026: the full suite passed with 272 tests, including 57 assessment tests. Lint, production build, and the isolated Docker migration/backfill/concurrency/cutover/rollback rehearsal passed. An earlier test run alongside a production build hit two unrelated five-second test timeouts; the constrained full run passed without changing those tests.

### Browser verification

A subsequent local verification reran all 272 tests, lint, build and the Docker rehearsal successfully. A separate Supabase Docker project, `assessment-yangon-49`, then applied all migrations from a fresh database through `0054`. Its API uses port `56321`, its database uses `56322`, and the application runs in shadow mode on `http://127.0.0.1:3100`. This stack contains only one synthetic student and synthetic administrator/teacher accounts. Existing local stacks and production data were not modified; external Portal integration and outbound admissions email were disabled.

Automated Chromium checks against the actual application and local Supabase passed:

- Reviewed backfill accepts two safe rows and leaves ambiguous/unsupported rows for review.
- Unmatching an imported pass removes its score and credits; Manual replacement retains the same sitting and attempt count.
- Manual correction reverses Pass and credits without creating another attempt.
- Scheduling, cancellation, rescheduling and a passing Theory resit retain the original enrolment.
- A passing Practical resit retains the passed Theory component; unmet attendance still correctly prevents module Pass.
- Coursework/Viva resits explicitly carry a named earlier item and preserve the independently supplied combined score.
- Assessment deferral creates no attempt; exceptional credit overrides show the calculated recommendation and can be cleared.
- Current-risk queues exclude resolved historical failures; the student profile and register render without browser runtime errors.
- All four assessment CSV downloads succeed. Content checks verify four outcomes, seven accepted attempts, exclusion of replaced Portal evidence, original cohort versus actual sitting term, and the 18-column CCCU contract.
- Teachers remain read-only even with `mode=edit`; authenticated REST probes confirm teacher commands and direct revision mutations cannot bypass authorization.
- Two browser tabs demonstrate stale-form rejection without overwriting the first save.
- Saving module plan v2 leaves existing enrolments on their inherited plan and preserves their outcomes.

Workspace-only scripts, screenshots, CSVs and result logs are retained in `.context/assessment-browser/`. Local login details are in its private `login.json`; no production credentials are needed. Restart this workspace's preview with `node .context/assessment-browser/serve.mjs`. Stop only the isolated Supabase project with `supabase stop --workdir .context/assessment-browser` (do not reset or stop the existing `betar-lms` project). These synthetic automated checks do not constitute administrator pilot sign-off or deployed-data reconciliation.

## Feature modes

`ASSESSMENT_WORKFLOW_MODE` is server-only and defaults to `off`.

| Mode | Reads and writes |
| --- | --- |
| `off` | Existing workflow remains authoritative. New assessment screens and interface are disabled. |
| `shadow` | Legacy screens remain authoritative. Portal/CSV imports also create immutable evidence. `/assessments` and student profiles expose the new workflow for reconciliation and pilot review. |
| `live` | Assessment projections supply profile results, risk, credits and official exports. Legacy exam/outcome mutations are rejected. The database must also be in `live` mode with recorded sign-offs. |

Apply the complete repository migration chain to a local/test Supabase instance before enabling `shadow` (currently through `0072`). Use the guarded local launcher for this workspace. The rehearsal databases are for SQL testing and are not automatically substituted for the local Supabase API's database.

Deployment ordering matters even when the flags are off: this integrated release reads the new active-enrolment view and uses the revisioned photo RPCs from legacy photo actions. It must not run against a pre-migration database. Confirm auto-deployment behaviour before merging; deploy only within the separately authorized additive-schema/application rollout, or pause automatic deployment while the PR/merge is prepared. Turning assessment mode off is a workflow rollback on a migrated database, not a schema rollback.

## Staff workflow

1. In **Course → Edit → Module Catalogue → Exam rules**, review each module’s mode, Theory scheme, required supporting items and pass marks. Saving creates a new immutable version for future enrolments. The existing Course overview, module/term forms and term-grouped offerings are retained.
2. Only when needed, open **Exam rules → Advanced: existing enrolments → Review rules for existing enrolments**, filter by original teaching term and select the enrolment. Select a reviewed version, inspect the impact preview, and record a reason. Incompatible accepted items block the move. Existing attempt pass-mark snapshots remain unchanged. Neither the integrated nor the legacy student profile offers plan changes.
3. Use **Add exam score** for a missing or failed component. MCQ Theory is calculated from its configured items; Coursework/Viva requires a separately supplied combined Theory score. Supporting resit items require an explicit new score or named carry-forward selection. A known missing predecessor requires a reference and has no invented sequence.
4. Use **Correct result** in the assessment workspace for an eligible Manual or imported result. Imported correction atomically creates a linked Manual replacement on the same attempt, retaining immutable source evidence. Student, enrolment, component, sitting and pass-mark snapshot stay fixed. Use **Exclude result** / **Restore excluded result** in Results history for reasoned exclusions/restorations, not reassignment.
5. Schedule/cancel resits, defer/clear assessments after teaching ends, change module disposition, and set/clear exceptional status, indicator or credit overrides with reasons. Every save checks the enrolment revision. Reload after a stale-form error.
6. Manual matching, cross-student search/identity overrides and legacy source mutation controls are disabled, including direct administrator commands. Unmatched evidence remains pending reconciliation. No staff workflow currently reassigns that evidence.

Teachers have read-only projections. Source identity and source versions cannot be edited. Refreshes preserve administrator unmatching, reassignment, replacement and void decisions. Repeated source key/payload hashes are idempotent, including delayed retries of an already-observed payload. Changed normalized evidence appends a new source version.

Physics imports are retained as supporting evidence. Automatic pairing requires exactly one same-date physics result from the mapped sitting term; it never takes the latest physics score or silently carries a previous score forward. Otherwise the Theory source remains Unmatched for reconciliation. Sync physics before the corresponding Theory mapping. Unknown module/student identities and ambiguous teaching ownership also remain Unmatched; manual matching is not available.

An explicit imported resit hint with no predecessor stays Unmatched for reconciliation; it cannot currently be manually matched by supplying a Previous result unavailable reference. Imported attempt numbers never select the sequence. Refreshing a physics source updates only Theory evidence already explicitly linked to that source key, while the database continues to preserve administrative displacement decisions.

The adapter API requires an active administrator session and `x-assessment-reason` when the workflow is enabled, in addition to its existing shared-secret check. Import summaries distinguish created, unchanged, source-updated, auto-matched, unmatched and rejected records. CSV raw rows and Portal raw payloads are preserved in immutable source versions. After cutover, Portal sync does not overwrite legacy submission evidence.

## Reconciliation and backfill

Run `scripts/assessment-preflight.sql` against the intended dataset using a read-only database connection and export the result for administrator review. The script explicitly starts a read-only transaction. No deployed-data report has been run as part of this implementation.

In shadow mode, `/assessments/reconciliation` provides backfill exception and shadow-comparison CSVs. Review plans and assign inherited versions before backfill. Select reviewed eligible rows and supply a review reference. The RPC verifies the current legacy hash, direct ownership, source identity, predecessor chain and sequence. It preserves all originals and records an immutable backfill ledger. Retries do not create additional attempts. Existing newer/conflicting source evidence is never overwritten by backfill.

The following stay in review: ambiguous teaching enrolments, missing/duplicate predecessors, unsupported sequences, legacy `deferred`/`resit`/`did_not_complete`, contradictory result/credit values, and Theory rows without the supporting evidence their plan requires. Legacy Manual “Overall” scores are not reinterpreted as MCQ or Coursework/Viva inputs. Review those against original evidence and use reasoned Manual entry instead. Legacy Final mark and Grade never populate new scores.

Resolve or document every shadow difference. The comparison exposes complete new component projections, legacy/new statuses and credits, row counts and legacy hashes. Import reconciliation exports expose source payload hashes through the database projection and source versions; source payloads remain available in the register. Duplicate assessment-only teaching enrolments are reported, never automatically merged.

## Pilot and production gate

Production cutover is deliberately not performed by this change. Before enabling it:

- Review the deployed read-only exception report and reconcile/document all differences.
- Review all active module plans and assign a plan to every historical enrolment included in reporting.
- Complete shadow ingestion/backfill and compare source hashes, counts, component results, statuses, indicators and credits.
- Agree a cohort/module pilot with administrators and exercise initial pass, independent component resits, carried supporting scores, import replacement, deferral, override and pass reversal in a browser.
- Validate all three reports and the CCCU export, and obtain administrator sign-off and a verified backup/restore reference.

Only then call the Assessment Recording Module’s `setAssessmentRollout("live", evidence, reason)` from an authenticated administrator context. `evidence` requires non-empty references for `reconciliation_review`, `sanitized_rehearsal`, `pilot_signoff`, `backup_restore` and `module_plans_review`. The database additionally rejects cutover if a module/enrolment lacks a plan. Set the application environment to `live` after this gate. Do not manufacture sign-off references or treat synthetic test results as a production pilot.

Migration `0072` explicitly scopes the rollout update to its singleton row. The real Supabase/PostgREST rehearsal exposed that the earlier unfiltered update was rejected by safe-update protection even though owner-level SQL rehearsals passed. Do not disable safe-update protection to enable cutover; use the corrected guarded command. See [failure recovery and separate live-mode rehearsal](student-workspace-recovery.md) for the synthetic application-level drill.

After cutover, normal exports include accepted attempts only; withdrawn/unmatched/voided source records are excluded, while accepted Manual replacements are included. CCCU’s existing columns are retained, with original cohort, revision and current-result columns appended. `Term` represents the actual sitting term; the original teaching cohort is separate. Monitor conflicts, unmatched counts, overrides and pass-reversal history.

## Rollback

Set the application mode back to `shadow` or `off` to return to legacy reads. If legacy writes must resume, an administrator calls `setAssessmentRollout("shadow", {}, reason)` to release the database’s legacy write guards. All additive evidence, revisions, audits and backfill hashes remain. Changes made only in the new workflow are not copied into legacy fields; review/export them before an extended rollback. Do not drop tables or rewrite production records. Legacy removal remains separate issue #50 after its retention and sign-off gates.

## Implementation map

- `src/lib/assessment/`: typed command/ingestion/read interface, source adapters, feature mode and CSV projections.
- `0049`: versioned plans, immutable histories, RLS and plan inheritance.
- `0050`: protected canonical evaluator and outcome-history recalculation.
- `0051`: locked, reasoned administrator commands and plan-impact preview.
- `0052`: idempotent ingestion, source lifecycle projections, teaching-evidence hooks and legacy write guards.
- `0053`: conservative reviewed backfill, shadow comparison and audited rollout gates.
- `0054`: recalculation when attendance sessions, term dates, offering requirements, module configuration or enrolment requirements change.

Application adapters and actions never write assessment tables directly. Database-owner access is reserved for migrations/operations; ordinary administrator and teacher sessions cannot bypass the command interface with direct-table writes.
