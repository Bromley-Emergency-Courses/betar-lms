alter table public.assessment_definitions
  add column if not exists score_min integer not null default 0,
  add column if not exists score_max integer not null default 10;

alter table public.assessment_definitions
  drop constraint if exists assessment_definitions_score_range_check;

alter table public.assessment_definitions
  add constraint assessment_definitions_score_range_check check (score_min < score_max);

alter table public.assessment_attempts
  add column if not exists assessed_item_ids text[] not null default '{}',
  add column if not exists overall_score integer;
