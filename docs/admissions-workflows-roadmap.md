# Admissions and Applications Workflows Roadmap

Last updated: 2026-08-09

This document is the durable handoff record for the admissions, application, registration, and student portal work. Keep it updated when branches are merged so new Conductor workspaces created from `origin/main` can pick up the current state without needing prior chat context.

Use `docs/admissions-workflows-spec.md` for the full admissions/application history and `docs/admissions-staff-workflows-implementation-spec.md` for the approved staff-workflow redesign contract. This roadmap tracks status, decisions, and implementation history.

The workspace-local companion file is `.context/admissions-workflows-handoff.md`. Use that for branch-specific notes, partial work, and immediate next steps.

## Current Direction

- Replace the current test-only staff admissions and module-preference UX with one stable Admissions overview and separate table-first New students and Returning students workspaces.
- Treat `docs/admissions-staff-workflows-implementation-spec.md` as authoritative wherever older roadmap or phase text conflicts with the validated redesign.
- Implement in internal slices but activate the overview and both complete workspaces through one coordinated feature-flagged cutover.
- Preserve production people, students, terms, modules, offerings, enrolments, awarded credits, attendance, assessments, and other academic data; no production admissions or module-preference records require migration.
- Run email in server-enforced allowlisted pilot mode against clearly marked fake applicant/student records first. Live recipients require successful full new-applicant and returning-student journeys, product-owner approval of the workflow and application form, and a deliberate configuration change.
- Extend the existing BETAR LMS rather than creating a separate admissions system.
- Keep one Supabase/Postgres system of record so accepted applicants can become students without sync jobs or re-keying.
- Build the first release around the core admissions journey: enquiry/application, review, offer, acceptance, registration, and conversion to student.
- Treat the public `/apply` enquiry form and authenticated `/apply/application` form as different product surfaces: enquiry captures broad module interests; application captures intended first-term module offerings after programme and start term are selected.
- Treat production email delivery as a Phase 1 go-live dependency, not a blocker for ordinary feature development. Application invitations and portal sign-in links now use Supabase-generated magic links sent by the app through the feature-flagged Microsoft Graph/SMTP delivery layer. App-side admissions correspondence also uses this delivery layer for offer/rejection, offer-response confirmation, and offer deadline reminder/lapse emails. Microsoft Graph is preferred when Microsoft 365 security defaults block password-based SMTP. Keep production workflow sends behind `ADMISSIONS_EMAIL_ENABLED` until each live workflow is tested.
- Defer expanded finance work until after the admissions and registration flow is reliable. Existing term finance records can continue to be used in the interim.
- Treat security, RLS, private storage, audit logging, and retention decisions as foundation work, not later polish.

## Staff Admissions UX Redesign

Status: `Implementation in progress`

Authoritative contract: `docs/admissions-staff-workflows-implementation-spec.md`

Validated prototypes:

- New students Variant A operations table: `prototype/new-student-admissions-workspace` at `2c37c97b52a1e1bc7c6bb26eaf47dac4e2182a1e`.
- Returning students Variant A cycle operations table: `prototype/returning-student-admissions-workspace` at `1d2419dc4e22960574b93e56f9fabfcf6a4729bb`.
- Shared overview Variant A two-workspace gateway: `prototype/shared-admissions-overview-navigation` at `1ba35c3c8353bc6bca14e2e94d099144fda7d3fc`.

Implementation sequence:

- [x] Add authoritative source-state projections and workflow guards; remove normal direct stage editing.
- [x] Add structured application correction requests, replacement-evidence history, decision evidence guards, and queued log-first correction notices.
- [x] Add returning cycles and participant foundations.
- [x] Add durable operational-batch, per-target/retry, log-first magic-link, and fake-record email-pilot safety foundations.
- [ ] Build the shared Admissions overview, local navigation, table/query/selection primitives, drawers, and durable batch results.
- [ ] Build the complete new-student operations workspace and full-record actions.
- [ ] Build the complete returning-student cycle workspace, advisory demand, confirmations, study-break handling, and reactivation exceptions.
- [ ] Replace direct returning-student magic-link sends with per-recipient correspondence attempts and background delivery.
- [ ] Pass WCAG 2.2 AA, permission, protected-data regression, idempotency, 1,000-record, and 500-recipient-batch acceptance.
- [ ] Activate the three staff surfaces together behind a feature flag in non-production, then production.
- [ ] Complete allowlisted fake-record new-applicant and returning-student pilots and obtain deliberate product-owner approval.
- [ ] Enable genuine production recipients through a separate deliberate configuration change.

## Current Application Form Adjustment

The core new-applicant flow is implemented from enquiry through application, staff review, offer response, registration, and conversion to student. The remaining application-form work is mostly refinement: repeatable qualification rows if needed, final business-field confirmation, live email deliverability checks, and the deferred finance/compliance pieces.

Required changes:

- Keep `/apply` as enquiry-only. Broad module interests should remain `course_modules` interests and must not become start-term module selections.
- Expand `/apply/application` into a university-style sectional application with personal details, contact details, professional/employment details, qualifications, intended study plan, light nationality/visa/funding fields, optional support-needs disclosure, POCUS free-text questions, evidence summary, preview, and declaration.
- Intended start term is now on the application model before concrete module selection.
- Authenticated application drafts now store one or two selected `module_offerings`, while old `module_interest_ids` remain only for backwards/enquiry-copy context.
- Selectable offerings are loaded dynamically for the chosen term from `module_offerings` joined to active `course_modules` and `published`/`active` future `terms`.
- Draft-save validates offering selection server-side; final submit repeats required-field and offering validation in its dedicated submit RPC.
- Selected offerings do not reserve places, create enrolments, or create finance records.
- Optional disability/support-needs information is stored separately from general application fields with restricted access and redacted audit metadata.
- Final submit is separate from draft save. It validates the saved application snapshot and selected offerings, locks the application by setting `submitted`, updates the lead stage, stores declaration acceptance metadata, and writes `application.submitted` transactionally.
- Application evidence uploads are implemented as applicant-owned slots linked to `managed_files`. Required qualification and professional-registration evidence block final submission when missing or rejected; staff can open evidence files and verify, reject, or reset document slots from the review screen.
- Submitted-application correction foundations are implemented. Staff can create one active request with specific field/document targets and a due date; applicant saves, instructions, resubmission rounds, original application snapshots, and replaced evidence remain preserved; only targeted applicant responses are accepted; accepted document replacements reset to Unverified; and offer decisions are blocked by active corrections or unresolved required evidence unless a valid reasoned slot override exists. The dedicated correction panels in the redesigned staff and applicant records remain a later UI slice.
- Staff application review is implemented as a staff-only admissions/admin screen for submitted applications. It shows applicant/application detail, intended start term, selected module offerings, POCUS answers, uploaded evidence status, and separated restricted support-needs information; disclosed support-needs views are audit logged with redacted metadata; staff can verify/reject/reset document slots with audit events and record review notes plus decision readiness without issuing offers/rejections or touching registration/email flows.
- Offer/rejection decision foundation is implemented from the staff review screen. Admissions admins can record an offer or rejection only after review readiness, with a required decision reason, offer/rejection records, one or two offer module snapshots, `offer.issued` or `application.rejected` audit events, and correspondence-log/template records. Raw staff decision/rejection reasons remain admin-only; email delivery is attempted only when configured/enabled, and `last_contacted_on` is not marked by suppressed correspondence. Registration, enrolments, finance rows, and production scheduler remain separate slices.
- Applicant offer accept/decline is implemented in the portal. Applicants can view their current offer after magic-link login, accept or decline an issued unexpired offer, and the system records response timestamp plus auth user, person, IP, and user-agent metadata. Acceptance moves the lead to `accepted` and exposes registration as the next step. Decline moves the lead to `offer_declined`. Both actions write audit events and correspondence-log records, with confirmation email delivery attempted only when configured/enabled.
- Offer deadline, reminder, and lapse foundations are implemented without a production scheduler. New issued offers receive a future deadline, defaulting to 14 days when staff leave the deadline blank; applicants cannot respond after the deadline or once offers are accepted, declined, withdrawn, or lapsed. Admissions admins can manually run `process_application_offer_deadline_workflow(...)` from the staff review/admin screen to log one reminder eligibility record for issued offers approaching deadline and to mark overdue issued offers as `lapsed`, move the lead to `offer_lapsed`, write audit events, create correspondence logs, and attempt email delivery when configured/enabled. Staff and portal UIs show deadlines, deadline-passed state, reminder logging, and lapsed state.
- Registration wizard foundation is implemented for accepted offers. Authenticated applicants with an accepted offer can start `/portal/registration`, which creates an in-progress registration snapshot, confirms the accepted course/modules with immutable displayed module/term/price/capacity snapshot fields, captures versioned personal-detail snapshots, supports draft save, uploads required identity and qualification evidence plus optional student ID photo into private managed storage, reads the active registration T&C version from the database, saves the current draft fields before final submit, records T&C version/hash/person/auth user/timestamp/IP metadata on final submission, writes registration/document/T&C audit events, and shows portal states for not started, in progress, submitted, lapsed, reopened, and complete. Staff review/admin pages show registration status for accepted applicants and expose submitted-registration conversion controls. Finance, invoice/payment, scheduler, and production registration-email work remain separate.
- Submitted registration conversion is implemented for admissions admins. Staff can convert only submitted registrations that pass required field, T&C, required-document, accepted-offer, and confirmed-offering checks; conversion stages/uses `admissions_conversion_requests`, creates or activates one linked `students` row for the existing `person`, creates planned initial `enrolments` from the accepted offer registration snapshot, links conversion metadata back to registration/application/offer/lead, marks the lead `registered`, promotes the portal identity to student, writes `registration.converted_to_student`, and is idempotent for already-complete registrations. The old accepted-lead direct conversion UI/action is disabled, and authenticated staff use the submitted-registration wrapper rather than the lower-level conversion RPC directly. This conversion slice deliberately does not create finance rows, invoices, payments, emails, or capacity/waitlist changes.
- Registration lapsed/reopened workflow is implemented for admissions admins. Registrations now have an interim 14-day registration deadline, a manual staff/admin deadline processor marks overdue in-progress or submitted-but-not-converted registrations as `lapsed`, moves the lead to `registration_lapsed`, writes `registration.lapsed` audit events, stores lapsed actor/timestamp/reason/correspondence-log metadata, and creates suppressed `registration_lapsed_notice` correspondence logs. Admins can reopen only lapsed, unconverted registrations with a mandatory reason and optional new deadline; reopening records actor/timestamp/reason/correspondence-log metadata, writes `registration.reopened`, creates suppressed `registration_reopened_notice` logs, clears current submission/T&C/module-confirmation fields, and returns the lead/registration to editable registration-in-progress state for applicant resubmission. Lapsed registrations cannot be submitted or converted unless reopened, and complete/converted registrations cannot be lapsed or reopened. Applicant portal and staff review screens show deadlines, lapsed state, and reopened state. This slice does not send real emails, create finance rows/invoices/payments, alter already-created enrolments, or build Phase 3 module preference windows.
- Termly module preference window foundation is implemented for continuing students. Admissions admins can create draft windows for published/active terms, configure available existing `module_offerings` from the selected term, open/close/confirm the window lifecycle, see submitted/missing active-student preferences from `/admissions/preferences`, and send secure portal preference links to missing active students for an open window. Student portal users with `actor_type = student` can submit 0, 1, or 2 explicitly ordered first/second preferences from `/portal/module-preferences` only while a window is open and within its date range; repeated submissions update the same student/window row; selected offerings must be configured on that window and tied to the same term with active modules. The portal resolves active-student eligibility through a narrow security-definer helper that returns only the current student ID, without exposing the full `students` row to portal RLS. This slice writes `module_preference_window.created/opened/closed/confirmed` and `module_preference.submitted/updated` audit events, but does not create enrolments, finance records, waitlists, cancellation actions, or low-uptake workflows.
- Capacity-safe module preference selection is implemented. `submit_module_preferences(...)` remains the single server-side submission path, locks selected and previously selected `module_offerings` rows, counts planned/in-progress enrolments plus other submitted choices for the same window/offering against `module_offerings.capacity`, rejects full offerings without creating duplicate active submission rows, and records `module_preference.capacity_blocked` audit events for capacity-blocked attempts. Staff see capacity, already enrolled, preference selections, remaining places, and full/unavailable state for each window offering; students see full offerings as unavailable in `/portal/module-preferences` unless they are keeping their own current saved choice. This slice still does not create waitlists, mandatory-module enforcement, reminders, low-uptake cancellation, confirmed enrolments, finance rows, invoices, payments, or real emails.

## Status Legend

- `Not started`: no implementation committed.
- `In progress`: implementation started on an active branch.
- `Blocked`: needs a business, university, legal, or infrastructure decision.
- `Done`: implemented, tested, merged, and reflected in this roadmap.
- `Deferred`: intentionally postponed.

## Phase 0: Foundations

Status: `Done`

Goal: make the data, auth, storage, and audit foundations safe before exposing public applicant/student workflows.

The shared foundation infrastructure is complete. Workflow-specific audit logging and RLS/access coverage continue in the later phases alongside each user-facing admissions workflow, because those checks need the concrete application, offer, registration, document, finance, and retention actions they protect.

- [x] Decide final `persons` model and migration strategy.
- [x] Backfill existing `students` into `persons`.
- [x] Link future applicant/student Supabase Auth users to `persons`.
- [x] Add applicant/student auth helpers separate from staff `requirePermission`.
- [x] Add initial route-boundary helper for public, applicant/student-authenticated, and staff-only routes.
- [x] Tighten storage model for identity documents, qualification documents, student photos, generated letters, and deferral evidence.
- [x] Add audit event schema foundations for staff, applicant, student, and service actors.
- [x] Add correspondence template and log schema before sending automated emails.
- [x] Add signed URL generation after server-side authorization for admissions documents.
- [x] Establish audit log infrastructure for later workflow-specific events.
- [x] Establish RLS/access-test patterns for staff, applicant, student, and public route boundaries.
- [x] Design conversion as a transactional database function/RPC rather than separate client-side writes.

## Phase 1: Enquiry, Application, Review, Offer

Status: `In progress`

Goal: run a complete intake up to offer acceptance without depending on email threads or manual forms.

- [x] Public enquiry form creates an admissions record.
- [x] Audit public enquiry submission.
- [x] Keep direct admissions lead access staff-only while allowing anonymous intake through a narrow public RPC.
- [x] Staff can issue application invitations from existing leads.
- [x] Applicant magic-link login.
- [x] Applicant can claim an invitation into the separate portal identity boundary.
- [x] Configure app-owned production email delivery for Supabase-generated magic links using organisation-approved Microsoft Graph/Outlook sender rather than Supabase's default sender.
- [ ] Test application invitation deliverability across internal Outlook, Gmail, and likely applicant workplace domains from the live app before applicant go-live.
- [ ] Keep production applicant sends disabled or clearly marked unverified until the Microsoft 365/Outlook sender mailbox, SMTP credentials, and domain authentication are confirmed.
- [ ] Staff can manually log enquiries that still arrive by email.
- [x] Basic application form with draft save.
- [x] Basic programme choice: PGCert or microcredential.
- [x] Basic broad module interest capture in the existing draft slice.
- [x] Basic work experience, qualification, and statement capture in the existing draft slice.
- [x] Expand application schema for personal and contact detail snapshots.
- [ ] Add repeatable qualifications or a clear structured qualification model.
- [x] Add professional/employment detail fields needed for review.
- [x] Add intended start term to application drafts.
- [x] Add application selected-offering model using `module_offerings`.
- [x] Update `/apply/application` so programme and intended start term are chosen before module offerings.
- [x] Filter selectable offerings to active modules in published/active future terms.
- [x] Enforce one or two selected module offerings server-side.
- [x] Ensure application module choices do not reserve places, create enrolments, or create finance rows.
- [x] Add light nationality, visa, and funding fields.
- [x] Add optional support-needs/disability capture with restricted/sensitive handling.
- [x] Add the four required POCUS free-text questions as named fields.
- [x] Add application section checklist/status and preview-style review before submit.
- [x] Add final submission declaration and transactional submit action.
- [x] Document upload slots with file validation.
- [x] Staff review screen with verification states and decision reasons.
- [x] Staff can record offer/rejection decisions from review with required reasons, audit events, offer/rejection records, one or two offer module snapshots, admin-only raw reasons, and suppressed correspondence logs.
- [x] Offer and rejection correspondence template placeholders.
- [x] Initial offer, rejection, invitation, preference-link, and reminder email templates.
- [x] Add feature-flagged app-side Microsoft Graph/SMTP delivery for offer/rejection decisions and applicant offer-response confirmations, with correspondence-log status/provider updates.
- [x] Extend app-side Microsoft Graph/SMTP delivery to offer reminder/lapse workflow emails after single-message mailbox tests pass.
- [ ] Extend app-side Microsoft Graph/SMTP delivery to registration lapse/reopen emails.
- [x] Confirm offer/rejection/reminder emails use the same production email delivery configuration and do not depend on Supabase's default sender.
- [x] Offer deadline, reminder eligibility, and lapsed-offer workflow foundations with reusable RPC/manual staff trigger, suppressed correspondence logs, and no production scheduler.
- [x] Offer accept/decline page in applicant portal with applicant identity metadata, deadline/status enforcement, lead/offer state updates, audit events, suppressed correspondence logs, and accepted-offer registration-next portal state.
- [x] Correspondence log records template version and provider message ID fields for offer response records; response confirmations are suppressed and have no provider message ID because real email sending remains disabled.

## Phase 2: Registration and Conversion

Status: `In progress`

Goal: accepted applicants complete registration and become BETAR student records with no re-keying.

- [x] Registration wizard for accepted offers.
- [x] Confirm course and intended first-term modules.
- [x] Confirm/update personal details with version history.
- [x] Upload required identity and qualification documents.
- [x] Upload student ID photo if required.
- [x] Version T&Cs and store acceptance metadata.
- [x] Transactionally create/activate student record.
- [x] Create initial enrolments.
- [ ] Generate expected finance rows using existing finance model.
- [x] Handle registration lapsed/reopened states.

## Phase 3: Returning-Student Cycles

Status: `Replacement foundation in progress`

Goal: replace termly Google Forms/email chasing and the test-only module-preference window with the returning-student cycle in `docs/admissions-staff-workflows-implementation-spec.md`.

- [x] Test-only preference-window, portal-submission, capacity, and link-email foundations exist and may inform implementation.
- [x] Add guarded replacement cycle/participant foundations for the single Published target term, selected active/deferred/interrupted groups, formally awarded-credit eligibility, reasoned individual membership, explicit refresh preview/application, immutable opening snapshots, and advisory planned capacity without changing protected academic data.
- [ ] Target the single upcoming Published term and use Setup, Collecting responses, Review and confirmation, and Complete phases.
- [ ] Snapshot an explicit PGCert participant set from chosen active/deferred/interrupted groups plus reasoned individual changes.
- [ ] Collect one or two unranked provisional selections or an explicit study-break response; reject empty responses.
- [ ] Make planned capacity advisory and expose module demand without blocking valid learner responses.
- [ ] Confirm valid selections into idempotent planned enrolments, with explicit above-capacity acknowledgement where needed.
- [ ] Resolve study breaks, no responses, additional study, reactivation, and source-data exceptions explicitly.
- [ ] Support contextual individual, selected, and all-matching communications/actions through durable background batches.
- [ ] Remove the test-only ranked-preference, hard-capacity, active-only, and lifecycle-only confirmation implementation after replacement acceptance.

## Phase 4: Expanded Finance

Status: `Deferred`

Goal: replace the simple expected-vs-paid model with invoice/payment/remittance workflows.

Deferred until the admissions and registration flows are stable.

- [ ] Sponsor/employer/NHS trust payer records.
- [ ] Invoice records and PDFs.
- [ ] Stripe payment links and webhook handling.
- [ ] Bank-transfer reconciliation.
- [ ] Overdue reminder workflow.
- [ ] Credit notes and refund handling.
- [ ] University remittance ledger/export.

## Phase 5: Compliance and University Integration

Status: `Not started`

Goal: provide operational evidence for GDPR, retention, DSARs, and university data-sharing needs.

- [ ] Draft applicant privacy notice.
- [ ] Draft student privacy notice.
- [ ] Draft DPIA.
- [ ] Draft RoPA.
- [ ] Draft appropriate policy document for special category data.
- [ ] Draft breach runbook.
- [ ] Add retention rules schema.
- [ ] Define orphaned `persons` retention/anonymisation behavior for deleted student records.
- [ ] Add person deletion/anonymisation workflow for retention expiry and erasure requests.
- [ ] Add deletion/anonymisation job logging.
- [ ] Add DSAR export action.
- [ ] Add generic university export CSV.
- [ ] Replace generic export with university-specified format after DSA/export spec is agreed.

## Durable Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-22 | Extend BETAR LMS rather than build a separate admissions service. | Avoid duplicate records, sync failures, and split staff workflows. |
| 2026-07-22 | Defer expanded finance until after admissions, registration, and module preferences. | Finance is valuable but not required for the first usable admissions workflow. |
| 2026-07-22 | Use a committed roadmap plus `.context` handoff notes. | `.context` is workspace-local, while committed docs survive branch creation and merges. |
| 2026-07-22 | Keep a committed developer spec separate from this roadmap. | Future workspaces need build rules as well as status tracking. |
| 2026-07-22 | Do not enforce unique `persons.email` in the persons foundation migration. | A person may change email, and applicants may reuse an email across intakes; lookup indexes are enough until duplicate-handling rules are defined. |
| 2026-07-22 | Retain linked `persons` rows when student records are deleted during Phase 0. | Person deletion/anonymisation needs a policy covering applications, auth identities, audit logs, correspondence, finance, and documents rather than a narrow student-delete side effect. |
| 2026-07-22 | Extend the original `audit_events` table rather than adding a parallel admissions audit log. | One append-only event stream keeps future admissions, documents, conversion, finance, and retention evidence queryable in the same place. |
| 2026-07-22 | Store correspondence template key/version snapshots on each log row. | Delivery history must remain understandable even if a later template version changes or a template row is retired. |
| 2026-07-22 | Stage public registration conversion through `admissions_conversion_requests` before calling a database RPC. | Offer, registration, T&C, document, module, student, finance, portal identity, and audit updates must happen in one database transaction without coupling Phase 0 to application forms or registration UI. |
| 2026-07-23 | Keep `/apply` module selections as broad `course_modules` interests and use `module_offerings` only inside authenticated application/registration flows. | Enquiry should stay lightweight, while application and conversion need concrete term-specific choices. |
| 2026-07-23 | Application module choices are intended choices only. | They support admissions review and offer generation but must not reserve capacity, create enrolments, or create finance records before registration conversion. |
| 2026-07-23 | Support-needs/disability information must be separated from general application data. | It can include special category data and needs restricted access, redacted audit metadata, and exclusion from generic exports. |
| 2026-07-23 | Production applicant email must use organisation-controlled Microsoft 365/Outlook SMTP, not the default Supabase email sender. | Supabase's default sender is rate-limited and best-effort; admissions may need hundreds of application invitations and later offer/reminder emails. An `@gmail.com` company mailbox is not preferred for production because it looks less official and is less controlled than the organisation domain. |
| 2026-07-28 | Use a 14-day offer deadline default for issued offers until the business confirms a different default. | Issued offers need a valid future deadline so applicant responses, reminder eligibility, and lapse handling have a clear source of truth. |
| 2026-08-05 | Keep portal module/offering RLS checks behind security-definer helper functions when they need to inspect related module catalogue tables. | Direct module/offering policies that query each other can trigger Postgres infinite-recursion errors in production, especially when application, offer, registration, and module-preference portal policies overlap. |
| 2026-08-08 | Use separate table-first staff workspaces for new-student and returning-student admissions under a stable overview. | The validated Variant A prototypes keep stages, workload, filters, and safe actions visible while scaling to hundreds of records. |
| 2026-08-08 | Replace normal direct stage editing with derived stages and guarded workflow actions. | Staff actions must not fabricate offer, registration, or completion states without their authoritative records. |
| 2026-08-08 | Replace test-only ranked module preferences with explicit returning-student cycles and unranked provisional selections. | Membership, study breaks, flexible demand, and planned-enrolment confirmation require an auditable participant workflow rather than a generic preference window. |
| 2026-08-08 | Use coordinated staff-UX cutover and an allowlisted fake-record email pilot before deliberate live enablement. | There is no production admissions workflow data to migrate, while protected academic data and genuine recipients require a controlled safety boundary. |

## Open Decisions

- Confirm whether the implemented 14-day default offer deadline should remain the business default.
- Confirm whether the interim 14-day registration deadline should remain the business default.
- Confirm whether applicant/student auth should be magic link only.
- Confirm the Microsoft 365/Outlook sender mailbox for production application emails, for example `admissions@...` or `no-reply@...`, and who can provide SMTP credentials/admin setup.
- Confirm SPF, DKIM, and DMARC are correctly configured for the organisation domain before high-volume applicant sends.
- Confirm exact mandatory/optional field list for nationality, visa, funding, gender, previous study, and emergency/alternative contact.
- Confirm whether currently active terms remain selectable for applications until `terms.ends_on`, or whether only terms with `starts_on >= current_date` are selectable.
- Confirm whether staff can adjust intended module offerings while issuing an offer and how those changes should be shown to applicants.
- Confirm exact declaration/privacy notice wording with the university/legal owner before go-live.
- Confirm retention defaults before go-live.
- Confirm who owns the university DSA conversation.
- Collect university sample offer/rejection/registration letters.
- Define refund and credit policy before expanded finance work starts.

## Implementation Log

Add entries here when meaningful code lands.

| Date | Branch or PR | Summary | Verification |
| --- | --- | --- | --- |
| 2026-07-22 | `12amathew/admissions-applications-workflows` | Created durable roadmap, developer spec, README pointer, and workspace handoff convention. | Documentation-only change. |
| 2026-07-22 | `12amathew/persons-foundation-v1` | Added `persons` foundation migration, backfilled existing students, linked `students.person_id`, and kept legacy student fields as the active UI source during transition. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-22 | `12amathew/applicant-auth-boundary` | Added `person_auth_identities`, portal identity lookup functions, route-boundary helpers, and server-only applicant/student auth helpers separate from staff auth. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-22 | `12amathew/admissions-docs-rls-hardening` | Added private admissions document buckets, tightened storage object policies so teachers no longer read mixed/sensitive document buckets, and added managed-file metadata fields for person linkage, uploader person, sanitized filenames, and retention class. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-22 | `12amathew/audit-correspondence-log-foundations` | Expanded audit events with actor/person/reason fields and staff-only direct append policy, added correspondence template/log foundations with recipient snapshots, and added metadata-redaction helpers for future workflow writes. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-22 | `12amathew/conversion-transaction-foundation` | Added admissions conversion staging tables and `convert_admissions_registration(...)`, a security-definer RPC that locks the conversion request and transactionally updates person, student, enrolments, expected finance rows, document ownership, portal identity, lifecycle state, and audit events. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-23 | `12amathew/signed-document-url-access` | Added server-authorized signed URL endpoints for staff and portal document access, backed by managed-file authorization rules, service-role object signing, sensitive staff document access audit events, and staff/applicant/student authorization tests. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-23 | `12amathew/public-enquiry-intake` | Started Phase 1 with public `/apply` enquiry intake, a narrow anonymous RPC that creates `admission_leads`, an `enquiry.submitted` audit event, route/access tests, and roadmap clarification that Phase 0 infrastructure is complete while workflow-specific coverage continues inside later phases. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-23 | `12amathew/application-invitations-magic-link` | Added Phase 1 application invitations without building the full application form: staff can invite an existing lead, invitations create/link a `person`, Supabase magic links route through `/auth/callback`, applicants claim access into `person_auth_identities`, and `/apply/application` shows invitation/access status only. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-23 | `12amathew/application-draft-save-form` | Added the authenticated application draft slice: applicant-owned `applications` draft model, active-module read policy for applicant forms, `save_application_draft(...)` RPC with draft-save audit events, and `/apply/application` draft save form for programme, module interests, professional details, qualifications, work experience, and statement fields. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-23 | `bangalore` docs update | Consolidated the expanded university-style application plan: enquiry interests stay broad, authenticated applications choose one or two future term `module_offerings`, the application model needs personal/contact/professional/qualification/nationality/visa/funding/POCUS/declaration sections, and support-needs data needs restricted handling. | Documentation-only change. |
| 2026-07-23 | `12amathew/expand-application-form` | Expanded `/apply/application` into a university-style draft form with personal/contact/employment/qualification/study-plan/nationality/visa/funding/support-needs/POCUS/evidence-preview sections, added intended start term and selected `module_offerings`, validated selectable offerings server-side against active modules in published/active future terms, and stored support-needs data separately with restricted RLS and redacted audit metadata. Final submit/declaration remains a separate slice. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-23 | `12amathew/final-submit-declaration` | Added the Phase 1 final application submit slice: `submit_application(...)` validates required saved fields, selected future start term, and one/two selected `module_offerings`; derives declaration version/hash inside the RPC; captures applicant auth user, person, timestamp, IP, and user agent; guards against stale unsaved form edits before locking applicant editing; updates the related lead stage to `submitted`; and writes `application.submitted` transactionally. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-23 | `12amathew/application-doc-upload-slots` | Added Phase 1 applicant-owned application evidence slots: required qualification and professional-registration uploads plus optional CV/supporting and funding evidence; validated MIME type, extension, size, and sanitized filenames; uploaded through server actions into private storage; linked slot rows to `managed_files`; wrote `document.uploaded` audit events; and updated final submit to block missing or rejected required slots without adding staff review, offers, registration, or production email configuration. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-24 | `edmonton` workspace | Added the Phase 1 staff application review slice: `/admissions/reviews` lists submitted applications for admissions admins, displays applicant details, intended start term, selected module offerings, POCUS answers, evidence status, and separated restricted support-needs data with `application_support_needs.viewed` audit events; added document verification/reset actions with `document.verified`, `document.rejected`, and `document.verification_reset` audit events; added `application_reviews` and review readiness notes via `application.review_recorded` without implementing offer/rejection email templates, offer issue, offer acceptance, registration, enrolments, finance rows, or production email configuration. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-24 | `12amathew/offer-rejection-decisions` | Added the Phase 1 offer/rejection decision foundation: staff review actions call admin-only `record_application_decision(...)`, require `ready_for_decision` and a decision reason, create `application_decisions`, `application_offers` or `application_rejections`, snapshot one or two offered module offerings, move leads to `offered` or `rejected`, write `offer.issued` or `application.rejected` audit events, and create suppressed correspondence logs against offer/rejection template placeholders without exposing raw staff reasons to applicants, marking `last_contacted_on`, sending applicant emails, or touching accept/decline, registration, cron, enrolments, finance, or production SMTP setup. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-28 | `georgetown` workspace | Added the Phase 1 applicant offer response slice: `/portal` shows the current applicant offer and offered module snapshot after magic-link login; applicant actions call `respond_to_application_offer(...)`, which only accepts issued unexpired offers owned by the applicant, records accepted/declined timestamp plus auth user/person/IP/user-agent metadata, moves leads to `accepted` or `offer_declined`, writes `offer.accepted` or `offer.declined` audit events, and creates suppressed confirmation correspondence logs with template version and null provider message ID. Accepted offers show registration as the next step, without building registration, lapse cron, enrolments, finance rows, or production SMTP. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-07-28 | `12amathew/offer-deadlines-lapsed-reminders` | Added the Phase 1 offer deadline/reminder/lapse slice: issued offers now require a deadline and default to 14 days when staff leave it blank; reminder and lapsed-offer correspondence placeholders are suppressed; admissions admins can manually run `process_application_offer_deadline_workflow(...)` to log one reminder eligibility event for offers due within the configured window and mark overdue issued offers as `lapsed`/`offer_lapsed`; staff and portal UIs show deadlines, deadline-passed, reminder, and lapsed state. No production scheduler, real email delivery, registration, enrolments, finance, or capacity changes were added. | `npm run lint`; `npm run test`; `npm run build`; `git diff --check origin/main...`. |
| 2026-07-28 | `jakarta` workspace | Added the Phase 2 accepted-offer registration wizard foundation: `/portal/registration` is gated to authenticated applicants with accepted offers; `admissions_registrations` tracks `not_started`/`in_progress`/`submitted`; registration is prefilled from person/application/offer data; applicants confirm accepted course/modules with immutable displayed snapshot fields, update versioned personal details, upload required identity and qualification evidence plus optional student ID photo, save drafts, and submit with active database T&C version/hash/person/auth/IP metadata after saving current form fields; staff review/admin shows submitted registration status. Conversion, student activation, enrolments, finance rows/invoices, lapsed/reopened registration, and production email remain out of scope. | `npm run lint`; `npm run test`; `npm run build`; `git diff --check origin/main...`. |
| 2026-07-29 | `12amathew/admissions-registration-conversion` | Added the Phase 2 registration conversion slice: admissions admins can convert submitted registrations that pass required checks; `convert_submitted_admissions_registration(...)` stages and calls the transactional conversion RPC; conversion creates or activates the person-linked student, creates planned initial enrolments from the accepted registration/offer snapshot, links registration/application/offer/lead conversion metadata, marks the lead `registered`, promotes the portal identity to student, blocks unauthorized or incomplete conversions, disables the old accepted-lead direct conversion action, removes authenticated direct access to the lower-level conversion RPC, and returns idempotently after repeated conversion. Finance rows, invoices, payments, real emails, capacity/waitlist changes, and registration lapsed/reopened flows remain out of scope. | `npm run lint`; `npm run test`; `npm run build`; `git diff --check origin/main...`. |
| 2026-07-31 | `monterrey-v3` | Added Phase 2 registration lapsed/reopened workflow: interim 14-day registration deadlines, manual staff/admin lapse processor for overdue in-progress/submitted registrations, mandatory-reason reopen action for lapsed unconverted registrations, audit/correspondence metadata for lapsed and reopened notices, reopened-registration resubmission clearing, applicant/staff UI state, and conversion/submission blocking while lapsed. | `npm run lint`; `npm run test`; `npm run build`; `git diff --check origin/main...`. |
| 2026-07-31 | `12amathew/termly-module-preference-windows` | Started Phase 3 with termly module preference window foundations: admin lifecycle draft/open/closed/confirmed, configurable existing module offerings per selected term, student portal submissions for 0/1/2 explicitly ordered first/second preferences while open, narrow current-active-student RPC for portal lookup, same-row updates for repeat submissions, server-side offering availability checks, audit events, and staff submitted/missing visibility. Enrolment confirmation, finance rows, capacity locking, waitlists, reminders, and cancellation remain out of scope. | `npm run lint`; `npm run test`; `npm run build`; `git diff --check origin/main...`. |
| 2026-07-31 | `kuala-lumpur` workspace | Added the Phase 3 capacity-safe module preference slice: selected and previously selected `module_offerings` rows are locked during submission/update; planned/in-progress enrolments and other submitted choices consume capacity; repeat submissions keep one student/window row and exclude the student's previous choices before checking new choices; capacity-blocked attempts write `module_preference.capacity_blocked`; staff and student preference screens show capacity counters and full/unavailable state. Waitlists, mandatory-module enforcement, reminders, low-uptake cancellation, enrolment confirmation, finance rows, invoices, payments, real emails, and admissions registration/conversion changes remain out of scope. | `npm run lint`; `npm run test`; `npm run build`; `git diff --check origin/main...`. |
| 2026-08-04 | `maseru` workspace | Started production mailbox integration with feature-flagged SMTP delivery for app-side admissions correspondence, a server-only sender that updates `correspondence_logs` provider/status metadata, staff/applicant email-failure banners, and `npm run email:test` for Outlook/Gmail/NHS.net deliverability checks. Supabase Auth custom SMTP dashboard setup, live credentials, batch reminder/lapse delivery, and external deliverability testing remain pending. | `npm run lint`; `npm run test`; `npm run build`; `npm audit --omit=dev`; `git diff --check origin/main...`. |
| 2026-08-05 | `maseru` workspace | Added Microsoft Graph support to the admissions email provider after Microsoft 365 security defaults blocked password-based SMTP. The app can now send feature-flagged correspondence through Graph `sendMail`, the standalone `npm run email:test` command auto-selects Graph when Graph env vars are present, and local Graph token validation passed without sending email. Live test recipients, workflow enablement, magic-link Graph delivery, and batch reminder/lapse delivery remain pending. | `npm run lint`; `npm run test`; `npm run build`; Graph token check passed. |
| 2026-08-05 | `maseru` workspace | Connected Microsoft Graph delivery to live workflow surfaces behind `ADMISSIONS_EMAIL_ENABLED`: staff application invitations and applicant sign-in links now use Supabase-generated magic links sent by the app through Graph; offer/rejection, offer accept/decline confirmations, and offer deadline reminder/lapse correspondence attempt delivery through the shared provider; admissions admins can send preference-window portal links to missing active students from an open module preference window. Production secret deployment and controlled live workflow tests remain pending; registration lapse/reopen and follow-up preference reminder delivery remain future slices. | `npm run lint`; `npm run test`; `npm run build`; `npm audit --omit=dev`. |
| 2026-08-05 | `maseru` workspace | Added a production database follow-up migration for module catalogue RLS recursion after Vercel logs showed `course_modules`/`module_offerings` infinite-recursion errors and missing `students.person_id` on the live Supabase schema. The new migration replaces cross-referencing module/offering portal policies with equivalent security-definer helper-function policies; production still needs the full pending Supabase migration set applied in order. | `npm run lint`; `npm run test`; `npm run build`. |
| 2026-08-09 | `12amathew/review-admissions-workflow` | Started the staff UX implementation with a seven-stage new-student source projection, inconsistency and primary-action derivation, guarded/audited staff enquiry administration RPCs, removal of the generic stage control, and authenticated direct-write revocation for admission leads. | `npm run lint`; `npm run test` (20 files, 153 tests); `npm run build`; executable PGlite migration/projection/RPC coverage. |
| 2026-08-09 | `12amathew/review-admissions-workflow` | Added submitted-application correction and evidence-decision foundations: one active structured request with field/document targets and due dates; immutable application, draft, resubmission, instruction, review, and replaced-document history; guarded applicant saves/uploads/resubmission; staff accept/revise/cancel and reasoned evidence-override actions; queued log-first correction notices; and offer-time guards for active corrections and required evidence. Correction delivery stays disabled until the fake-record pilot allowlist exists; dedicated correction panels remain a later UI slice. | `npm run lint`; `npm run test` (22 files, 159 tests); `npm run build`; executable PGlite correction/upload/review/decision coverage. |
| 2026-08-09 | `12amathew/review-admissions-workflow` | Added returning-student cycle and participant foundations alongside the untouched legacy preference workflow: one upcoming Published target, guarded Setup/Collecting responses/Review and confirmation phases, selected active/deferred/interrupted bulk groups below 60 formally awarded credits, reasoned individual and additional-study inclusion, explicit eligibility and offering refresh, preserved membership events and opening facts, blocking identity/eligibility projection, advisory planned capacity, and no automatic correspondence on phase changes. | `npm run lint`; `npm run test` (24 files, 163 tests); `npm run build`; executable PGlite eligibility/snapshot/lifecycle/protected-data coverage. |
| 2026-08-09 | `12amathew/review-admissions-workflow` | Added operational-batch and controlled-email foundations: explicit one/selected/all-matching reviewed scopes; immutable targets with queued/succeeded/failed/excluded outcomes; durable progress, idempotent request keys, correspondence linkage, and failure-only retry; audited fake applicant/student pilot markers; server-enforced disabled/pilot/live modes requiring both an allowlisted address and matching fake related record in pilot; immutable reviewed message snapshots; and log-first portal magic links with no persisted token. The background worker, execution-time action-specific eligibility guards, progress/results UI, rate limiting, and actual product-owner pilot remain later slices. | `npm run lint`; `npm run test` (26 files, 171 tests); `npm run build`; executable PGlite batch/retry/RLS/fake-record/protected-data coverage. |
