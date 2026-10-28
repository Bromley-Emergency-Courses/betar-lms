# Current-enrolment assessment activation

This is a narrowly reviewed transition, not a historical backfill or assessment live-mode cutover. Installing migration `0082` activates **zero** enrolments. It adds administrator-only preview/apply RPCs and an immutable activation ledger; no seeded identities, student rows, results or cohort IDs are embedded in the migration.

## Agreed scope

The owner approved preparing the transition for the 86 identified current-term ongoing enrolments. This count describes the reviewed inventory, not a permanent query result or permission to activate other records. Revalidate the exact IDs before a separately authorized production operation; stop if any row's eligibility or preview changes. Preserve the intentional finance edit and all unrelated records.

The approved global module plans remain the only source of exam configuration. Departmental Leadership and Evidence to Implementation use online Coursework/Viva; Image Acquisition and Optimisation uses online MCQ without physics or Practical; the other approved practical modules use weighted MCQ/physics Theory plus Practical. The migration contains no hard-coded course names or changes to Course configuration.

Eligibility requires all of:

- An immutable original baseline recorded as Planned or In progress, with no final mark or grade, matching the protected legacy fields.
- Active student and module, active term, and today's date within that term.
- No cancellation, previous activation or previously assigned enrolment assessment plan.
- A currently selected, same-module global assessment plan whose mode agrees with the module.
- No original exam results, modern attempts, exceptional-decision history (including cleared decisions), arrangements, dispositions or retained evidence of those records.

Teaching evidence does not disqualify a genuinely ongoing enrolment. It is included in the preview's calculation/freshness checks; missing teaching evidence is not invented. Unmet attendance/presentation requirements do not fail an unfinished term, but may affect the outcome after its end under the existing rules.

## Authority and credits

An activated enrolment uses the existing modern evaluator and command invariants for new attempts, resits, corrections, arrangements, warnings and outcomes. The original baseline and legacy academic fields remain immutable. Activation persists after the teaching term closes so a later-term resit does not become historical/read-only again.

Positive credits recorded in the baseline remain awarded independently of the calculated outcome. A new Fail can therefore coexist with the existing 10-credit award, as explicitly requested. Only an audited credit override changes that award; clearing it restores the preserved award, not automatic zero. Records whose baseline has zero credits use normal modern credit calculation. Outcome and warning overrides do not implicitly alter a preserved award.

The assessment projection distinguishes `activation.original_record` and `activation.preserved_credits` from current calculation, instead of pretending the whole assessment is still historical/read-only. Student results/history, assessment exports and shared Staff/risk projections retain that distinction. Private activation reasons and reviewed snapshots are administrator-only. Existing archival outcome protection remains unchanged.

## Transaction and access boundaries

`preview_current_assessment_activation(enrolment_keys)` accepts an explicit, unique batch of 1–200 UUIDs. It returns the authenticated actor, review date, expected revisions, global plans, before/after projections, original baselines and freshness fingerprints. It performs no writes.

`activate_current_assessments(enrolment_keys, reviewed_preview, change_reason, confirmed)` requires an active administrator, explicit confirmation and a nonblank reason. It locks relevant academic/context tables, then regenerates and compares the complete preview. Duplicate, stale, changed-plan, changed-teaching and mixed eligible/ineligible batches fail atomically. A five-second lock timeout or deadlock also fails without partial activation. Review again rather than retry blindly.

Only after all eligibility/freshness checks pass does it append one immutable ledger entry per enrolment, assign the reviewed global plans, recalculate the selected projections and append history/audit events. It does not change original statuses, original credits, original marks/grades, attendance records, finance, course settings, rollout mode, hosting or authentication.

Ordinary commands on activated records use the existing guarded command chain below the archival reconciliation wrappers. This does not bypass administrator/reason/revision, score, source, resit, correction, cancellation or ownership guards. Non-activated records still use all historical wrappers. No direct table-write or machine-token permission is granted.

## Local verification

- `npm test`: migration installation has no enrolment-row effects; eligibility, stale scope, admin/teacher access, immutable provenance, credit policy, practical teaching requirements, Coursework/Viva, corrections, pass reversal, archive preservation and exports.
- `npm run assessment:rehearse`: fresh synthetic Docker migration/backfill/concurrency/cutover/rollback/recovery regression suite, automatically including `0082`.
- `node scripts/assessment-current-activation-smoke.mjs`: uses only the separately configured disposable `assessment-yangon-live-rehearsal` Docker stack on loopback ports 57321/57322 and app port 3102. Start that stack and apply local migrations first. It retains existing fixtures, refuses an occupied app port and refuses to change an existing active term that is not current. External Portal/email are disabled. Despite the stack's name, this rehearsal app runs in **shadow** mode and does not authorize production live mode.
- The focused smoke creates synthetic accounts/records, checks concurrent activation and teacher denial, then exercises actual browser result entry, scheduled resit, retained failed-attempt history, correction, credit override/restoration, exports and teacher read-only access. It also restores a synthetic database dump into another isolated local database and compares activation/baseline/attempt/revision/item/history/decision/audit evidence. Artifacts stay in `.context/`.

These synthetic checks do not replace fresh encrypted live recovery and preserved-snapshot checks for the production release.

## Production gate and recovery

Do not run local fixture code against production, bulk assign plans, remove baselines or fabricate rollout sign-offs. This transition neither satisfies the all-enrolments-plan live gate nor changes official shadow export authority. Archive disposition, genuine pilot/reconciliation sign-offs, public reopening and live assessment authority remain separate gates.

Before a production proposal, pin the reviewed code and migration hashes; refresh authorized read-only inventory and encrypted recovery evidence; compare every original academic record and intentional finance change; identify the exact reviewed cohort/global-plan IDs; and obtain separate migration/deployment/activation approval. Use the administrator's normal authenticated session for preview/apply. Never substitute a service-role write or fabricated session. Do not put private previews or cohort IDs in Git.

After any uncertain network response, inspect the immutable ledger/audit before deciding whether another operation is needed. A repeated successful request is deliberately rejected, not treated as a new activation. Verify original data remains unchanged and that only the approved plan pointers, activation ledger, projections/history and audit entries were added.

Rollback must retain all accepted evidence. Before activation, the application can remain on the prior protected review build because the migration alone changes no existing projection. After activation, do **not** delete the ledger, clear plan pointers or deploy an old UI that reclassifies/hides new attempts. Keep public maintenance, pause recording, retain additive evidence and use a separately reviewed compatible forward fix or recovery plan. Restoring a pre-activation database would discard later legitimate activity and is not an automatic rollback strategy.
