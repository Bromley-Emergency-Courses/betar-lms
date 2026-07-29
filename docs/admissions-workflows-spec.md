# Admissions and Applications Workflows Spec

Last updated: 2026-07-28

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
- Production applicant emails must not use Supabase's default email sender. Use Supabase Auth custom SMTP with the organisation-approved Microsoft 365/Outlook sender before real applicant invitation or offer email sends at scale. Missing SMTP access blocks go-live and live cohort sends, but it should not block ordinary feature development.
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

The current `applications` table is an early draft-save slice. It stores programme, broad module interests, professional details, one qualification summary, work experience, and a supporting statement. The expanded application work should extend or migrate this slice rather than creating a second unrelated application model.

The current public enquiry flow accepts broad `course_modules` interests through `admission_leads.module_interest_ids`. Keep that meaning for `/apply`; do not treat enquiry interests as intended first-term module choices.

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

Production email delivery requirement:

- Supabase Auth magic links may remain the auth mechanism, but their delivery must use custom SMTP in production.
- Preferred production sender is an organisation-controlled Microsoft 365/Outlook mailbox such as `admissions@...`, `applications@...`, or `no-reply@...`.
- Do not rely on Supabase's default email sender for applicant invitations, offer emails, reminders, or registration access. It is suitable only for development/demo testing because of rate limits and best-effort delivery.
- Do not use an `@gmail.com` mailbox as the preferred production sender. It can unblock temporary testing, but it is less official and less controlled than an organisation-domain Microsoft 365 sender.
- Before go-live, confirm the sender mailbox, SMTP host/port/security, credentials handling, SPF/DKIM/DMARC status, and a deliverability test plan with the person who manages the organisation email/domain.
- Store SMTP credentials only in the Supabase dashboard or production secret store. Never commit mailbox passwords or app passwords to the repository.
- Agents should continue building invitation, review, offer, reminder, correspondence-log, and portal flows while SMTP access is pending. Keep production sends behind configuration/readiness checks so the system cannot be mistaken for production-email-ready.

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

Email-provider rules:

- Application invitations currently use Supabase Auth magic-link email. Future email work should preserve the secure invitation claim flow while switching delivery to configured custom SMTP.
- The configured provider should be Microsoft 365/Outlook unless a later durable decision replaces it with a transactional provider.
- For production readiness, record enough provider metadata to trace sends. Where the provider exposes a message ID, persist it in `correspondence_logs.provider_message_id`.
- Staff-facing send actions should report provider errors clearly instead of silently treating failed email sends as successful invitations.
- Bulk/cohort sends must include batching/rate-limit behavior appropriate to the configured provider.

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

Product rules:

- `/apply` is an enquiry form only.
- Module choices on `/apply` are broad interests, stored as module IDs against `course_modules`.
- Do not ask public enquiry users to choose a specific intake or module offering.
- Do not create applications, selected offerings, enrolments, finance records, or seat reservations from the enquiry form.

### Application

Application form should support draft save and later submission.

Minimum sections:

- personal details.
- contact details.
- professional/employment details.
- qualifications.
- intended programme, start term, and first-term module offerings.
- light nationality, visa, and funding fields.
- optional disability/support-needs information.
- POCUS free-text questions.
- document uploads/evidence.
- preview.
- submission declaration.

Recommended section structure:

- checklist/status.
- personal details.
- contact details.
- professional/employment details.
- qualifications.
- intended study plan.
- nationality/visa.
- funding.
- disability/support needs.
- POCUS questions.
- evidence/document uploads.
- preview and submission.

The applicant UI should be inspired by the university application pattern in the reference screenshots: sectional navigation, mandatory-field status per section, clear field-level validation, uploaded-evidence summary, preview before submit, and a declaration checkbox. It does not need to copy the university visual design exactly.

Personal details should capture, at minimum:

- title.
- first name.
- middle/other forenames where provided.
- last name/family name.
- preferred name/known as.
- previous surname/family name where provided.
- date of birth.
- previous application or previous study with BETAR/university if known.
- partner/university student ID if known.

Contact details should capture, at minimum:

- email.
- phone.
- address line 1.
- address line 2.
- city/town.
- postcode.
- country.
- optional emergency or alternative contact only if the business confirms it is needed before registration.

Professional/employment details should capture, at minimum:

- current clinical role.
- employer/organisation.
- department/specialty.
- professional registration body.
- professional registration number.
- years or summary of relevant clinical experience.

Qualifications should be structured so that multiple qualifications can be captured. Use a child table rather than only widening `applications` if multiple rows are needed. Minimum qualification fields:

- qualification title/level.
- awarding body.
- award year.
- result/classification where provided.
- country where awarded if needed for university reporting.
- related evidence document status.

Study-plan rules:

- Applicants must choose programme before selecting module offerings.
- Applicants must choose intended start term before selecting module offerings.
- `/apply/application` module choices are intended first-term `module_offerings`, not broad interests.
- Selectable offerings must be loaded dynamically from `module_offerings` for the selected term.
- An offering is selectable only when the joined `course_modules.active = true`, the joined `terms.status` is `published` or `active`, and the term is in the future/upcoming intake set. Use `terms.starts_on >= current_date` unless the business explicitly decides that currently active terms should remain selectable until `terms.ends_on`.
- Applicants may select one or two module offerings.
- Selected offerings must all belong to the chosen intended start term.
- These choices do not reserve capacity, do not create enrolments, and do not generate finance records.
- Capacity can be displayed as informational context if already available, but application submission must not decrement capacity or block on projected seat availability unless a later admissions policy says otherwise.
- Existing `applications.module_interest_ids` can remain for backwards compatibility or enquiry-copy context, but the applicant application UI and submission validation should use selected offering IDs.

Recommended schema additions for intended study plan:

- `applications.intended_start_term_id uuid references terms(id)`.
- `application_module_offering_choices` with `application_id`, `offering_id`, `choice_order`/`position`, `created_at`, and `updated_at`.
- Constraints or RPC validation to enforce one or two selected offerings, matching `term_id`, active module, selectable term status, and no duplicate offering.
- RLS allowing applicants to read only their own choices and admins to review them. If a dedicated admissions role is added later, extend the policy deliberately rather than relying on teacher/reception access. Prefer writes through draft/submit RPCs so validation is centralized.

Light nationality/visa/funding fields should capture enough to support university-style application review without building a full international-student compliance workflow yet:

- nationality.
- country of birth or country of ordinary residence if required for university reporting.
- whether the applicant needs a visa/right-to-study check.
- visa/right-to-study notes where provided.
- expected funding source: self-funded, employer/sponsor, NHS/trust, other/unknown.
- sponsor/employer funding organisation and contact only if provided.

Disability/support-needs rules:

- This section is optional.
- Wording must explain that disclosure is used to arrange reasonable adjustments/support and does not negatively affect academic consideration.
- Store disability, long-term condition, learning difficulty, health, and support-needs details separately from the general `applications` row.
- Use a restricted table such as `application_support_needs` and a restricted evidence bucket/retention class if evidence is uploaded.
- Do not include these fields in generic admissions exports, broad staff lists, or teacher-facing screens.
- Staff access must be limited to admins until a dedicated admissions/support role exists, and must write audit events for view/update/download actions.
- Audit metadata must not contain the free-text support detail itself.

POCUS free-text questions:

1. Your previous experience in POCUS.
2. Your motivation to enrol in this course.
3. Briefly discuss a case where POCUS significantly improved your clinical management.
4. Discuss a case where you recognised the limitations of POCUS.

Store these as named fields, not as one generic statement blob, so staff review and future exports can address each answer separately.

Rules:

- Applicants can edit drafts.
- Applicants cannot edit submitted applications unless staff reopen them.
- Submission timestamp is stored.
- Submitted application enters staff review queue.
- Validation should prevent submission until required fields and required document slots are present.
- Draft save may allow incomplete sections, but final submit must run the full required-field and selected-offering validation server-side.
- Final submit must be a dedicated RPC/server action separate from draft save.
- Final submit must set application status to `submitted`, set `submitted_at`, update the related admissions lead stage to `submitted`, and write an `application.submitted` audit event in one transaction.
- Final submit must capture declaration acceptance metadata: declaration text/version or hash, applicant auth user, person, timestamp, IP address where available, and user agent where available.
- The declaration must state that the information submitted is truthful, complete, and accurate; that requested/material information has not been omitted; that the applicant understands the application cannot be changed after submission except by staff reopening; and that personal data will be handled under the relevant privacy notice.
- Submitted application records should preserve an application-time snapshot of the supplied personal/contact/study-plan data even if the person record changes later.
- If draft save updates `persons`, do so through audited server-side logic. Otherwise keep `persons` as the identity/contact source and use application snapshots for review/conversion.

Current Phase 1 submit implementation:

- `submit_application(...)` is the dedicated applicant RPC for final submission and is separate from `save_application_draft(...)`.
- Submission validates the saved application snapshot, the selected intended future start term, and one or two selected `module_offerings`.
- Submission now also requires the Phase 1 application evidence slots marked required to contain a current uploaded document that has not been rejected.
- Submission derives and stores the current declaration version/hash inside the RPC, and captures applicant auth user, person, timestamp, IP address where available, and user agent where available.
- Submission sets `applications.status = 'submitted'`, sets `submitted_at`, updates the related `admission_leads.stage` to `submitted`, and writes `application.submitted` in the same database transaction.
- Submitted applications are locked from applicant editing because draft save only allows draft applications on leads still in `application_invited`.
- The applicant UI disables final submit after draft-field edits until the draft is saved, and the submit server action rejects requests where submitted form fields differ from the saved application snapshot.
- This slice deliberately does not perform staff review, staff document verification, offer issue, registration, or production email configuration.

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

Current Phase 1 application document implementation:

- Applicants upload evidence from `/apply/application` after a draft application exists and before final submission.
- Uploads use fixed applicant-owned slots:
  - required: qualification certificate or transcript.
  - required: professional registration evidence.
  - optional: CV or supporting evidence.
  - optional: funding or sponsor evidence.
- Uploads are handled through a server action using private Supabase storage and service-role storage upload. Applicants do not get broad storage write policy access.
- File validation checks MIME type, extension, size, non-empty content, and sanitized filename before storage upload.
- `application_document_slots` links the application/person/slot to the current `managed_files` row and carries verification status.
- `managed_files` remains the storage metadata source, with application uploads using `application-docs` or `qualification-documents` and the matching retention class.
- `record_application_document_upload(...)` validates applicant ownership, draft status, lead stage, slot metadata, extension allow-list, file metadata, object path, and backing `storage.objects` existence before creating the managed-file row and slot linkage.
- Each successful upload writes a `document.uploaded` audit event without storing document contents or sensitive free-text metadata.
- Final application submission blocks when required slots are missing, rejected, or no longer linked to a real private storage object, but it does not require staff verification at this stage.
- Staff review UI and document verification actions are implemented as a later Phase 1 slice.
- Offer/rejection decisions, offer issue, registration, and production email configuration remain separate Phase 1/2 slices.

### Staff Review

Review screen must support:

- viewing submitted application data.
- viewing selected intended start term and selected module offerings with module, term, mode, credits, and price/capacity context where useful.
- viewing the four POCUS free-text answers as separate review fields.
- viewing documents through authorized signed URLs.
- marking documents verified/rejected.
- resetting document verification back to unverified where staff need to re-check replacement or ambiguous evidence.
- recording review notes.
- recording decision readiness.
- recording decision reason notes for later offer/rejection workflows.
- showing disability/support-needs information only in a restricted admissions/admin view, separated from the general application review summary.

Staff review must remain separate from offer/rejection email templates, offer issue, offer acceptance, registration, enrolment creation, finance generation, and production email configuration.

Current Phase 1 staff review implementation:

- `/admissions/reviews` is a staff-only admissions/admin screen for submitted applications whose lead is still in `submitted` or `reviewed`.
- The screen shows applicant details, intended start term, selected `module_offerings`, POCUS answers, uploaded evidence status, and a separated restricted support-needs panel.
- Reading disclosed support-needs detail in the staff review screen writes `application_support_needs.viewed` audit events with redacted metadata before rendering the restricted text.
- Application documents continue to use `application_document_slots` linked to `managed_files`; staff can open files through the existing server-authorized signed URL endpoint.
- `verify_application_document_slot(...)` records `unverified`, `verified`, or `rejected` states with verifier, timestamp, note, and audit events: `document.verified`, `document.rejected`, or `document.verification_reset`.
- `application_reviews` stores one review row per application with reviewer, readiness status, review notes, decision reason notes, and last reviewed timestamp.
- `record_staff_application_review(...)` writes `application.review_recorded`, redacts free-text note content from audit metadata, and moves the related lead from `submitted` to `reviewed` only when readiness is `ready_for_decision`.
- The review slice deliberately does not create offer records, send offer/rejection/reminder emails, create enrolments, create finance rows, accept offers, register applicants, or configure production email.

### Offers

Offer records should include:

- application.
- offer reference.
- programme.
- intended start term.
- offered module offerings if applicable.
- letter template version.
- issued timestamp.
- deadline timestamp.
- status.
- accepted/declined/lapsed timestamp.
- acceptance metadata: auth user, IP, T&C/offer version where applicable.

Default offer deadline is implemented as 14 days until the business confirms a different default.

Offer emails must not be the only source of truth. The portal must show the current offer state.

Offer module rules:

- The offer may copy the submitted intended module offerings or staff may adjust them before issue.
- Issuing an offer still must not create enrolments or reserve places.
- The accepted offer and subsequent registration are the source used by conversion to create initial enrolments.

Current Phase 1 decision-foundation implementation:

- Staff can record an offer or rejection from `/admissions/reviews` after the application review is marked `ready_for_decision`.
- `record_application_decision(...)` is admin-only, requires a submitted application whose lead is still in `submitted` or `reviewed`, requires a non-empty decision reason, prevents a second decision on the same application, updates the related lead to `offered` or `rejected`, and writes `offer.issued` or `application.rejected` audit events.
- `application_decisions` stores the staff decision, reason, actor, timestamp, related application, lead, person, and correspondence-log link.
- `application_offers` stores offer reference, programme, intended start term, required deadline, issued timestamp, offer status foundation, letter template snapshot, correspondence-log link, and future acceptance/decline/lapse timestamp columns.
- `application_offer_module_offerings` snapshots one or two application-selected intended module offerings onto the offer without reserving capacity, creating enrolments, or creating finance rows.
- `application_rejections` stores rejection-specific records with reason, actor, timestamp, template snapshot, and correspondence-log link.
- Raw `application_decisions` and `application_rejections` rows are admin-only for now because they contain internal staff decision reasons. A later applicant-facing portal slice should expose only deliberately sanitized offer/rejection content.
- Offer and rejection correspondence template placeholders exist, and each recorded decision creates a `correspondence_logs` row with `delivery_status = suppressed`, placeholder metadata, and `production_email_send_enabled = false`.
- This slice deliberately does not mark `last_contacted_on`, send real applicant emails, configure production SMTP, implement offer accept/decline, registration, reminder/lapse cron, enrolment creation, or finance generation.

Current Phase 1 applicant offer response implementation:

- `/portal` is the applicant/student portal landing page and shows the current applicant offer after magic-link login.
- The portal shows the offer reference, programme, intended start term, offered module offering snapshot, issued date, deadline, and current offer status.
- Applicants can accept or decline only their own `issued` offer before `deadline_at`. Expired, accepted, declined, withdrawn, and lapsed offers are blocked in the portal and by the database RPC.
- `respond_to_application_offer(...)` is the applicant-only RPC for offer responses. It validates the portal actor, person ownership, offer status, deadline, submitted application, non-archived/non-converted lead, and lead stage `offered` in one transaction.
- Accepting an offer sets `application_offers.status = 'accepted'`, stores `accepted_at`, `accepted_by_auth_user_id`, `accepted_by_person_id`, `accepted_ip_address`, and `accepted_user_agent`, moves the related lead to `accepted`, and clears `next_action_on`.
- Declining an offer sets `application_offers.status = 'declined'`, stores `declined_at`, `declined_by_auth_user_id`, `declined_by_person_id`, `declined_ip_address`, and `declined_user_agent`, moves the related lead to `offer_declined`, and clears `next_action_on`.
- Both responses write applicant audit events: `offer.accepted` or `offer.declined`.
- Both responses create suppressed confirmation correspondence logs using template version 1, `delivery_status = suppressed`, and `provider_message_id = null`.

Current Phase 1 offer deadline/reminder/lapse implementation:

- `application_offers.deadline_at` is required for issued offers. Existing issued offers without deadlines are backfilled to a future 14-day deadline, and new offers default to `now() + interval '14 days'` when staff leave the offer deadline blank.
- `process_application_offer_deadline_workflow(...)` is an admin-only reusable RPC/manual workflow. It accepts a reference timestamp and reminder window in days, currently wired to a staff button on `/admissions/reviews`.
- The manual workflow records one suppressed `offer_deadline_reminder` correspondence log and `offer.reminder_eligible` audit event for each issued offer whose deadline is approaching within the configured window and has not already had reminder eligibility logged.
- The manual workflow marks overdue issued offers as `application_offers.status = 'lapsed'`, stores `lapsed_at`, moves the related lead to `offer_lapsed`, clears `next_action_on`, writes an `offer.lapsed` audit event, and creates a suppressed `offer_lapsed_notice` correspondence log.
- Reminder and lapse correspondence logs keep `delivery_status = suppressed`, `production_email_send_enabled = false`, and `provider_message_id = null`. They are placeholders only and do not send real email.
- Staff review/admin UI now includes submitted, offered, accepted, declined, and lapsed offer-stage applications. It shows offer reference, status, deadline, deadline-passed state, reminder logging state, and lapsed state, plus the manual deadline workflow trigger.
- Applicant portal UI shows deadline, lapsed state, and deadline-passed state clearly. The portal/database remains the source of truth.
- This slice deliberately does not add a production scheduler/cron, Microsoft 365 SMTP configuration, real applicant sends, registration wizard, enrolments, finance rows, or module capacity changes.
- Accepted offers show a clear portal state that registration is the next step. The registration wizard, conversion, enrolments, finance rows, production scheduling, and production SMTP configuration remain separate future tasks.

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

Delivery requirements:

- Do not build production email templates assuming Supabase's default email sender.
- Before enabling real applicant sends, configure Supabase Auth custom SMTP against the organisation-approved Microsoft 365/Outlook sender.
- Test deliverability to internal Outlook recipients, Gmail recipients, and likely applicant workplace domains before admissions go-live.
- Keep portal state as the source of truth. Email is a notification/access mechanism, not the authoritative offer/application state.
- SMTP setup can be delayed while building templates and workflows, provided live applicant sends remain disabled or visibly unverified.

## Phase 2: Registration and Conversion

Registration starts after offer acceptance.

Wizard steps:

1. Confirm course of study.
2. Confirm intended first-term module offerings from the accepted offer/application.
3. Check and update personal details.
4. Upload identity and qualification documents.
5. Upload student ID photo if required.
6. Agree to T&Cs.

Rules:

- Registration should prefill from application/person data.
- Changes to personal details must be versioned or audited.
- Required document slots must be filled before completion.
- First-term module confirmation must continue to validate that selected offerings are active for the accepted term before conversion creates enrolments.
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

Current Phase 2 registration foundation implementation:

- `/portal/registration` is gated by the applicant portal auth boundary and database RPCs to authenticated applicants whose own `application_offers.status = 'accepted'`.
- Starting registration calls `begin_admissions_registration(...)`, creates an `admissions_registrations` row in `in_progress`, moves the related lead to `registration_in_progress`, snapshots accepted offer programme/start term/module offerings with immutable displayed term/module/price/capacity fields, pre-fills personal details from application/person/lead data, creates required document slots, stores initial personal-detail version 1, and writes `registration.started`.
- Registration distinguishes `not_started` in the portal when no registration row exists, then persists `in_progress` and `submitted` in `admissions_registration_status`.
- Draft save calls `save_admissions_registration(...)`, updates the registration snapshot only while `in_progress`, preserves personal-detail versions in `admissions_registration_person_detail_versions` when details change, records module confirmation metadata, and writes `registration.saved`.
- Registration document uploads use private storage plus `managed_files`, following the application-document pattern. Required slots are `identity_evidence` in `id-documents` and `qualification_evidence` in `qualification-documents`; optional `student_id_photo` uses `student-photos`. Successful uploads write `document.uploaded`.
- T&Cs are versioned in `admissions_registration_terms_versions`. The portal reads the active version/text from the database, and the submit server action fetches the active version/hash before calling `submit_admissions_registration(...)`. Final submit saves the current draft form fields first, then records version, hash, person, auth user, timestamp, IP address, and user agent, and writes `registration.terms_accepted` and `registration.submitted`.
- Final registration submission validates required personal details, confirmed offer modules, active accepted-term offerings, required uploaded identity/qualification slots, and current T&C acceptance.
- `/portal` shows registration not-started/in-progress/submitted states for accepted offers, and `/admissions/reviews` shows registration status to admissions admins.
- This slice deliberately does not call `convert_admissions_registration(...)`, create or activate student records, create enrolments, create finance rows or invoices, send emails, add a scheduler, or implement registration lapsed/reopened workflow.

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
- Applicant cannot select module offerings before choosing programme and intended start term.
- Applicant cannot submit fewer than one or more than two intended first-term module offerings.
- Applicant cannot select offerings outside their intended start term.
- Applicant cannot select offerings whose module is inactive or whose term is not selectable.
- Application module choices do not create enrolments, finance rows, or reservations.
- Support-needs/special category rows and evidence are not readable by teachers, reception, other applicants, or generic staff views.
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
- The submitted application contains personal, contact, professional/employment, qualification, study-plan, nationality/visa/funding, POCUS answers, declaration, and optional support-needs sections.
- Intended module selections are one or two valid future `module_offerings` for the selected start term and programme flow.
- Submitting the application does not create enrolments, finance rows, or seat reservations.
- Staff can review it.
- Staff can issue an offer or rejection.
- Applicant can accept, decline, or let offer lapse.
- Production application invitation and offer/reminder email delivery is configured through organisation-approved SMTP/provider, not Supabase's default sender.
- Application invitation deliverability has been tested across representative recipient domains before go-live.
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
