# Student workspace recovery and retained private photos

This runbook is for the isolated synthetic development environment. Production access, retention policy, backup handling and deletion require separate authorization. Never reset the review stack or use another existing local project's database to run these checks.

## Interrupted saves

- A visible success is not the only evidence of a committed save. A request can commit before its response is lost.
- Student creation retains a stable request/student identifier for the open draft. Retry that unchanged draft to recover the original record, not a second student. Do not close it and start another creation until the directory has been checked.
- Enrolment, result, attendance, teaching and finance mutations use revision/token or identifier guards. A rejected retry is not permission to silently fetch a newer revision and repeat the write. Reopen, inspect the current record and its audit, and decide whether another change is still required.
- After an uncertain photo save, retain the selection, reopen the editor and inspect the saved thumbnail. A stale draft cannot overwrite the committed reference. Never delete a possibly committed upload merely because the caller received a network error.
- If a new photo is saved but cleanup fails, the new reference remains authoritative and the previous private object stays for operator review. A cleanup warning must not be presented as a failed profile save.

## Private-photo inventory and retention

`scripts/student-photo-retention.sql` is a read-only inventory of the `student-photos` bucket. Run it only against an explicitly authorized target; in this workspace that is `supabase_db_assessment-yangon-49`, database `postgres`. Save output under `.context/`, not source control or public issue comments.

The report includes object age/size, current student references, managed-file references and recent photo audit evidence. Every disposition is retention or manual review; there is no automatic orphan deletion command or default retention period.

Before any separately approved cleanup:

1. Review current student and managed-file references, all relevant audit evidence, pending/in-flight saves and other legacy/admissions workflows. A missing reference in one snapshot is not proof that deletion is safe.
2. Keep referenced, ambiguously owned and unconfirmed files. Use a write-quiescent maintenance window for any deletion decision to avoid a reference being attached between inspection and removal.
3. Obtain the responsible owner's retention decision and backup authorization. Do not invent a retention period or use this development evidence as production approval.
4. Back up both database metadata and private object bytes, including bucket/key, content type and checksum. A PostgreSQL dump contains storage metadata, not image bytes. Store backups privately under the agreed retention policy.
5. Recheck references immediately before a reviewed deletion. Delete only explicitly approved keys through the Storage API, not by removing `storage.objects` rows. Record operator, reason, keys, evidence and outcome; retain failures for investigation.

## Reproducible local tests

`npm run student-workspace:recovery:smoke -- .context/assessment-browser/login.json` exercises real local browser, Server Actions, PostgreSQL and private Storage operations. It drops a request before dispatch and drops responses after confirmed server completion. It also installs uniquely named, temporary fault triggers scoped to the freshly created synthetic student's ID/path to reject upload, photo save and cleanup independently. The `finally` path removes these triggers; no global permissions, bucket settings or rollout flags change.

If the process is forcibly killed, inspect its printed `recovery_fault_<fixture token>` name. Remove only that run's trigger on `public.students` and `storage.objects`, then its matching function, from the authorized local database. Do not broadly remove triggers. Normal runs remove them automatically even after an assertion failure.

Each run retains a fixture, screenshots, result manifest and photo inventory under `.context/student-recovery-review/<id>/`. It deliberately retains the synthetic old photo from the cleanup-failure case. It also restores backed-up private bytes to a separate disposable key, compares the download, then removes only that disposable key; the current photo remains untouched. This is an object-level recovery check, not proof of a coordinated production point-in-time restore.

`npm run assessment:rehearse` separately exercises the full database migration/backfill, concurrent assessment commands, local database live/shadow handover and SQL backup restoration. See [assessment rollout](assessment-workflow-rollout.md). The regular review application stays in shadow mode.

## Separate live-mode application rehearsal

The user authorized a second disposable synthetic stack on 2026-10-25 so the review stack's deliberately incomplete-plan fixtures do not need to be changed or bypassed. Its fixed project is `assessment-yangon-live-rehearsal`, API `127.0.0.1:57321`, database `57322`, shadow port `57320`, application `127.0.0.1:3102`. No existing unrelated stack is used.

Configuration is in `dev/assessment-live/supabase/config.toml`. Link its `supabase/migrations` directory to the repository's `supabase/migrations` (the same arrangement as `dev/assessment`), then start with `supabase start --workdir dev/assessment-live -x realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`. Seeds are disabled. Apply later repository migrations with `supabase migration up --local --workdir dev/assessment-live` only after checking this exact target. Do not use reset.

`npm run assessment:live:test` validates the project's strict target and side-effect guards. `npm run assessment:live:rehearse` refuses an occupied port 3102, creates uniquely identified synthetic fixtures, and starts/stops its own application process for off/shadow/live and workspace-flag checks. Portal endpoints, adapter secrets and outbound admissions email are disabled. Its Next output is isolated under `.context/assessment-live-next`; the review server on 3100 is not stopped. Next may add generated type paths to `tsconfig.json`/`next-env.d.ts`; remove only the rehearsal-generated paths before final validation and do not commit them.

Artifacts and private, randomly generated synthetic login credentials are under `.context/assessment-live-review/<id>/`; login files are created mode 0600. Never publish them. The harness returns its database to shadow mode and stops its own application process in `finally`, retaining fixtures and audit evidence. If forcibly interrupted, first verify the exact live-rehearsal project, then restore its database to shadow through the authenticated rollout command; do not change the main review project's rollout state. Synthetic gate references explicitly say they are not production sign-off.

Keep both stacks' data volumes for inspection. If the disposable live stack is no longer needed, `supabase stop --workdir dev/assessment-live` stops only that project and retains its volumes. Volume destruction remains a separate decision.

## Rollback decision

Before returning a live system to legacy reads, stop conflicting writes and export the accepted new-workflow outcomes/history, audit and reconciliation differences. Retain all additive tables and object backups. Flag rollback does not copy new results, cancellations, overrides or revised credits into legacy fields; those differences require an explicitly reviewed operating/reconciliation decision. If the legacy view would mislead staff, prefer a controlled read-only pause until that decision is made instead of silently resuming legacy writes.
