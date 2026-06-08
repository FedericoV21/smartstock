-- v10.0 / V100-WA-001
-- Ingesta inbound WhatsApp + auditoria + jobs de procesamiento

create table if not exists public.whatsapp_channel (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  phone_number_id text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone_number_id)
);

create table if not exists public.whatsapp_inbound_message (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  wamid text not null,
  from_wa_id text not null,
  to_phone_number_id text,
  message_type text not null,
  text_body text,
  metadata jsonb,
  raw_payload jsonb not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (wamid)
);

create table if not exists public.whatsapp_inbound_attachment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  inbound_message_id uuid not null references public.whatsapp_inbound_message(id) on delete cascade,
  wa_media_id text,
  mime_type text,
  filename text,
  sha256 text not null,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  unique (inbound_message_id, sha256)
);

create type public.whatsapp_job_status as enum (
  'queued',
  'processing',
  'imported',
  'review_required',
  'error',
  'awaiting_branch_confirmation'
);

create table if not exists public.whatsapp_processing_job (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  inbound_message_id uuid not null references public.whatsapp_inbound_message(id) on delete cascade,
  inbound_attachment_id uuid references public.whatsapp_inbound_attachment(id) on delete cascade,
  status public.whatsapp_job_status not null default 'queued',
  document_type text,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists public.whatsapp_job_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  job_id uuid not null references public.whatsapp_processing_job(id) on delete cascade,
  event_type text not null,
  event_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_channel_tenant on public.whatsapp_channel(tenant_id);
create index if not exists idx_whatsapp_inbound_tenant_received on public.whatsapp_inbound_message(tenant_id, received_at desc);
create index if not exists idx_whatsapp_attachment_tenant on public.whatsapp_inbound_attachment(tenant_id);
create index if not exists idx_whatsapp_job_tenant_status_created on public.whatsapp_processing_job(tenant_id, status, created_at desc);
create index if not exists idx_whatsapp_job_event_job_created on public.whatsapp_job_event(job_id, created_at desc);

alter table public.whatsapp_channel enable row level security;
alter table public.whatsapp_inbound_message enable row level security;
alter table public.whatsapp_inbound_attachment enable row level security;
alter table public.whatsapp_processing_job enable row level security;
alter table public.whatsapp_job_event enable row level security;

drop policy if exists whatsapp_channel_tenant_select on public.whatsapp_channel;
create policy whatsapp_channel_tenant_select
  on public.whatsapp_channel
  for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_inbound_message_tenant_select on public.whatsapp_inbound_message;
create policy whatsapp_inbound_message_tenant_select
  on public.whatsapp_inbound_message
  for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_inbound_attachment_tenant_select on public.whatsapp_inbound_attachment;
create policy whatsapp_inbound_attachment_tenant_select
  on public.whatsapp_inbound_attachment
  for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_processing_job_tenant_select on public.whatsapp_processing_job;
create policy whatsapp_processing_job_tenant_select
  on public.whatsapp_processing_job
  for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_job_event_tenant_select on public.whatsapp_job_event;
create policy whatsapp_job_event_tenant_select
  on public.whatsapp_job_event
  for select
  using (tenant_id = public.current_tenant_id());
