revoke all on public.active_module_enrolments from public, anon, authenticated, service_role;
grant select on public.active_module_enrolments to authenticated, service_role;
