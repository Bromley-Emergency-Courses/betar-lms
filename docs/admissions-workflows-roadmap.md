# Admissions and Applications Workflows Roadmap

Last updated: 2026-07-23

This document is the durable handoff record for the admissions, application, registration, and student portal work. Keep it updated when branches are merged so new Conductor workspaces created from `origin/main` can pick up the current state without needing prior chat context.

Use `docs/admissions-workflows-spec.md` as the developer-facing implementation spec. This roadmap tracks status, decisions, and implementation history.

The workspace-local companion file is `.context/admissions-workflows-handoff.md`. Use that for branch-specific notes, partial work, and immediate next steps.

## Current Direction

- Extend the existing BETAR LMS rather than creating a separate admissions system.
- Keep one Supabase/Postgres system of record so accepted applicants can become students without sync jobs or re-keying.
- Build the first release around the core admissions journey: enquiry/application, review, offer, acceptance, registration, and conversion to student.
- Treat the public `/apply` enquiry form and authenticated `/apply/application` form as different product surfaces: enquiry captures broad module interests; application captures intended first-term module offerings after programme and start term are selected.
- Treat production email delivery as a Phase 1 go-live dependency, not a blocker for ordinary feature development. Application invitations currently use Supabase Auth magic links, but Supabase's default email sender is rate-limited and not suitable for cohorts. Continue building the admissions workflow with configurable email delivery, but configure Supabase Auth custom SMTP through the organisation's Microsoft 365/Outlook sender before sending real applicant invitations at scale.
- Defer expanded finance work until after the admissions and registration flow is reliable. Existing term finance records can continue to be used in the interim.
- Treat security, RLS, private storage, audit logging, and retention decisions as foundation work, not later polish.

## Current Application Form Adjustment

The expanded application draft-save slice and transactional final submit/declaration slice are implemented. The remaining application-form work should add repeatable qualification rows if needed and document upload slots before staff review/offers are built.

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
- [ ] Configure production email delivery for Supabase Auth magic links using organisation-approved Microsoft 365/Outlook SMTP rather than Supabase's default sender.
- [ ] Test application invitation deliverability across internal Outlook, Gmail, and likely applicant workplace domains before applicant go-live.
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
- [ ] Document upload slots with file validation.
- [ ] Staff review screen with verification states and decision reasons.
- [ ] Offer, rejection, and reminder email templates.
- [ ] Confirm offer/rejection/reminder emails use the same production email delivery configuration and do not depend on Supabase's default sender.
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
| 2026-07-23 | Keep `/apply` module selections as broad `course_modules` interests and use `module_offerings` only inside authenticated application/registration flows. | Enquiry should stay lightweight, while application and conversion need concrete term-specific choices. |
| 2026-07-23 | Application module choices are intended choices only. | They support admissions review and offer generation but must not reserve capacity, create enrolments, or create finance records before registration conversion. |
| 2026-07-23 | Support-needs/disability information must be separated from general application data. | It can include special category data and needs restricted access, redacted audit metadata, and exclusion from generic exports. |
| 2026-07-23 | Production applicant email must use organisation-controlled Microsoft 365/Outlook SMTP, not the default Supabase email sender. | Supabase's default sender is rate-limited and best-effort; admissions may need hundreds of application invitations and later offer/reminder emails. An `@gmail.com` company mailbox is not preferred for production because it looks less official and is less controlled than the organisation domain. |

## Open Decisions

- Confirm default offer deadline.
- Confirm default registration deadline.
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
