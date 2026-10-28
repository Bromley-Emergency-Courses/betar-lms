alter function public.execute_assessment_command(jsonb,integer) rename to execute_assessment_command_v3;
revoke all on function public.execute_assessment_command_v3(jsonb,integer) from public, anon, authenticated, service_role;

create function public.execute_assessment_command(command jsonb, expected_revision integer) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assessment_require_admin();
  if command->>'type' in ('MatchSourceResult','UnmatchSourceResult','ReplaceSourceResult','VoidSourceResult','RestoreSourceResult') then
    raise exception 'Manual import matching and legacy source changes are disabled. Use the guarded result correction/exclusion/restoration workflow for an existing result; unresolved imports remain pending reconciliation.';
  end if;
  return public.execute_assessment_command_v3(command, expected_revision);
end;
$$;
revoke all on function public.execute_assessment_command(jsonb,integer) from public, anon, service_role;
grant execute on function public.execute_assessment_command(jsonb,integer) to authenticated;
