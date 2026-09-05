create table public.linq_bridge_config (
  id uuid primary key default gen_random_uuid(),
  ghl_location_id text not null unique,
  linq_org_id text not null,
  owned_lines text[] not null default '{}',
  ingestion_enabled boolean not null default false,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.linq_webhook_events (
  id uuid primary key default gen_random_uuid(),
  linq_event_id text not null unique,
  event_type text not null,
  linq_chat_id text,
  linq_message_id text,
  is_group boolean,
  status text not null default 'received',
  skipped_reason text,
  participants_matched integer not null default 0,
  participants_total integer not null default 0,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index linq_webhook_events_message_idx on public.linq_webhook_events (linq_message_id);
create index linq_webhook_events_status_idx on public.linq_webhook_events (status, received_at desc);

create table public.linq_comment_deliveries (
  id uuid primary key default gen_random_uuid(),
  linq_message_id text not null,
  ghl_contact_id text not null,
  ghl_location_id text not null,
  ghl_conversation_id text,
  linq_chat_id text,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linq_comment_deliveries_unique unique (linq_message_id, ghl_contact_id)
);

create index linq_comment_deliveries_retry_idx on public.linq_comment_deliveries (status, updated_at desc);

grant all on public.linq_bridge_config to service_role;
grant all on public.linq_webhook_events to service_role;
grant all on public.linq_comment_deliveries to service_role;

alter table public.linq_bridge_config enable row level security;
alter table public.linq_webhook_events enable row level security;
alter table public.linq_comment_deliveries enable row level security;

create trigger linq_bridge_config_updated_at before update on public.linq_bridge_config
  for each row execute function public.update_updated_at_column();
create trigger linq_comment_deliveries_updated_at before update on public.linq_comment_deliveries
  for each row execute function public.update_updated_at_column();

insert into public.linq_bridge_config (ghl_location_id, linq_org_id, owned_lines, ingestion_enabled)
values ('ZcPPQTHBxBWlnM1WyjvU', '22365', array['+14154980385','+14156040157'], false);