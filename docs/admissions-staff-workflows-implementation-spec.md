# Staff Admissions Workflows Implementation Contract

Last updated: 2026-08-08

Status: approved for implementation planning

This document is the authoritative implementation contract for the redesigned staff Admissions experience. It consolidates the validated Wayfinder decisions and prototypes for new-student admissions, returning-student admissions, shared navigation, operational actions, correspondence, and cutover.

Where this contract conflicts with historical staff-workflow descriptions in `docs/admissions-workflows-spec.md` or `docs/admissions-workflows-roadmap.md`, this contract takes precedence. Applicant- and student-facing redesign is outside its scope, but the existing applicant and student journeys must continue to support the workflow transitions described here.

## Outcomes

The implementation is complete when one admissions administrator can:

- understand new-student and returning-student workload and stages at a glance;
- search, filter, sort, page through, and act safely on hundreds of records;
- act on one record, explicitly selected records, or all eligible records matching visible filters;
- complete valid workflow actions without directly editing derived journey stages;
- see delivery, batch, eligibility, and data-integrity failures and recover without duplicate effects; and
- run a controlled end-to-end email pilot with fake applicant and student records before deliberately enabling live recipients.

## Scope

In scope:

- the stable Admissions overview and local navigation;
- the staff new-student admissions workspace and applicant record;
- the staff returning-student cycle workspace and participant record;
- derived stages, attention indicators, primary next actions, filters, saved views, selection, and pagination;
- individual and valid bulk operational actions;
- returning-cycle membership, contact, response review, confirmation, study-break resolution, and reactivation exceptions;
- structured new-applicant correction requests and evidence decisions;
- background operational batches and per-record results;
- log-first Graph/SMTP correspondence, a controlled allowlisted pilot, and deliberate production enablement;
- clean replacement of test-only admissions and module-preference workflow data; and
- accessibility, performance, security, audit, regression, and cutover acceptance.

Out of scope:

- redesigning applicant or student portal pages;
- changing portal authentication or replacing the configured admissions email provider;
- withdrawn-student readmission;
- multi-staff ownership, assignments, approvals, or personal queues;
- expanded finance, invoicing, university export, compliance, and retention projects; and
- migrating test-only admissions or module-preference records.

## Canonical domain rules

### Terms and workflow target

- `Draft` term: dates or offerings are still being planned. It cannot be an Admissions target.
- `Published` term: offerings are confirmed and the term may be selected as the Admissions target.
- `Active` term: the term is currently being delivered.
- `Closed` term: delivery has ended.
- There is at most one Active term and one upcoming Published Admissions target at a time.
- New-student admissions and the returning-student cycle use the same Published target term and its confirmed offerings.
- Publishing a term only makes it available. It never starts a workflow, creates participants, or sends correspondence.
- Moving a Published term to Active is a separate deliberate staff transition after the previous Active term is closed.

### Workflow authority

- Journey stages and cycle outcomes are projections of authoritative workflow records, not editable status labels.
- Later coherent workflow records take precedence over stale lead fields.
- Contradictory source records show `Data inconsistency—repair required` and block ordinary progression.
- Exceptional repair is individual, reasoned, confirmed, audited, and changes the authoritative source records rather than overriding a display label.
- Administrative fields such as contact details, programme interest, operational notes, and follow-up dates do not change a journey stage.
- Every consequential mutation records actor, timestamp, reason where applicable, source workflow, affected records, and a redacted audit event.

## Information architecture and routes

Use these stable staff routes:

- `/admissions`: Admissions overview.
- `/admissions/new-students`: new-student operations workspace.
- `/admissions/new-students/[admissionId]`: full new-student record and consequential workflows.
- `/admissions/returning-students`: returning-student cycle selector and current cycle workspace.
- `/admissions/returning-students/[cycleId]/participants/[participantId]`: full participant record and reasoned resolutions.
- `/admissions/batches/[batchId]`: durable operational-batch progress and results.

The application sidebar `Admissions` item always opens `/admissions`. It must not remember or redirect to the last workspace.

A persistent local navigation control appears in the same position on the overview and both workspaces:

- `Overview`
- `New students`
- `Returning students`

The active location must be programmatically and visually clear. Filters, selections, actions, and records never cross workspace boundaries.

### Admissions overview

The overview is a gateway, not a third work queue:

- show equal, simultaneous gateways for New students and Returning students;
- name each workflow plainly, identify its current intake or cycle, show compact workload counts, and provide one primary entry action;
- new-student counts: active admissions, needs attention, ready to progress, and the highest-value queues;
- returning-student counts: current cycle phase, participants, needs attention, ready to confirm, and the highest-value queues;
- queue counts deep-link to the corresponding filtered workspace;
- a safe `New enquiry` shortcut may appear in the new-student gateway;
- cycle creation and configuration stay inside Returning students; and
- show only genuine cross-workflow or system exceptions below the gateways, such as data inconsistencies, failed batches, or delivery configuration failures.

The overview has no record selection, generic stage editor, bulk status control, or combined new/returning attention inbox.

## Shared operations-table contract

Both workspaces use the validated Variant A table-first pattern.

### Query and view state

- Search, filtering, sorting, and pagination run server-side.
- Filters are combinable and expose the result count.
- Supported page sizes are 25, 50, and 100; default to 50.
- The current query state is represented in the URL so filtered work can be bookmarked, refreshed, and deep-linked.
- Saved views store a name, workspace, filters, sort, and page size. They do not store row selection.
- Default ordering prioritises the primary next action and overdue work, then oldest relevant activity.
- Filters and result counts remain visible while records are selected or actions are reviewed.
- Empty, loading, unavailable, and error states explain what happened and preserve recoverable query state.

### Selection and action scope

Every operational action has one explicit scope:

1. one record;
2. selected records; or
3. all eligible records matching the current filters.

Rules:

- selecting the visible page selects only that page;
- page selection never silently expands to all filtered results;
- `All matching` is a separate deliberate control that shows the total count;
- a persistent action bar shows scope, total count, and contextual valid actions;
- selection survives paging within the same query but is cleared after a material filter change, with a warning before clearing if necessary;
- mixed selections are allowed; preview separates eligible and excluded records and gives a plain-language exclusion reason;
- eligibility is rechecked at execution time; records that became invalid are excluded rather than forced through an invalid transition; and
- there is no generic bulk stage or status editor.

### Row focus and full records

- Opening a row shows a right-side quick dossier drawer without losing filters, selection, pagination, or scroll context.
- Closing the drawer restores focus to the row that opened it.
- The drawer contains the derived stage or cycle state, leading attention indicator, primary next action, essential facts, recent history, and only routine safe actions.
- Detailed or consequential work opens the full record.
- A direct URL to a full record must work without first visiting the table.

## New-student admissions contract

### Derived journey stages

| Stage | Projection |
| --- | --- |
| Enquiry | No application invitation has been issued. |
| Application | Invited with no application, or an application remains in draft. |
| Review | Submitted application through correction, evidence, and decision-readiness work. |
| Offer | Issued or lapsed offer awaiting applicant response or staff action. |
| Registration | Accepted offer through registration and conversion readiness. |
| Complete | Registration has been converted to a student record. |
| Closed | Rejected, declined, withdrawn, archived, or abandoned with an authoritative outcome. |

Corrections remain within Review. Offer and registration lapse remain within their respective reversible stages.

A record may have several factual attention indicators but exactly one primary next action. Priority is:

1. repair a data inconsistency;
2. complete staff review or decision work;
3. address an overdue or lapsed case;
4. contact the applicant;
5. wait for the applicant; or
6. no action.

### Workspace hierarchy

Above the dominant table, show:

- compact metrics for active admissions, needs staff attention, awaiting applicant, and ready to progress; and
- a compact seven-stage strip for Enquiry, Application, Review, Offer, Registration, Complete, and Closed, with total and attention counts that apply a filter.

Do not use a kanban board, large journey matrix, or dashboard as the primary working surface.

The table exposes:

- selection;
- applicant identity and stable admissions record reference;
- derived journey stage;
- leading attention indicator, with access to additional indicators;
- programme and target intake;
- last relevant activity;
- current deadline where applicable;
- primary next action; and
- open action.

Keep `New enquiry` prominent but separate from the worklist. Imports, configuration, and archived history are secondary tools.

### New-student individual actions

| Stage | Valid staff actions |
| --- | --- |
| Enquiry | Edit administrative details, invite, close as abandoned. |
| Application | Resend access, remind, edit administrative details, close as abandoned. |
| Review | Verify evidence, request or review corrections, record eligible evidence override, set readiness, offer, reject. |
| Offer | Remind, reissue a lapsed offer, withdraw. |
| Registration | Remind, reopen a lapsed registration, convert a valid submitted registration. |
| Complete | Read-only workflow history. |
| Closed | View history, reopen an abandoned pre-submission record, or perform a named exceptional repair. |

Offers, rejections, correction requests, evidence decisions and overrides, offer reissues, withdrawals, conversions, and repairs remain individual actions.

Valid bulk actions are limited to:

- invitations;
- reminders or general communications;
- closing eligible abandoned enquiries or unsubmitted applications; and
- explicitly lapsing eligible overdue offers or registrations after preview.

Deadline passage shows `Overdue` and blocks invalid applicant actions but does not silently lapse a record. Staff preview and deliberately lapse eligible records.

Post-submission records need a genuine terminal outcome before archival. Archival only hides a record; it does not replace its closure reason. Reapplication after rejection, decline, or withdrawal creates a new admissions record linked to the same person.

### Correction and evidence workflow

- A submitted application may have one open structured correction request at a time.
- A request contains specific items targeting application fields or document slots.
- Only targeted fields and slots become editable.
- Preserve the original submission, every correction version, instructions, applicant drafts, and staff outcomes.
- Request states are `Open`, `Resubmitted`, `Resolved`, and `Cancelled`.
- Applicants may save correction drafts but must address every item before resubmitting.
- Resubmission returns the application to staff Review and never directly makes it ready for decision.
- Staff accept each item; every item must be accepted before resolution.
- Inadequate corrections reopen the same request with revised instructions and preserved history.
- A genuinely new correction starts a new request only after the previous request is resolved or cancelled.
- Default due date is 14 days and editable. Overdue requests remain editable but are flagged.
- Replacement evidence preserves the previous file and starts as `Unverified`.
- An offer requires all required evidence to be verified or covered by a slot-specific override.
- An override may cover missing or unverified evidence, never rejected evidence. It is exceptional, visible, reasoned, audited, and tied to one application decision.
- Offers are blocked while a correction request is Open or Resubmitted.
- Staff may reject before all evidence is verified; rejection cancels any outstanding request.
- Other cancellation requires a reason and locks correction access while preserving history.
- Portal state is authoritative. A notification contains the due date and secure link only; delivery failure remains visible to staff and does not undo the request.

The full record, not the drawer, hosts correction authoring, evidence decisions, offer/rejection, reissue/withdrawal, conversion, and exceptional repair.

## Returning-student admissions contract

### Cycle and phase model

There is one PGCert returning-student cycle for the Published target term. Its phases are:

1. `Setup`
2. `Collecting responses`
3. `Review and confirmation`
4. `Complete`

The workspace adapts emphasis by phase:

- Setup: offerings, included status groups, participant preview, individual additions/removals, and snapshot readiness.
- Collecting responses: deliberate contact, delivery failures, responses, reminders, and eligibility changes.
- Review and confirmation: module demand, capacity acknowledgement, confirmation, study-break follow-up, no-response resolution, and exceptions.
- Complete: read-only participant, correspondence, response, confirmation, enrolment, and outcome history.

Changing phase never sends correspondence automatically.

### Membership and eligibility

The normal eligible pool is PGCert learners who:

- have fewer than 60 formally awarded credits; and
- currently have status `active`, `deferred`, or `interrupted`.

Withdrawn learners are always excluded.

Staff select one or more eligible status groups. All eligible learners in those groups are initially selected, after which staff may remove individuals or add eligible individuals from an unselected group.

Learners with 60 or more formally awarded credits are excluded from bulk groups but may be added individually for additional study when they are not withdrawn and staff records a reason.

`Refresh eligible learners` previews live additions, removals, status changes, and credit changes. It never mutates draft membership silently.

Missing portal identity or usable email does not hide a learner; it creates a blocking setup indicator.

Opening Collecting responses records the participant snapshot, including programme, status, and formally awarded credits at inclusion. Opening sends nothing.

After opening:

- reasoned, audited individual add/remove remains possible;
- removed participants retain history but cannot be contacted, respond, or progress until reasoned re-addition;
- movement among active, deferred, and interrupted retains participation and shows an informational change;
- reaching 60 credits retains participation but requires staff to confirm additional-study intent; and
- becoming withdrawn or leaving PGCert blocks contact and confirmation until removal or data repair.

### Contact and response

Contact state and response state are independent.

Contact states:

- `Not contacted`
- `Queued`
- `Sent`
- `Failed`

Response states:

- `Awaiting response`
- `Modules selected`
- `Study break`

A valid learner response is either:

- one or two unranked provisional module selections from the Published target term; or
- an explicit study-break response.

An empty response is invalid. A study break is a positive response, not an empty module selection.

Contact is deliberate and can target one participant, selected participants, included current-status groups, or all eligible participants matching current filters. Default group sends exclude removed, blocked, or already successfully contacted participants. Deliberate resends may include failed or previously contacted participants and create new correspondence attempts.

Use current valid email and current status for targeting while showing the inclusion-status snapshot. Store the exact recipient address for every attempt. The compact table shows latest contact state and attempt count; complete correspondence history is available on demand.

### Demand, capacity, and confirmation

- Planned capacity is advisory and may be increased or exceeded.
- Module-demand cards show planned capacity, provisional selections, confirmed selections, and over/under-demand.
- Selecting a demand card filters the participant table to that offering without changing workspace.
- Over-demand is prominent but never an automatic submission or confirmation prohibition.
- Confirmation can operate individually or on eligible selected/all-matching records.
- Confirmation creates or links planned enrolments idempotently and must not duplicate an existing `(student_id, offering_id)` enrolment.
- Two-module responses are independently resolvable.
- An unavailable offering cannot be confirmed. Staff either reopen the learner response or record an agreed replacement.
- Staff-adjusted selection requires a reason and recorded learner agreement.
- Confirmation above planned capacity requires explicit acknowledgement, not a hard block.

A study-break response creates staff follow-up rather than an enrolment:

- record `deferred` when an agreed future return term exists;
- record `interrupted` when no return point has been agreed; and
- do not infer either state from the absence of selections.

Confirmed future study for a deferred, interrupted, or additional-study learner schedules reactivation for the target term start rather than changing status immediately. A due reactivation that cannot complete becomes a visible exception.

The cycle may become Complete only when every participant has confirmed study, an acknowledged study break, reasoned removal, or a reasoned no-response outcome.

### Returning workspace hierarchy

Keep the phase indicator compact and continuously visible. Above the participant-first table, show:

- participants;
- successfully contacted;
- responses;
- records needing attention; and
- compact module-demand cards.

The table supports filters for current/inclusion status, awarded-credit band, contact, response, module, resolution/readiness, attention condition, and eligibility change. It exposes:

- selection and participant identity;
- current status and formally awarded credits;
- latest contact state and attempt count;
- response state;
- provisional selections;
- resolution or confirmation outcome;
- primary next action; and
- open action.

The participant drawer shows inclusion/current status, credits, eligibility changes, contact attempts, response, per-selection confirmation, next action, and recent cycle history. Reasoned removal/re-addition, additional-study confirmation, study-break resolution, agreed replacements, capacity acknowledgement, and repairs use the full participant workflow.

## Operational batches

Large actions run as durable background batches. The initiating request must not perform a cohort send or large mutation synchronously.

### Review and execution

The review flow is:

1. choose a contextual action;
2. select a suitable correspondence template and edit permitted content when sending;
3. preview eligible and excluded records, recipient details, counts, exclusions, and a representative message where relevant; and
4. confirm deliberately.

Each batch stores:

- initiating staff member and source workspace;
- action and reviewed scope;
- current filters when using all-matching scope;
- immutable target snapshot or deterministic target query plus reviewed count;
- correspondence template, version, rendered subject/body snapshot where applicable;
- start, completion, and last-progress timestamps; and
- per-record queued, succeeded, failed, or excluded outcomes with plain-language reasons.

Partial failure does not roll back successful records. Retry targets failed records only and creates a new attempt linked to the original batch. State changes use transactional guards, idempotent effects, and duplicate protection.

Staff may leave and return to progress and results. Completion shows filterable succeeded, failed, and excluded counts and records. Source tables show only the latest relevant batch result and attention indicator; full history remains available.

## Correspondence and controlled email rollout

### Log-first delivery

- Reuse the server-only admissions email provider with Microsoft Graph preferred and SMTP fallback.
- Every send, including portal magic links, starts by creating one correspondence attempt per recipient.
- The attempt stores person, source record/cycle, template and version, rendered subject/body snapshot as appropriate, exact recipient address, provider, provider message ID when available, and delivery state.
- Delivery updates the attempt from Queued to Sent or Failed. A failed provider call never appears as successful contact.
- Bulk delivery is batched and rate-limited for the configured provider.
- Retrying failures creates new attempts and never resends successful records unless staff explicitly chooses a deliberate resend.
- `ADMISSIONS_EMAIL_ENABLED` remains the master delivery flag. Publishing a term, starting either workflow, or changing phase never sends automatically.

### Pilot mode

Before any delivery to genuine production recipients:

- configure the organisation-controlled sender mailbox, Graph or SMTP credentials, permissions, reply-to address, and SPF/DKIM/DMARC as applicable;
- enable a server-enforced pilot mode with an explicit recipient allowlist;
- permit delivery only when the resolved recipient address is on that allowlist and the related applicant/student is clearly marked as a fake test record;
- reject or suppress every non-allowlisted recipient server-side even if selected through the UI or submitted directly to an action endpoint;
- never replace a genuine student's email address to make them a test recipient; and
- show pilot mode and suppression clearly to admissions staff.

The pilot must use accessible email accounts controlled by the product owner and complete:

1. one full new-applicant journey, including invitation/access, the complete existing application form, submission, staff review/correction where exercised, decision, offer response, registration, conversion, and all expected correspondence; and
2. one full returning-student journey, including participant inclusion, contact/access, one or two selections or study break, staff review/confirmation or resolution, planned-enrolment result where applicable, and all expected correspondence.

The product owner must confirm both the delivered emails and the complete workflow/application-form experience are satisfactory. Live recipients are enabled only through a deliberate configuration change that disables pilot-only enforcement or changes the allowed delivery mode. Successful pilots never unlock production delivery automatically.

### Production email acceptance

Before deliberate live enablement:

- correspondence history matches every attempted message and exact recipient;
- access links work once and resolve to the intended fake applicant/student;
- Outlook, Gmail, and at least one representative workplace-domain inbox have been tested where available;
- provider failures and suppressed sends are visible in the correct staff workspace;
- failure-only retry does not duplicate successful sends; and
- configuration errors appear as overview/system exceptions and block unsafe live actions.

## Security, privacy, and permissions

- Existing staff permission helpers remain authoritative; sensitive admissions operations require `admin` access.
- Applicant/student routes remain outside the staff shell and retain their separate authentication and RLS boundaries.
- All mutations re-authorize and revalidate eligibility on the server; hidden or disabled UI is not a security boundary.
- Support-needs and other restricted information remain separated from the general dossier.
- Opening a list or ordinary dossier must not audit access to sensitive detail that staff did not deliberately reveal.
- Deliberately opening restricted detail records a redacted access audit event.
- Audit and batch metadata must not copy document contents, sensitive free text, credentials, or magic-link tokens.
- Correspondence recipient snapshots are operational evidence and must use the existing protected access model.

## Accessibility contract

The complete staff workflow must conform to [WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA.

At minimum:

- every workflow is fully operable by keyboard with logical focus order, visible focus, no keyboard trap, and focus restored after drawers/dialogs close;
- the persistent navigation, active location, headings, metrics, stage/phase controls, tables, filters, actions, drawers, dialogs, progress, and results expose correct names, roles, states, and relationships;
- status, urgency, selection, eligibility, and delivery outcomes never rely on colour alone;
- text and non-text contrast, target size, reflow, and text spacing meet Level AA;
- tables retain programmatic headers and accessible row/action naming;
- drawers and confirmation dialogs have labelled titles, contained focus while modal, an obvious close action, and non-destructive escape behaviour;
- asynchronous loading, batch progress, success, failure, exclusions, and selection-count changes are announced without stealing focus;
- validation identifies the affected field or record and provides a correction suggestion where possible;
- consequential actions provide review, confirmation, or reversal appropriate to their risk;
- at 200% browser zoom, primary workflows remain operable without lost content or overlapping controls; and
- automated checks are supplemented by keyboard-only and screen-reader smoke tests of both core workflows.

## Performance and reliability contract

Acceptance uses a representative non-production dataset containing at least:

- 1,000 new-student admissions records;
- 1,000 returning-cycle participants;
- realistic histories, attention indicators, and mixed stages/states; and
- a 500-recipient correspondence batch with a controlled mixture of success, failure, and exclusion.

Requirements:

- list queries are bounded and indexed; no workspace loads all records or full histories before first render;
- server-side search, filter, sort, and page requests complete within 2 seconds at the 95th percentile in the representative acceptance environment;
- opening a quick dossier completes within 2 seconds at the 95th percentile without fetching unrelated dossiers;
- starting a reviewed batch acknowledges within 2 seconds; cohort execution continues outside the web request;
- batch progress and results are durable across navigation, refresh, worker restart, and safe retry;
- concurrent or repeated actions cannot create duplicate correspondence attempts for the same batch target, duplicate planned enrolments, or repeated state transitions;
- stale records are excluded with reasons rather than overwriting newer workflow changes;
- provider rate limiting uses bounded concurrency and backoff without blocking ordinary page requests; and
- errors are observable through structured server logs plus staff-visible batch/system exceptions without exposing secrets.

If the acceptance environment cannot meet these targets because of external provider latency, separate application query/enqueue performance from provider completion time and record both.

## Clean replacement and cutover

There is no production admissions or module-preference workflow data to migrate. The current admissions workflow records are test material.

Protected production data includes people, students, terms, course modules, module offerings, enrolments, formally awarded credits, attendance, assessments, and other academic records. The replacement may read and reference these records but must not delete, reinterpret, or bulk-rewrite them.

Existing enrolments remain authoritative for awarded-credit eligibility and duplicate-enrolment prevention.

Do not preserve or dual-write the test-only active-student eligibility lookup, ranked preferences, hard capacity submission blocking, live-recipient queries, lifecycle-only `Confirm` action, legacy screens, or test correspondence history.

Implementation may land in internal slices, but the overview and both complete workspaces activate through one coordinated feature-flagged cutover. Do not expose half of the redesigned information architecture to staff.

Recommended implementation order:

1. source-state projections, workflow guards, correction/cycle/batch/correspondence schema, and protected-data regression fixtures;
2. shared Admissions shell, overview, query state, operations table, drawer, selection, and batch primitives;
3. complete new-student workspace and full-record actions;
4. complete returning-student cycle, participant workspace, confirmations, and reactivation exceptions;
5. log-first delivery, pilot allowlist, background workers, results, retries, and system exceptions;
6. end-to-end, accessibility, scale, permission, idempotency, and protected-data verification; and
7. coordinated staff cutover, product-owner pilot approval, then separate deliberate live-email enablement.

The old test-only staff surfaces and module-preference implementation may be removed only after the replacement passes the acceptance gates below.

## Acceptance gates

### Functional journeys

- Admissions overview routes unambiguously to two separate workspaces and exposes no combined work queue.
- New-student metrics, stage filters, query controls, table, drawer, and full record remain consistent with the derived source state.
- Every new-student valid action succeeds only from an eligible state; invalid direct stage mutation is impossible.
- A rejected evidence slot can complete a scoped correction/replacement/resubmission/review journey without overwriting history.
- Offer issue is blocked by unresolved corrections and by required evidence that is neither verified nor validly overridden.
- Returning Setup produces a reviewed participant snapshot from selected status groups plus individual changes without silent refresh.
- Fake returning students can submit one or two unranked selections or an explicit study break; empty submission is rejected.
- Flexible capacity shows demand and requires acknowledgement above plan but does not hard-block a valid response or confirmation.
- Confirmation creates/links the correct planned enrolment once, including under retry or concurrent execution.
- Study-break and no-response resolutions are explicit and auditable; deferred/interrupted status is never guessed.
- Complete cycles are read-only and contain a resolution for every participant.

### Bulk and correspondence

- Page selection, explicit selected-record scope, and all-matching scope target exactly the records shown in preview.
- Mixed eligibility produces correct eligible/excluded sets before execution and again at execution time.
- A 500-recipient batch completes with durable per-record outcomes and does not hold open the initiating web request.
- Partial failure preserves successes; retry targets failures only; deliberate resend creates new attempts.
- Every send, including returning-student access links, has a per-recipient correspondence attempt before provider delivery.
- Pilot allowlisting blocks all non-test recipient addresses at the server boundary.
- The product owner completes and approves the full fake new-applicant and returning-student journeys before a deliberate live-email configuration change.

### Accessibility and usability

- Automated accessibility checks find no serious or critical violations on the overview, both workspaces, drawers, full records, action previews, and batch results.
- Keyboard-only users can search, filter, select, preview, confirm, inspect results, open/close drawers, and complete both core workflows.
- Screen-reader smoke tests announce location, table structure, selection scope, stage/phase, validation, asynchronous status, and action results correctly.
- At 200% zoom the workflows remain usable and no essential action or status is clipped or obscured.

### Security, regression, and operations

- Admin, applicant, student, teacher, reception, anonymous, and service-role permission tests preserve their intended boundaries.
- Restricted support-needs detail is logged only when deliberately revealed.
- Protected production tables and representative row counts are unchanged by replacement deployment and ordinary workflow setup.
- Existing Students, Course, Attendance, enrolment, credit, and assessment workflows pass targeted regression tests.
- Feature-flag rollback restores the previous staff entry point without reversing protected academic data.
- Worker/provider interruption is recoverable without duplicate sends, enrolments, or transitions.
- Configuration, batch, delivery, reactivation, and data-integrity failures surface in a staff-visible repair context.

## Validated prototype references

- New students, Variant A operations table: branch `prototype/new-student-admissions-workspace`, commit `2c37c97b52a1e1bc7c6bb26eaf47dac4e2182a1e`.
- Returning students, Variant A cycle operations table: branch `prototype/returning-student-admissions-workspace`, commit `1d2419dc4e22960574b93e56f9fabfcf6a4729bb`.
- Shared overview, Variant A two-workspace gateway: branch `prototype/shared-admissions-overview-navigation`, commit `1ba35c3c8353bc6bca14e2e94d099144fda7d3fc`.

The prototypes establish information hierarchy and interaction direction. This contract governs production behaviour, state integrity, scale, accessibility, and acceptance where prototype code is intentionally incomplete.
