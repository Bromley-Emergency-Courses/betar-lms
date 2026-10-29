# Limited public reopening

The owner approved reopening for everyday teaching while assessment cutover is deferred. This is not live assessment authority or approval to activate the 86 current enrolments.

Keep `ASSESSMENT_WORKFLOW_MODE=shadow` and the Students, Staff and Staff teaching flags enabled. Set `ASSESSMENT_OPERATIONS_PAUSED=true` for the visible notice and read-only assessment controls. Independently enable `assessment_operational_controls.writes_paused` using a reviewed database-owner release transaction; application roles cannot change that control. The UI flag alone is not a write barrier.

Migration `0083` installs the control disabled. When enabled, database triggers reject both legacy and new exam results, sources/imports, decisions, arrangements, historical backfill, current-enrolment activation, course/term/plan changes and enrolment creation/removal/academic edits. These restrictions also apply to direct database API writes and old browser tabs. Existing permissions still apply; the control grants no new access.

Observations, formative teaching records, presentation scoring and edits to one's own submission, teaching plans, attendance, finance and ordinary profile editing remain available under existing eligibility and permission checks. Enrolment projection/revision updates are accepted only when they exactly match the normal evaluator, allowing teaching recalculation without arbitrary outcome changes. Original historical academic fields and credits remain protected. Admissions operations which create enrolments cannot complete while enrolment creation is paused.

Before reopening, refresh encrypted backup/recovery, rehearse `0083` on that isolated recovery and on synthetic data, verify every original public table is unchanged, test teacher observations/presentations and denied exam writes, and promote only the compatible tested source. Retain LMS authentication and role checks; do not expose the old public deployment by merely removing maintenance.

Later assessment work must use a fresh snapshot: staff teaching, finance and profile records may now have changed legitimately. Do not restore the earlier backup, reuse a stale activation preview, silently clear the pause, or overwrite daytime activity. Keep all audit evidence. Re-review the remaining activation/reconciliation/import/export/sign-off gates before separately authorizing assessment reopening. The public website being available does not mean the full assessment rollout is complete.
