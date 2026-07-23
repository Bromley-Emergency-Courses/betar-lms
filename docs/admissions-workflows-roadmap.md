# Admissions and Applications Workflows Roadmap

Last updated: 2026-07-23

This document is the durable handoff record for the admissions, application, registration, and student portal work. Keep it updated when branches are merged so new Conductor workspaces created from `origin/main` can pick up the current state without needing prior chat context.

Use `docs/admissions-workflows-spec.md` as the developer-facing implementation spec. This roadmap tracks status, decisions, and implementation history.

The workspace-local companion file is `.context/admissions-workflows-handoff.md`. Use that for branch-specific notes, partial work, and immediate next steps.

## Current Direction

- Extend the existing BETAR LMS rather than creating a separate admissions system.
- Keep one Supabase/Postgres system of record so accepted applicants can become students without sync jobs or re-keying.
- Build the first release around the core admissions journey: enquiry/application, review, offer, acceptance, registration, and conversion to student.
- Defer expanded finance work until after the admissions and registration flow is reliable. Existing term finance records can continue to be used in the interim.
- Treat security, RLS, private storage, audit logging, and retention decisions as foundation work, not later polish.

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
- [ ] Staff can manually log enquiries that still arrive by email.
- [ ] Applicant magic-link login.
- [ ] Application form with draft save.
- [ ] Programme choice: PGCert or microcredential.
- [ ] Module interest capture.
- [ ] Work experience, qualification, and statement capture.
- [ ] Document upload slots with file validation.
- [ ] Staff review screen with verification states and decision reasons.
- [ ] Offer, rejection, and reminder email templates.
- [ ] Offer deadline and lapsed-offer cron.
- [ ] Offer accept/decline page in applicant portal.
- [ ] Correspondence log records template version and provider message IDs.

## Phase 2: Registration and Conversion

Status: `Not started`

Goal: accepted applicants complete registration and become BETAR student records with no re-keying.

- [ ] Registration wizard for accepted offers.
- [ ] Confirm course and intended first-term modules.
- [ ] Confirm/update personal details with version history.
- [ ] Upload required identity and qualification documents.
- [ ] Upload student ID photo if required.
- [ ] Version T&Cs and store acceptance metadata.
- [ ] Transactionally create/activate student record.
- [ ] Create initial enrolments.
- [ ] Generate expected finance rows using existing finance model.
- [ ] Handle registration lapsed/reopened states.

## Phase 3: Termly Module Preferences

Status: `Not started`

Goal: replace termly Google Forms/email chasing for continuing students.

- [ ] Staff create preference windows per term.
- [ ] Staff publish offered module list from existing module offerings.
- [ ] Students choose 0, 1, or 2 modules.
- [ ] Capacity-safe selection with database row locking.
- [ ] Waitlist support if enabled for an offering.
- [ ] Mandatory module rule with staff override.
- [ ] Reminder emails for non-responders.
- [ ] Staff cancellation flow for low-uptake offerings.
- [ ] Confirm-enrolments action creates enrolments and expected finance rows.

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

## Open Decisions

- Confirm default offer deadline.
- Confirm default registration deadline.
- Confirm whether applicant/student auth should be magic link only.
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
