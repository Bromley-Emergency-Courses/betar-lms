# Admissions and Applications Workflows Spec

Last updated: 2026-07-22

This is the developer-facing build spec for the admissions, application, registration, and student portal work. It is derived from the original PGCert admissions system plan and adjusted for the current BETAR LMS codebase.

Use this document to understand what to build. Use `docs/admissions-workflows-roadmap.md` to track what has been built, what is in progress, and what remains.

## Build Stance

The admissions system will be built inside the existing BETAR LMS application.

Current stack:

- Next.js App Router and TypeScript.
- Supabase Auth, Postgres, and private object storage.
- Staff role model with admin, teacher, and reception roles.
- Existing staff areas for Admissions, Students, Course, Attendance, Staff, Finance, Exams, Imports, and Exports.

Core decisions:

- Keep one database and one application codebase.
- Do not build a separate admissions service.
- Do not sync between two systems.
- Accepted applicants become BETAR students through a database transaction.
- Public applicant/student routes must have a separate auth and RLS boundary from staff routes.
- Expanded finance is deferred until the core admissions and registration flow is stable.

## Scope

The target system covers:

- Public enquiry intake.
- Applicant application portal.
- Application review and decision making.
- Offer, rejection, reminder, and lapse correspondence.
- Offer acceptance or decline.
- Registration after offer acceptance.
- Document upload and staff verification.
- T&C versioning and acceptance capture.
- Conversion from accepted applicant to student.
- Initial module enrolments.
- Existing finance row generation for initial enrolments.
- Continuing-student termly module preferences.
- Deferrals, resits, programme switches, and credit transfers as structured records.
- GDPR support: privacy notices, retention rules, DSAR export support, audit trail, and university sharing/export foundations.

## Explicitly Deferred

Do not build these until admissions, registration, and module preferences are working:

- Sponsor/employer/NHS trust invoicing.
- Invoice PDFs.
- Stripe payment links.
- Stripe payment webhooks.
- Bank transfer reconciliation.
- Dunning/overdue workflows.
- Credit notes and refund processing.
- University remittance ledger.

Until then, registration and preference confirmation should use the existing `finance_records` model where needed.

## Existing Repo Constraints

The current schema stores person fields directly on `students`, including names, email, phone, programme, status, and admission stage.

The current admissions table is `admission_leads`, which is lightweight lead tracking. It is not enough for full applications, document verification, offer history, registration, or applicant portal access.

The current lead conversion action creates a student and then updates the lead in separate writes. The new registration conversion must not use that pattern for public flows.

The current document storage is private, but `student-documents` can be read by teachers. Identity documents, qualification proof, and special category evidence need stricter access rules.

## Route Groups

Use these route boundaries unless there is a strong reason to change them:

- `/admin/*` or the current root staff routes: staff-only LMS areas.
- `/apply/*`: public and applicant-authenticated admissions flow.
- `/portal/*`: authenticated applicant/student portal.
- `/api/*`: route handlers for server-only actions, webhooks, exports, and scheduled jobs.

Do not put applicant/student functionality inside the staff `AppShell`.

Staff pages should continue using staff permission helpers. Applicant/student pages need separate helpers that resolve the authenticated user to a `person`.

## Actors

Staff:

- `admin`: full access, including admissions, finance, sensitive documents, and staff management.
- `teacher`: academic/student access only. No admissions documents, identity documents, finance, or special category data.
- `reception`: reception check-in only.

Applicant:

- Can access only their own enquiry/application/offer/registration rows and documents.
- Can create and update their own draft application until submitted.
- Can accept or decline their own valid offer.

Student:

- Can access only their own portal rows: registration state, module preferences, own invoices/finance summaries where exposed, own personal details, and own correspondence.
- Cannot access staff notes, other students, staff-only finance notes, or special category data unless a deliberate student-facing view is built.

Service:

- Server-only use for privileged mutations, scheduled jobs, webhooks, email delivery updates, and retention jobs.
- Service role keys must never be used client-side.

## Phase 0: Foundation Spec

Phase 0 must be split into small PRs. Do not build the whole foundation in one branch.

Recommended order:

1. `persons` foundation.
2. Applicant/student auth mapping.
3. Storage and RLS hardening.
4. Audit and correspondence logs.
5. Conversion transaction design.

### Persons Foundation

Add a canonical `persons` table. It represents one human across their whole journey.

Minimum fields:

- `id`
- `first_name`
- `last_name`
- `preferred_name`
- `date_of_birth`
- `email`
- `phone`
- `address_line_1`
- `address_line_2`
- `city`
- `postcode`
- `country`
- `created_at`
- `updated_at`

Implementation rules:

- Add `persons` without removing existing `students` fields.
- Backfill one `person` for every existing `student`.
- Add nullable `students.person_id`.
- Populate `students.person_id` during backfill.
- Keep existing screens working from current `students` fields during the transition.
- Do not make `students.person_id` required until all code paths that create students populate it.
- Do not delete or migrate away existing student name/email columns in Phase 0.
- Add indexes for lookup by email and name.
- Decide duplicate handling before enforcing unique email. Applicants may use the same email more than once across intakes or may change email.

Recommended future tables:

- `person_auth_identities`: maps `auth.users.id` to `persons.id` for applicant/student portal users.
- `person_detail_versions`: records historical personal-detail snapshots if versioning is required beyond audit logs.

### Applicant and Student Auth

Use Supabase magic links for applicants and students unless explicitly changed later.

Rules:

- Staff auth remains based on `staff_profiles`.
- Applicant/student auth resolves `auth.users.id` to `person_auth_identities.person_id`.
- One person can move from applicant to student without creating a second portal account.
- Magic-link auth should be email-based.
- If a user changes email, preserve the link to the same person and record the previous email in audit/history.
- Public enquiry can be submitted without login.
- Draft application editing requires applicant auth.
- Offer acceptance requires applicant auth.
- Registration requires applicant auth.
- Module preferences require student auth.

Do not rely on long-lived token links for recurring portal workflows.

### Storage and Documents

Use private buckets only. No public document buckets.

Recommended buckets:

- `application-docs`
- `id-documents`
- `qualification-documents`
- `student-photos`
- `generated-letters`
- `deferral-evidence`

Rules:

- Access files through short-lived signed URLs generated server-side.
- Signed URL generation must perform the same authorization check as the related table row.
- ID documents are admin/admissions-only.
- Qualification documents are admin/admissions-only by default.
- Student photos may be visible to staff who need them, but upload/update remains restricted.
- Special category evidence must be separate from general documents and restricted.
- Every staff view/download of an ID document or special category document must be audit logged.
- Validate MIME type, extension, and size on upload.
- Sanitize original filenames.
- Store original filename, content type, size, uploader, and retention class in metadata.
- Raw ID documents should be deleted after verification plus the agreed buffer period.

### Audit Log

Use append-only audit events for sensitive and workflow-changing actions.

Must log:

- Application submission.
- Application review.
- Offer issue, withdrawal, acceptance, decline, and lapse.
- Registration completion.
- Student conversion.
- Document upload, verification, rejection, view, and deletion.
- T&C version creation and acceptance.
- Programme switch request and approval status changes.
- Credit transfer request and approval status changes.
- Deferral request and approval status changes.
- Resit creation and result cap application.
- Finance edits.
- Retention/deletion jobs.

Audit records should include:

- actor type: staff, applicant, student, service.
- actor user ID where available.
- entity type and ID.
- action.
- timestamp.
- reason/note where applicable.
- metadata with sensitive fields redacted.

### Correspondence Log

Add correspondence logging before sending automated emails.

Log:

- person.
- related application/offer/registration/window/invoice where applicable.
- template key.
- template version.
- rendered subject.
- provider message ID.
- delivery status.
- bounce status.
- sent timestamp.

Templates should be versioned. Generated PDFs should be stored in `generated-letters` where a formal letter is required.

### Conversion Transaction

Public registration conversion must be one database transaction.

It should:

- Verify the offer is accepted and registration is complete.
- Create or update the canonical person.
- Create or activate the student row.
- Link student to person.
- Carry over programme and start term.
- Carry over verified documents as managed records/metadata.
- Store T&C acceptance.
- Create initial enrolments.
- Generate expected finance rows using the existing finance model.
- Mark registration as complete.
- Mark the application/student lifecycle state consistently.
- Write audit events.

Do not implement this as a sequence of unrelated client-side writes.

## Phase 1: Enquiry, Application, Review, Offer

### Applicant Lifecycle

Use this state machine:

```text
enquiry
  -> application_invited
  -> submitted
  -> offer_issued
  -> offer_accepted
  -> registration_in_progress
  -> registered
```

Alternative terminal or reversible states:

```text
submitted -> rejected
offer_issued -> offer_lapsed
offer_issued -> offer_declined
offer_issued -> offer_withdrawn
registration_in_progress -> registration_lapsed
registration_lapsed -> registration_in_progress
```

Rules:

- Every transition writes an audit event.
- Decision transitions require staff actor, decision reason, and timestamp.
- Offer lapse can be service-driven by scheduled job.
- Staff can reissue an offer with a new deadline.
- Staff can reopen lapsed registration with an audit reason.

### Enquiry

Public enquiry should collect enough to create a lead:

- first name.
- last name.
- email.
- phone.
- programme interest.
- module interests.
- source if known.
- message/notes.

Bot protection should be added before go-live.

Staff must still be able to manually log enquiries that arrive by email or phone.

### Application

Application form should support draft save and later submission.

Minimum sections:

- personal details.
- programme choice: PGCert or microcredential.
- intake/start term preference.
- module interests.
- qualifications.
- work experience.
- personal statement or supporting statement.
- document uploads.
- declaration.

Rules:

- Applicants can edit drafts.
- Applicants cannot edit submitted applications unless staff reopen them.
- Submission timestamp is stored.
- Submitted application enters staff review queue.
- Validation should prevent submission until required fields and required document slots are present.

### Documents

Application documents need verification states:

```text
unverified -> verified
unverified -> rejected
rejected -> unverified
```

Each document record should include:

- application.
- person.
- kind.
- storage bucket/path.
- original filename.
- MIME type.
- size.
- verification status.
- verifier.
- verification timestamp.
- verification note.
- retention class.

### Staff Review

Review screen must support:

- viewing submitted application data.
- viewing documents through authorized signed URLs.
- marking documents verified/rejected.
- recording decision.
- recording decision reason.
- issuing offer.
- rejecting application.

One reviewer may decide, but reviewer identity and decision reason are mandatory.

### Offers

Offer records should include:

- application.
- offer reference.
- programme.
- intended start term.
- offered modules if applicable.
- letter template version.
- issued timestamp.
- deadline timestamp.
- status.
- accepted/declined/lapsed timestamp.
- acceptance metadata: auth user, IP, T&C/offer version where applicable.

Default offer deadline is open until the business confirms it. Proposed default: 14 days.

Offer emails must not be the only source of truth. The portal must show the current offer state.

### Emails and Letters

Phase 1 template set:

- application invitation.
- application submitted confirmation.
- offer issued.
- rejection.
- offer reminder.
- offer lapsed.
- offer accepted confirmation.
- offer declined confirmation.

University sample letters are required before final wording is locked.

## Phase 2: Registration and Conversion

Registration starts after offer acceptance.

Wizard steps:

1. Confirm course of study.
2. Check and update personal details.
3. Upload identity and qualification documents.
4. Upload student ID photo if required.
5. Agree to T&Cs.

Rules:

- Registration should prefill from application/person data.
- Changes to personal details must be versioned or audited.
- Required document slots must be filled before completion.
- Staff verification can happen before or after registration submission, depending on business policy, but raw ID retention rules still apply.
- T&Cs must be versioned.
- Acceptance must record version/hash, person, auth user, timestamp, and IP address.
- Completion calls the conversion transaction.

Registration states:

```text
not_started
in_progress
submitted
complete
lapsed
reopened
```

The exact state names may differ, but the lifecycle must distinguish incomplete, submitted for staff checks, complete, and lapsed/reopened.

## Phase 3: Termly Module Preferences

Preference windows replace Google Forms and email chasing.

Window lifecycle:

```text
draft -> open -> closed -> confirmed
```

Staff can:

- create a window for a term.
- select offered module offerings.
- set open and close dates.
- set capacity and waitlist behavior per offering.
- publish the window.
- send reminders.
- close the window.
- review selections.
- confirm enrolments.
- cancel low-uptake offerings.

Students can:

- choose 0, 1, or 2 modules.
- explicitly skip the term with 0 modules.
- see full modules as unavailable or join waitlist if enabled.
- update selections while the window is open, subject to capacity.

Capacity rule:

- Selection must be capacity-safe.
- Use a database transaction and row locking or equivalent.
- Do not allow oversubscription under concurrent submissions.

Mandatory module rule:

- Start simple.
- Warn students early if they have not completed the mandatory module.
- Enforce mandatory selection only near completion when avoiding it would prevent PGCert completion.
- Always allow staff override with an audit reason.
- Defer complex runway calculations unless the business confirms they are needed.

Cancellation rule:

- Staff cancellation should reopen affected student selections or trigger staff remediation.
- Enrolments and finance rows created from a cancelled offering must be removed or adjusted by the same sanctioned action.

Confirmation:

- Confirming a window creates enrolments.
- Confirming a window generates expected finance rows using the current finance model.
- Non-responders should be visible to staff.

## Deferrals and Resits

Model deferrals as first-class records.

Deferral request fields:

- student.
- module offering or exam.
- reason.
- evidence document if provided.
- status.
- university approval status where required.
- decision date.
- decision reference.

Suggested states:

```text
requested -> sent_to_university -> approved
requested -> sent_to_university -> rejected
requested -> withdrawn
```

Rules:

- Max one approved deferral per student per module.
- Approved deferral expects the student at the next available sitting.
- Health/medical evidence may include special category data and must use restricted storage/access.

Resits:

- Missing an exam without approved deferral should create or allow creation of a resit record.
- Failed exams should create or allow creation of a resit record.
- Resit scores are capped at 50%.
- The cap must be stored structurally, not just written in notes.
- Exams/result import logic must not silently store an uncapped mark for capped resit outcomes.

## Programme Switches and Credit Transfers

University-dependent items must be built as structured placeholders until the university confirms process and format.

Programme switches:

- student/person.
- from programme.
- to programme.
- reason.
- requested date.
- university approval status.
- decision reference/date.
- audit trail.

Credit transfers:

- person/student.
- source programme or microcredential modules.
- modules/credits requested.
- modules/credits approved.
- university approval status.
- approver/reference/date.

Rule from the plan:

- Microcredential to PGCert credit carry-over applies to fewer than 4 completed modules, subject to university approval.

Do not make automated award/progress decisions from credit transfer rows until approval state is final.

## Compliance Requirements

Compliance docs start early and can be refined as university requirements land.

Required deliverables:

- Applicant privacy notice.
- Student privacy notice.
- DPIA.
- RoPA.
- Appropriate policy document for special category data.
- Breach runbook.
- Retention schedule.
- Data sharing agreement framework with the university.

Data-sharing relationship:

- Treat BETAR/company and the university as controllers unless formal advice or signed DSA says otherwise.
- University-specific export formats are placeholders until the university gives a spec.

Special category data:

- Store disability/learning support and health evidence separately from general profile/application fields.
- Restrict access to admin or explicitly authorized roles.
- Exclude from generic exports by default.
- Audit access.

Retention defaults to encode once approved:

- Enquiries not converting: 12 months from last contact.
- Unsuccessful/lapsed applications: 12 months from decision, then delete documents and anonymize application row.
- Raw ID documents: delete once verified plus agreed buffer, proposed 90 days after registration completion.
- Qualification proof: duration of study plus 12 months unless university requires longer.
- Student ID photo: duration of study plus 6 months.
- Student academic records: 6 years post-completion in BETAR; university keeps award record.
- Finance records: 6 years from end of financial year.
- Audit log: 6 years.

Retention jobs:

- Must log what was deleted/anonymized.
- Must support dry-run or review mode before destructive production runs.

## RLS and Security Acceptance Criteria

Every new admissions table must have RLS enabled.

At minimum, tests or testable policies must prove:

- Applicant can read and update only their own draft application.
- Applicant cannot read another applicant.
- Applicant cannot edit after submission unless reopened.
- Student can read only their own portal data.
- Teacher cannot read applications, identity documents, finance, or special category data.
- Reception cannot read admissions or portal data.
- Admin can manage admissions.
- Service role is used only server-side.

Security rules:

- No public buckets.
- No service role key in browser code.
- Webhooks verify signatures.
- Scheduled jobs are idempotent.
- Email actions write correspondence logs.
- Sensitive document access writes audit logs.

## Accessibility

Applicant and student-facing pages should target WCAG 2.2 AA.

Implementation expectations:

- Semantic form markup.
- Labels for every input.
- Error messages linked to fields.
- Visible focus states.
- Keyboard-usable controls.
- No timeout that discards unsaved application work.
- Draft autosave for long forms.
- Upload alternatives handled by staff process where needed.

## Phase Acceptance Criteria

Phase 0 is complete when:

- `persons` exists and existing students are backfilled.
- Staff screens still work.
- Applicant/student auth mapping is defined or implemented.
- Storage/RLS approach is tightened for sensitive documents.
- Audit and correspondence foundations exist.
- Conversion transaction design is documented or implemented.

Phase 1 is complete when:

- An applicant can submit an application.
- Staff can review it.
- Staff can issue an offer or rejection.
- Applicant can accept, decline, or let offer lapse.
- Emails/correspondence are logged.

Phase 2 is complete when:

- Accepted applicant can complete registration.
- T&C acceptance is recorded with version metadata.
- Registration conversion creates/activates student record without re-keying.
- Initial enrolments and expected finance rows are created.

Phase 3 is complete when:

- Staff can open a preference window.
- Students can submit 0, 1, or 2 module preferences.
- Capacity cannot be oversubscribed.
- Staff can confirm enrolments.
- Existing finance records are generated from confirmed enrolments.

Phase 4 remains deferred until explicitly reprioritized.

Phase 5 is complete when:

- Required compliance documents exist.
- Retention rules and deletion/anonymization jobs exist.
- DSAR export support exists.
- University export exists at least in generic CSV form.

## New Branch Instructions

For any new admissions-related workspace:

1. Read `README.md`.
2. Read this spec.
3. Read `docs/admissions-workflows-roadmap.md`.
4. Implement one small roadmap slice.
5. Run the narrowest relevant checks.
6. Update the roadmap implementation log and task status before finishing.

