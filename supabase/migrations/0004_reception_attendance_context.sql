create policy "reception read students for attendance"
  on public.students for select
  using (public.is_reception());

create policy "reception read terms for attendance"
  on public.terms for select
  using (public.is_reception());

create policy "reception read modules for attendance"
  on public.course_modules for select
  using (public.is_reception());

create policy "reception read offerings for attendance"
  on public.module_offerings for select
  using (public.is_reception());

create policy "reception read enrolments for attendance"
  on public.enrolments for select
  using (public.is_reception());
