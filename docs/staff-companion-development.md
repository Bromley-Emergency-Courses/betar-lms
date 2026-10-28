# Staff companion development

Scope: [#57](https://github.com/Bromley-Emergency-Courses/betar-lms/issues/57), read-only integration [#58](https://github.com/Bromley-Emergency-Courses/betar-lms/issues/58), encounters/formative [#59](https://github.com/Bromley-Emergency-Courses/betar-lms/issues/59), presentations [#61](https://github.com/Bromley-Emergency-Courses/betar-lms/issues/61), calendar plans [#62](https://github.com/Bromley-Emergency-Courses/betar-lms/issues/62). This is a connected synthetic review build, **not production rollout approval**.

## Connected capabilities

- Dedicated Overview / Student / Add record destinations now share a focused, full-width staff shell on phone/tablet/desktop, with a persistent touch-sized navigation bar. The normal LMS menu/sign-out remain available through App menu; other LMS screens keep their existing shell. Student and Add record offer a term-scoped searchable/paginated picker if no student is selected. Add record selects an eligible module and reuses the same guarded teaching/planning popups, not another write path. Existing student URLs and module-card actions continue to work.
- Phone/tablet module overview and term matrix retain All / Here today / At risk, search, term/module filters and actual check-in highlighting. Term attendance uses canonical distinct-date/partial-day/carryover totals (maximum across modules, not their sum). Expectations never count as attendance or current presence.
- Profiles group enrolments by original teaching term and show canonical Theory/Practical results read-only. Zero, Pending, N/A and unavailable/unreviewed plans remain distinct. Resits, overrides and carried evidence stay owned by the existing assessment module; no duplicate academic evaluator or result store is introduced.
- Eligible modules offer encounters, configured formative scores, presentation scoring and planning. Encounters show staff, module, term, concern and comment. Dialogs preserve drafts on errors and warn before discarding. Touch fields are 16px with 44px targets.
- One actual presentation event belongs to one enrolment. Two modules may present on the same day. Multiple assessors share that event; each author submits once. Reopening an already-scored offering edits that author's submission. Duplicate responses direct staff to discard/reopen and edit, never silently replacing a draft. Main-profile and companion record cards expose **Edit your score** only for eligible own submissions.
- All ten rubric criteria, manual whole-point time penalty and recorded final total appear in main/companion/legacy readers. The popup previews subtotal/deduction/final with numeric input and +/− buttons. The server validates and calculates the saved final. No duration threshold, averaging or exam formula is invented. Discrepant legacy totals remain unchanged and labelled for reconciliation; ordinary editing cannot repair them silently.
- Teachers plan/move/cancel attendance using existing `expected_attendance`. Attendance is term-wide; an eligible module supplies active teaching context, not attendance ownership. Presentation plans choose a module and existing session independently. Changing one does not remove the other or another module's plan. Module cards and the matrix distinguish module-labelled planned presentations from performed evidence. Attendance history remains term-filtered with plans visually distinct.

## Eligibility and permissions

Ordinary teaching/plans require an active student, catalogue module and term, a reviewed assessment plan and non-cancelled enrolment. Planned, In progress and **Fail** are eligible. Pass, deferred, abandoned, cancelled and explicit assessment deferrals are blocked; overrides cannot bypass holds. Calendar administration and actual-attendance corrections remain with existing authorized workflows.

The user-approved exception permits additional assessors and author-owned edits to an **existing local presentation** after Pass, while its original term remains active. No new event, encounter, formative entry or plan is allowed through that exception. A later enrolment never unlocks historical evidence. Accepted carryover is Complete and does not offer another presentation plan. Actual date/type/duration/ownership are immutable in ordinary edits; administrators have no author-edit bypass.

Server entry points require `record_teaching`; database role/ownership checks and transactional revalidation remain authoritative. Legacy forms use the same guarded RPC instead of direct inserts. Raw authenticated evidence mutations and private helper execution are denied. Reception/anonymous users cannot use the companion. Application reads use authenticated clients, not a service role.

## Additive schema and reconciliation

Deploy migrations and compatible application readers/actions together; exposure flags do not remove schema dependencies:

1. `0075_staff_teaching_eligibility.sql`: shared eligibility and raw-write protections.
2. `0076_presentation_scoring.sql`: immutable events, compatible score links, per-author uniqueness, revisions and penalties. Links only unambiguous legacy groups with complete consistent metadata and distinct authors. Original IDs/authors/rubrics/comments/totals and academic history are preserved; ambiguous/cancelled/incomplete groups remain unlinked/read-only. Linked rubric/total differences need explicit reconciliation. Read-only preflight: use `supabase/checks/presentation-preflight-legacy.sql` on the legacy baseline before migration `0067` (including `0048`); it explicitly marks cancellation checks as not applicable. From `0067` onward use `supabase/checks/presentation-preflight.sql`, including before and after `0076`. Never apply a migration just to enable inspection.
3. `0077_staff_teaching_plans.sql`: one revisioned nullable session pointer per enrolment in `presentation_plans`. Mutable intent is separate from immutable performed evidence; it creates no completion. Cancellation retains the revision/audit. Completed/carried presentations suppress superseded plans without deleting history. Ownership/term reassignment is guarded. Attendance reuses expectations and existing session/student-session revisions. No calendar/actual-attendance privileges are added.

Plan snapshots include eligible enrolments, plan revisions and calendar/attendance revisions. Writes lock/recheck context. Author edits require expected score revisions. Concurrent first assessors cannot create two events; losing drafts reopen the winning event's immutable metadata. Duplicate retries return the original submission. Changes are audited atomically; failures roll back.

Locally, 0076 was rehearsed and rolled back before permanent application **only to `assessment-yangon-49`**, following a fresh backup/preflight. Before/after hashes verified all original presentation evidence and academic history were unchanged. Migration 0077 followed a separate backup. Private backups: `.context/staff-teaching-backup/before-0076-apply.dump` and `.context/staff-teaching-backup/before-0077-apply.dump`. No reset, production operation, merge or commit was performed. Repeat target-specific reconciliation/backup through the approved production release procedure; synthetic results do not establish production data quality.

## Local preview

The default-off companion requires `STAFF_COMPANION_ENABLED=true`, `STUDENT_WORKSPACE_ENABLED=true` and assessment shadow/live mode. Teaching/planning additionally require default-off `STAFF_COMPANION_TEACHING_ENABLED=true`. Academic results remain read-only even for administrators. Flags do not change the live assessment sign-off gate.

Use only the isolated stack in [Student workspace development](student-workspace-development.md):

```sh
npm run assessment:local -- check
STAFF_COMPANION_ENABLED=true STAFF_COMPANION_TEACHING_ENABLED=true npm run assessment:local -- serve shadow 3100
```

Do not start another server on an occupied port. The guarded launcher verifies the local target and disables outbound email/Portal integrations. Stop the owned dev server before building/running a compiled preview in the same `.next` directory:

```sh
STAFF_COMPANION_ENABLED=true STAFF_COMPANION_TEACHING_ENABLED=true npm run assessment:local -- build shadow 3100
STAFF_COMPANION_ENABLED=true STAFF_COMPANION_TEACHING_ENABLED=true npm run assessment:local -- serve-built shadow 3100
```

Connected view: `/staff`. Existing workflow: `/staff?view=legacy`. Fictional prototype: `/staff?variant=A` (development only). Use existing private synthetic teacher/admin credentials; never commit them. Latest successful review URLs are in `.context/student-teaching-review/companion-latest.json` and `.context/staff-planning-review/latest.json`. Turning flags off reverts exposure, not database protections; no destructive schema rollback is automatic.

## Read boundaries

Overview reads selected-term identity/catalogue and authoritative compact assessment summaries, filters/paginates 20 students, then fetches evidence/plans for that page. This is **not database-side roster pagination**: compact term summaries are scanned for correct cross-module filters/counts. Profile history is scoped to one student. DTOs omit finance, admissions, import sources and override/audit payloads. `readAssessmentSummaries` stays inside the existing assessment module and live gates.

Assessor rows/plans never increase canonical completed-presentation counts. Actual matrix labels deduplicate module/date; conflicting legacy dates remain visible. Historical genuine enrolments stay readable; added-in-error cancellations remain excluded.

## Validation

2026-10-26 checkpoint: **63 Vitest files / 747 tests**, seven browser-helper tests, TypeScript, affected ESLint and guarded production build pass. Chromium and WebKit pass twelve teaching/presentation groups and three planning groups. These include actual concurrent PostgreSQL RPCs (first assessors, duplicate retries, author edits and plans), permission checks, stale drafts, manual penalties including zero finals, independent same-day modules, legacy/main/companion parity, and phone/tablet layouts.

Navigation follow-up: the user confirmed the functional review in chat. The remaining prototype-navigation gap is now connected rather than deferred: three destinations, remembered selected student across destination changes, searchable student switching, module-scoped entry and a focused shell. Four new unit cases bring the suite to **751 tests**. The navigation browser journey checks 320/390/820/1180px layouts, draft protection, retained student/roster context, passed/historical restrictions, and App menu accessibility in Chromium/WebKit. This functional acknowledgement is not production approval or a separately documented physical-device sign-off.

Release-readiness follow-up (2026-10-26): **751 tests and twelve browser-helper tests pass**. Chromium and WebKit each pass **fifteen teaching/presentation groups and four planning groups**, now including dropped pre-server requests and lost post-commit acknowledgements. Encounter drafts survive; a committed encounter changes the enrolment snapshot so an unchanged retry is rejected and reopening shows exactly one record. Repeated presentation submission directs the author to the existing score; stale author edits cannot create another revision. Plan retries cannot overwrite committed intent. The tests inject network faults only into the isolated preview; no database fault triggers or runtime-error suppression are used. Early harness assertions were corrected to match the existing stale-snapshot contract and collapsed record cards, without weakening application guards.

A fresh disposable PostgreSQL migration rehearsal passes through **0077**, preserving original legacy rows and comparing assessment evidence/audit/rollout after separate SQL restoration. The review database is retained, not reset. Evidence: `.context/assessment-rehearsal/assessment_rehearsal_49_1793048614758/`. The rehearsal contains synthetic data only and does not back up private image bytes or certify production recovery.

The combined candidate is also checked from a private source snapshot with `npm ci`, the full test suite/lint, a production build with exposure disabled, and local/live/browser guard tests. It retains imported development-only prototype source and copies no private environment, credentials, dependencies or generated build output from the working tree. The latest manifest/results are selected by `.context/companion-candidate-latest.json`; this is an uncommitted source-snapshot check, not hosted CI or approval to include unrelated work in a commit.

Source-review follow-up (2026-10-26): separate standards/spec reviews covered the companion working-tree additions and shared integration changes, with the committed student/assessment work as context. Standards found no documented violation and one optional duplication of presentation-field parsing (deferred, not a correctness defect). Spec review found one misleading risk label: canonical module `Fail` can arise from attendance/presentation noncompliance or an override, not just a failed assessment score. The companion now says **Module failed**, preserving canonical specific indicators, status and At risk membership. Three regressions cover attendance-only, presentation-only and overridden failures with passing component scores. The full suite now passes **754 tests**; TypeScript, affected lint and the guarded build pass. No academic rule, eligibility guard, schema or existing evidence was changed. The spec finding was re-reviewed as resolved; no further high-confidence spec blocker was identified within the reviewed scope.

```sh
npm test -- --maxWorkers=2
npx tsc --noEmit
npm run student-workspace:browser:test
npm run student-workspace:teaching:smoke -- .context/assessment-browser/login.json --companion
npm run student-workspace:teaching:smoke -- .context/assessment-browser/login.json --companion webkit
npm run staff:planning:smoke -- .context/assessment-browser/login.json
npm run staff:planning:smoke -- .context/assessment-browser/login.json webkit
npm run staff:review:fixtures -- .context/assessment-browser/login.json
npm run staff:navigation:smoke -- .context/assessment-browser/login.json
npm run staff:navigation:smoke -- .context/assessment-browser/login.json webkit
```

Fixtures are retained rather than resetting the review database. Planning adds fixture-owned future sessions to the existing active synthetic term without changing its shared dates/status or another student's data. Those artificial future dates exercise planning; they do not establish real calendar readiness.

### Focused review cohort

The guarded `staff:review:fixtures` command adds three clearly named synthetic students and writes their filtered overview URL to `.context/staff-review/cohort.json`. It retains an existing cohort on rerun rather than resetting or overwriting it. No existing student or shared term is edited. Use that URL instead of the unfiltered engineering-test roster:

- **Alex Morgan:** actual presence on the fixture creation day, an encounter, two active modules and two presentation plans on the same future teaching day. Attendance is shared across modules.
- **Sam Taylor:** a failed Theory result, teacher-owned presentation score with a three-point penalty, and a passed second module whose existing presentation can accept another assessor. Use the teacher account for own-score editing.
- **Jordan Ellis:** passed current and historical Theory-only enrolments. Practical is N/A; completed/historical modules do not offer teaching input.

Dates/statuses still come from the existing synthetic active term, which may have historical calendar bounds; this deliberately does not reconfigure another review's term. Here today is genuinely date-sensitive and disappears after the fixture day. These are test cases, not real student records. New UI review can focus on navigation, student/module selection and phone/tablet readability; the accepted functional workflows are not being replaced.

The resolved WebKit investigation [#60](https://github.com/Bromley-Emergency-Courses/betar-lms/issues/60) concerned tests hard-reloading while action/refresh streams were pending. Helpers now track request start/finished/failed events and require a fresh quiet interval before deliberate hard navigations. No runtime errors are suppressed or application router/prefetch behaviour changed. Unconditional `response.finished()` is unsuitable when Chromium cancels a consumed Flight tail.

## Human acceptance and release gates

- Staff reviews phone/tablet task flow, readability, manual penalty policy, original-term history/results and the Fail/Pass exception against the approved prototype.
- Physical iPad/Safari: the user explicitly confirmed that rotation, scrolling the scoring popup and using the numeric keyboard passed on 2026-10-26. This is human device acceptance for those checks, not inferred from Playwright WebKit. The device model/OS version and real interrupted-connectivity results were not supplied; no broader certification is claimed.
- Authorized maintainers perform production preflight/reconciliation, representative-cohort performance review, backup/release sequencing and independent assessment/workspace gates (#49/#51/#56).
- Review additive migrations and main-profile integration in the existing draft PR. No merge, production migration or live cutover is authorized here.

## Companion release handoff

Packaging authorization (2026-10-26): the user approved committing and pushing the companion changes into the existing draft PR, without merge or deployment. They reiterated that the student directory and profile updates already on the branch must remain included. Package the combined branch, preserve its existing commits and deployment guard, and update the PR scope rather than replacing the student work. The earlier development checkpoints describe their then-uncommitted state; release/production gates remain separate.

Use the existing [ordered release checkpoints](student-workspace-release-checkpoints.md); this companion does not replace the independent student-workspace/assessment release. Staff operating instructions, including interrupted saves, are in [Staff Teaching](staff-user-guide.md#staff-teaching).

1. **Freeze the reviewed source scope.** Inventory the companion files, shared profile/teaching changes, tests, scripts and migrations 0075–0077 together with the existing branch work. Do not use the earlier student-only candidate assembler unchanged: it deliberately restores the old Staff route and excludes the Staff prototype. The current Staff route imports that development-only prototype, so its source is a build dependency unless an explicitly reviewed change removes the import. Preserve it in the workspace. Exclude private `.context` evidence, credentials, environment files, generated output and database dumps from any commit. No broad staging or commit is authorized by this checklist.
2. **Review the final candidate and deployment controls.** A local source snapshot is not a committed-tree or hosted-CI certification. Obtain the combined source/migration review and any outstanding device acceptance. Keep the existing branch-level Vercel deployment guard; treat main as auto-deploying until the release owner confirms otherwise. Do not merge or manually deploy a preview connected to an unverified database.
3. **Obtain target-specific read-only reconciliation approval.** Select the baseline-compatible preflight described above and run it only on an explicitly approved target. Review duplicate authors, missing/ambiguous owners, cancelled-enrolment scores where the cancellation schema exists, conflicting/incomplete event metadata, invalid rubrics and discrepant totals. Before 0076, unlinked scores are expected; afterwards, unresolved groups must remain held/read-only with an approved disposition. Do not infer metadata, merge authors or recalculate historical totals. Check active module assessment plans and real calendar dates separately. Synthetic performance or reconciliation is not production-shaped evidence.
4. **Authorize and rehearse the coordinated release window.** Verify the exact migration state, current backup and restore procedure, then deploy the prerequisite schema and compatible readers/actions in an agreed sequence. Raw-write revocations affect legacy teaching, so leaving old application writers running against the new schema is not a safe steady state. Schema dependencies exist even when all companion flags are false. Pause affected writes/deployment as needed; never use a flag flip as a schema rollback.
5. **Validate with exposure disabled before a pilot.** Start with `STAFF_COMPANION_ENABLED=false` and `STAFF_COMPANION_TEACHING_ENABLED=false`, respecting the independent workspace/assessment gates. Verify existing staff/profile readers and guarded legacy teaching actions. After approval, enable the read-only companion first, compare the same students/terms against the main profile, then enable companion teaching for the agreed pilot. Retain permission, ownership, same-day multi-module, penalty and independent-plan checks.
6. **Stop safely on a release defect.** Disable companion teaching/exposure to contain its UI, but recognize that shared main-profile/legacy teaching remains separately available. Permission or evidence-integrity failures require stopping the affected write path, not merely hiding the companion. Keep additive events/scores/plans, revisions and audits. Do not drop tables or restore an old database over newer evidence. Application rollback must remain compatible with migrated guards/schema; preserve and reconcile any post-release writes before an authorized recovery. Assessment live-mode rollback remains governed by its own runbook.

Physical-device acceptance can be brief and use only synthetic students: in Safari on the intended iPad, rotate a dirty presentation dialog, scroll all ten rubric criteria, use the numeric keyboard and penalty steppers, switch/focus fields, and confirm Keep editing/Discard behaviour. Test loss of connectivity before and after pressing Save, then review the persisted record before retrying. Record the device/OS/browser and outcome. Browser-engine simulations below support, but do not replace, that check.
