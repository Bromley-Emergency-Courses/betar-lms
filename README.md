# BETAR LMS Admin MVP

Production-oriented MVP scaffold for BETAR's PGCert POCUS learning management system.

## Stack

- Next.js App Router and TypeScript
- Supabase Auth, PostgreSQL, and private object storage
- Vitest for domain-rule coverage

## Staff Guide

See [docs/staff-user-guide.md](docs/staff-user-guide.md) for a non-technical how-to guide covering daily LMS workflows.

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
