# Student workspace release preparation

Current packaging position (2026-10-27): PR #56 is still draft at `aa922c0`, including the accepted Staff companion. Keep all that committed work. The subsequent safety fixes and historical continuity/protection (`0078`–`0079`) remain uncommitted and require a scoped follow-up commit/push, not a replacement of the earlier release. No new branch, merge or deployment is part of local packaging. The earlier student-only include/exclude lists below are archival, not instructions to remove Staff from this candidate.

The updated synthetic live-mode rehearsal passes seven groups through `0079`, including historical amendments, independent credits, unchanged source records and baseline restoration in official live reporting. Its database returns to shadow and its own stack is stopped with volumes retained. Clean-source packaging uses all regular, nonignored repository source files, a limited credential-pattern scan and SHA-256 manifest, checks that `0001`–`0048` match the pinned base, copies no credentials/local data/build output, and installs fresh dependencies. An unconfigured production build must reject demo fallback; a separately configured synthetic-target build is validation only and must never be promoted to Production. Candidate/result pointers remain gitignored in `.context/current-release-latest.json`.

Historical continuity follow-up (2026-10-27): the user approved preserving historical outcomes without retrospective attendance failures. The release requires migrations `0078_historical_assessment_records.sql` and `0079_historical_outcome_protection.sql` before the corresponding read/amendment paths are deployed, even when old assessment records are not backfilled. This is not authorization to apply production migrations or enable cutover. Existing branch-local safety fixes and these follow-ups must be included in the reviewed release commit; the earlier `aa922c0` build evidence does not cover them.

`0079` captures an immutable baseline for pre-existing, non-cancelled legacy enrolments: those without an assessment plan, with original exam results, or with recorded legacy status/credits/Final mark/Grade beyond the empty planned default. It does not use an inferred term/date cutoff and does not capture later-created enrolments. Confirm this capture scope/count under the approved maintenance window and writer containment before production migration; ongoing records already in that legacy cohort retain their baseline too. A historical plan/backfill is not consent to recalculate an old award. Outcome/credit amendments use reasoned, revision-checked administrator Exceptional decisions; clearing them restores the original baseline. Direct legacy academic-field edits remain blocked even in shadow/rollback mode. This is separate from the existing plan/reconciliation/cutover gates, which are not waived.

Prepared 2026-10-25 against `origin/main` at `562e3bc890b9dc5a99acb844ad3f714ab3930249`. This records local release preparation, not approval to commit, open a PR, merge, access real records or deploy.

Subsequent authorization: the user approved the scoped commit and PR, without merging or deploying, and identified Vercel as the host with likely main auto-deployment. Treat main as auto-deploying until verified otherwise. `vercel.json` disables automatic Git deployment only for `12amathew/connect-notion-pages`, using Vercel's documented branch-level `git.deploymentEnabled` setting. It does not disable main or alter production environment variables. Private Vercel preview environment settings have not been inspected; do not manually deploy the review branch or remove its deployment guard until preview database isolation is confirmed. The PR remains draft and blocked on the migration/release gates.

## Candidate boundary

### Combined release safety follow-up — 2026-10-26

The combined branch and draft PR head are `aa922c0`, retaining the student/assessment work and adding the accepted Staff companion. The original committed-source snapshot contains 432 files; its stored hashes were rechecked without differences. Its prior clean-install tests/build remain evidence for that commit, not for later edits. The earlier Staff exclusions below are historical and must not be used to assemble this combined release.

Authorized read-only hosting inspection confirms Vercel links this repository's `main` branch to Production with Git deployment creation enabled. The review-branch guard remains intact. Returned project environment metadata lists production-only configuration and no Preview database configuration; no isolated hosted preview has been verified. Sensitive values were not exported or changed. Supabase's recorded migration history still ends at `0048`, so the combined pending list is `0049`–`0077`, not only the three Staff migrations. No hosted deployment, database migration or application-record write was performed by these checks.

Two local release-safety fixes follow that inspection: configuration failures cannot serve the demo administrator or demo records outside development/tests, and a legacy presentation preflight supports inspection before the cancellation schema exists. These changes require final validation and inclusion in the reviewed release commit before merging; the existing `aa922c0` build does not contain them.

Production release must use only the reviewed migration files, never a Docker database dump, fixture script, `db reset`, seed or `--include-seed` operation. Default npm install/build scripts contain no database migration or seed step. Prototype code is retained as a development-only dependency, not a source of production records. Public database configuration is baked into the application build: build specifically for the approved target, never promote a synthetic-target artifact.

Both old and new application writers require coordinated containment: the new app needs the additive schema, while migrations `0075`–`0077` tighten legacy teaching writes. Before an authorized release, agree a maintenance/write-freeze window covering staff actions and external imports, verified database and private-object backups, and a compatible application rollback that preserves new evidence. UI flags alone are not a write freeze or schema rollback. Historical assessment/presentation exceptions still require an approved disposition; neither aggregate screening nor synthetic tests authorizes silent repairs.

Companion packaging update (2026-10-26): after functional/device review, the user authorized committing and pushing the staff companion into the same draft PR, and explicitly reiterated that the student directory/profile changes remain part of this branch. The exclusions below describe the earlier student-only candidate, not the newly authorized combined candidate. Retain the existing student/assessment commits and add the companion/shared integration, its tests/docs and migrations 0075–0077 on top. The current Staff route imports the development-only prototype, so include its source dependency; production cannot activate it with a variant parameter. Credentials and private/generated evidence remain excluded. This authorization does not permit merging, deploying or changing the branch deployment guard.

The original candidate was assembled from a mixed working tree at the main-branch base. The scoped implementation is now committed as `8cd4b88` in draft PR #56. Review subsequent fixes together with the full branch diff against `origin/main`. Do not use `git add -A`: unrelated Staff work remains local.

Include:

- Student directory/workspace, profile/photo, enrolment, attendance, teaching and finance integrations and their tests.
- Shared assessment commands, evaluation/projections, imports, histories, corrections, resits, exceptional decisions and reports.
- Minimal Course integration: exam rules within existing module editors and advanced reviewed changes for existing enrolments. No Course redesign.
- Migrations `0049`–`0074` in order; existing migrations `0001`–`0048` remain unchanged.
- Local Docker configurations, guarded launchers/rehearsals, browser harnesses, deployment/recovery documentation and the locked Playwright dependency.
- Existing development-only Students/Assessments prototypes and their shared switcher: current route imports still require these source files. Production cannot activate them through a prototype URL parameter.

Exclude:

- Unrelated Staff prototype files and changes to `src/app/staff/page.tsx`, plus the `staff:prototype` package script. Preserve them in the working workspace, but do not ship them with this release.
- `.context/`, private credentials/authentication state, real `.env` files, screenshots/logs, local databases, generated Next output, `node_modules/` and TypeScript build caches.
- The local Supabase migration symlinks and CLI state. The guarded launcher creates the migration link from repository source when starting an authorized local stack.

Repository-level ignores now protect `.context/` and TypeScript build caches without relying on this machine's Git exclude file. `assessment:prototype` uses the checked-in guarded launcher rather than a script that only exists in private workspace evidence.

## Local verification

An isolated source snapshot is assembled under `.context/student-release-2026-10-25-v2/`. `manifest.json` lists every included source file with SHA-256 hashes and explicitly records the candidate-only Staff exclusions. The original Staff work, branch and index are not modified.

Validation installs dependencies from the lockfile with `npm ci`, without copying the workspace's dependency directory, environment files or build output. It runs all unit/integration tests, lint, a production build with the new workflow disabled, and the local/live/browser environment guard tests. `validation.json` and individual logs record the actual command results. This is an uncommitted source-snapshot check, not hosted CI or a post-commit clean-checkout certification.

A limited private-key/token-pattern scan runs over the manifest before validation. No environment files except the empty/example template are included. A pattern scan is not a complete secret/security audit.

The final candidate contains 389 source files: 143 added and 28 modified relative to the pinned base, with 24 new migrations and all 48 earlier migrations unchanged. Fresh install, 618 tests across 56 files, lint, production build and seven environment/browser guard tests pass. All nine production-mode normal/prototype-query browser checks pass against the isolated synthetic stack; its temporary production server was stopped afterwards. Subsequent edits to rollout documentation record the deployment ordering discovered during preparation; they do not change the candidate's tested application code.

Production-mode routing is separately checked against synthetic local shadow data on a temporary port. This caught an old `variant` URL parameter bypassing the integrated profile. Prototype selection is now explicitly development-only across the directory, profile and Assessments routes, while intentional legacy views and edit routes remain available. Permanent feature-gate tests cover production, disabled and invalid-variant cases; the local browser check covers normal and prototype-query routes.

## Source-review corrections

The release review found two correctness blockers, reproduced with failing PostgreSQL integration tests. Migration `0073` compares incoming payloads with the latest source version, allowing A → B → A to append a third immutable version while consecutive repeats remain idempotent. Administrative replacement, void and unmatch decisions remain effective. This assumes current snapshots, not unordered source events; see the ordering limitation in the assessment rollout runbook.

Migration `0074` bases repeated-teaching carryover on effective outcomes rather than stale legacy statuses, with a fallback for unplanned legacy enrolments. Changes to eligibility update later enrolment projections, history and optimistic revisions. Regression cases cover failed, deferred and abandoned modules, overrides and clearing, stale-draft rejection, retained historical snapshots, separate repeat scores/credits and legacy fallback. All 163 assessment integration tests pass. The synthetic Docker rehearsal through all 74 migrations, concurrency, cutover/rollback and SQL backup restoration passes; no real records were used.

These corrections do not redesign Course, enable manual matching, authorize a deployment or replace final release review.

## Remaining release gates

- Complete final review of the full release and source-review corrections, including security/RLS boundaries and the final migration inventory. Spot checks and passing tests do not replace that review.
- Confirm the supported staff-browser/device acceptance scope; the user has accepted the tested Students/profile workflows and asked to preserve familiar Course management. Automated WebKit is not a physical Safari/iOS check.
- Hosting is Vercel; the user believes main auto-deploys, so treat it as enabled. Confirm preview database isolation and the exact production deployment controls before any preview deployment or merge. No checked-in GitHub Actions workflow or run was found; local checks are not hosted CI.
- Do not deploy this candidate against the old schema, even with both feature flags disabled. `getLmsData` now reads `active_module_enrolments` unconditionally, and legacy photo changes use the new revisioned photo RPCs. The full additive schema is a prerequisite for running this release against live data. If main auto-deploys, defer merge or explicitly pause that deployment integration until the authorized migration/deployment window; do not treat feature flags as schema compatibility.
- Commit/PR authorization is now granted, but merge/deployment authorization is not. Stage only the agreed candidate, preserving unrelated Staff work, then verify the exact committed tree and hosted checks before any merge authorization.
- Keep `ASSESSMENT_WORKFLOW_MODE=off` and `STUDENT_WORKSPACE_ENABLED=false` for any initial code deployment until the corresponding database and rollout gates are satisfied. Existing environment values must be checked by the authorized release operator; repository defaults do not override hosting configuration.
- Obtain separately authorized read-only real-data preflight, reviewed historical/module decisions, verified backups, additive migration/shadow validation, pilot and live cutover. Follow the [ordered release checkpoints](student-workspace-release-checkpoints.md); no synthetic sign-off is production sign-off.
