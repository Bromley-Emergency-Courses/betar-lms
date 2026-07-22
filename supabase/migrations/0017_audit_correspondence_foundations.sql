create type public.audit_actor_type as enum ('staff', 'applicant', 'student', 'service');
create type public.correspondence_channel as enum ('email', 'letter');
create type public.correspondence_delivery_status as enum (
  'queued',
  'sent',
  'delivered',
  'failed',
  'bounced',
  'suppressed'
);
create type public.correspondence_bounce_status as enum (
  'none',
  'soft_bounce',
  'hard_bounce',
  'complaint',
  'blocked',
  'unknown'
);

alter table public.audit_events
  drop constraint if exists audit_events_actor_user_id_fkey;

alter table public.audit_events
  add column if not exists actor_type public.audit_actor_type not null default 'staff',
  add column if not exists actor_person_id uuid references public.persons(id) on delete set null,
  add column if not exists reason text;

alter table public.audit_events
  add constraint audit_events_actor_user_id_fkey
  foreign key (actor_user_id) references auth.users(id) on delete set null;

alter table public.audit_events
  add constraint audit_events_metadata_is_object
  check (jsonb_typeof(metadata) = 'object');

create index if not exists audit_events_actor_type_created_at_idx
  on public.audit_events(actor_type, created_at desc);

create index if not exists audit_events_actor_user_id_idx
  on public.audit_events(actor_user_id);

create index if not exists audit_events_actor_person_id_idx
  on public.audit_events(actor_person_id);

create index if not exists audit_events_entity_idx
  on public.audit_events(entity_type, entity_id, created_at desc);

create index if not exists audit_events_action_idx
  on public.audit_events(action);

drop policy if exists "authenticated users append audit events" on public.audit_events;
drop policy if exists "staff and portal users append own audit events" on public.audit_events;
drop policy if exists "active staff append own audit events" on public.audit_events;

create policy "active staff append own audit events"
  on public.audit_events for insert
  with check (
    auth.uid() is not null
    and actor_user_id = auth.uid()
    and actor_type = 'staff'
    and actor_person_id is null
    and exists (
      select 1
      from public.staff_profiles
      where staff_profiles.id = auth.uid()
        and staff_profiles.active = true
    )
  );

create table public.correspondence_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  version integer not null check (version > 0),
  channel public.correspondence_channel not null default 'email',
  description text,
  subject_template text not null,
  body_template text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (template_key, channel, version)
);

create table public.correspondence_logs (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete restrict,
  recipient_email text not null,
  recipient_name text,
  related_entity_type text,
  related_entity_id uuid,
  template_id uuid references public.correspondence_templates(id) on delete restrict,
  template_key text not null,
  template_version integer not null check (template_version > 0),
  channel public.correspondence_channel not null default 'email',
  rendered_subject text not null,
  provider_message_id text,
  delivery_status public.correspondence_delivery_status not null default 'queued',
  bounce_status public.correspondence_bounce_status not null default 'none',
  sent_at timestamptz,
  status_updated_at timestamptz not null default now(),
  generated_file_id uuid references public.managed_files(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (length(trim(recipient_email)) > 3),
  check (
    (related_entity_type is null and related_entity_id is null)
    or (related_entity_type is not null and related_entity_id is not null)
  ),
  check (jsonb_typeof(metadata) = 'object')
);

create or replace function public.touch_correspondence_log_status_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.status_updated_at = now();
  return new;
end;
$$;

create trigger touch_correspondence_logs_status_updated_at
  before update on public.correspondence_logs
  for each row
  execute function public.touch_correspondence_log_status_updated_at();

alter table public.correspondence_templates enable row level security;
alter table public.correspondence_logs enable row level security;

create index correspondence_templates_key_version_idx
  on public.correspondence_templates(template_key, channel, version desc);

create index correspondence_logs_person_id_created_at_idx
  on public.correspondence_logs(person_id, created_at desc);

create index correspondence_logs_recipient_email_idx
  on public.correspondence_logs(lower(recipient_email));

create index correspondence_logs_related_entity_idx
  on public.correspondence_logs(related_entity_type, related_entity_id, created_at desc);

create index correspondence_logs_template_idx
  on public.correspondence_logs(template_key, template_version);

create unique index correspondence_logs_provider_message_id_idx
  on public.correspondence_logs(provider_message_id)
  where provider_message_id is not null;

create policy "admins manage correspondence templates"
  on public.correspondence_templates for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins manage correspondence logs"
  on public.correspondence_logs for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "portal users read own correspondence logs"
  on public.correspondence_logs for select
  using (person_id = public.current_person_id());
