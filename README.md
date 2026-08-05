# BETAR LMS Admin MVP

Production-oriented MVP scaffold for BETAR's PGCert POCUS learning management system.

## Stack

- Next.js App Router and TypeScript
- Supabase Auth, PostgreSQL, and private object storage
- Vitest for domain-rule coverage

## Staff Guide

See [docs/staff-user-guide.md](docs/staff-user-guide.md) for a non-technical how-to guide covering daily LMS workflows.

## Admissions Workflow Development

For admissions, application, registration, and student portal work, read [docs/admissions-workflows-spec.md](docs/admissions-workflows-spec.md) and [docs/admissions-workflows-roadmap.md](docs/admissions-workflows-roadmap.md) before making changes. Use the spec to understand what to build, and keep the roadmap current before opening or merging branches so future workspaces know what has changed and what remains.

## Run Locally

```bash
npm install
npm run dev
```

The app runs with seeded demo data when Supabase environment variables are not configured.

## Supabase Setup

1. Create a Supabase project in a UK/EU region.
2. Copy `.env.example` to `.env.local` and fill in the Supabase keys.
3. Apply `supabase/migrations/0001_betar_lms_schema.sql`.
4. Apply `supabase/migrations/0002_storage_buckets.sql`.
5. Create the first admin user:

```bash
npm run admin:create -- admin@example.com "Admin Name"
```

The script prints a generated temporary password unless you pass one as the third argument.

## Verification

```bash
npm run lint
npm run test
npm run build
```

## Admissions Email Delivery

Applicant magic links are sent by Supabase Auth, so production magic-link delivery must be configured in the Supabase dashboard with the organisation mailbox as custom SMTP.

For app-sent admissions correspondence, set the `ADMISSIONS_EMAIL_*` variables plus either the `MICROSOFT_GRAPH_*` or `SMTP_*` variables from `.env.example` in `.env.local` or the production secret store. Microsoft Graph is preferred when Microsoft 365 security policy blocks password-based SMTP. Keep `ADMISSIONS_EMAIL_ENABLED=false` until delivery has been tested.

To send mailbox test messages:

```bash
npm run email:test -- --to internal@example.org,gmail@example.com,user@nhs.net
```

The admissions workflow sends offer/rejection and offer-response confirmation emails only when `ADMISSIONS_EMAIL_ENABLED=true`; otherwise correspondence remains logged without delivery. The standalone `email:test` command can test Graph or SMTP from `.env.local` without enabling workflow sends.
