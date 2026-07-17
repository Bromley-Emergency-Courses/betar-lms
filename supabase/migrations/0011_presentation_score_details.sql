alter table public.presentation_scores
  add column if not exists presentation_type text check (presentation_type in ('case_presentation', 'journal_club')),
  add column if not exists duration_minutes integer check (duration_minutes is null or duration_minutes > 0);
