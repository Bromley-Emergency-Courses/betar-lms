alter table public.exam_results
  add column if not exists is_resit boolean not null default false,
  add column if not exists attempt_number integer not null default 1 check (attempt_number > 0),
  add column if not exists resit_of_result_id uuid references public.exam_results(id) on delete set null,
  add column if not exists prior_attempt_missing boolean not null default false;

create index if not exists exam_results_resit_of_result_id_idx
  on public.exam_results(resit_of_result_id);

create index if not exists exam_results_attempt_lookup_idx
  on public.exam_results(student_id, offering_id, component_type, attempt_number);
