-- v10.0 / V100-WA-002
-- Resolucion de sucursal (auto + fallback conversacional)

create type public.whatsapp_branch_resolution_status as enum (
  'resolved_auto',
  'resolved_manual',
  'ambiguous',
  'not_found'
);

alter table public.whatsapp_processing_job
  add column if not exists from_wa_id text,
  add column if not exists to_phone_number_id text,
  add column if not exists branch_id uuid references public.sucursal(id) on delete set null,
  add column if not exists branch_resolution_status public.whatsapp_branch_resolution_status,
  add column if not exists branch_resolution_reason text,
  add column if not exists branch_prompt_requested_at timestamptz,
  add column if not exists branch_prompt_deadline_at timestamptz;

create table if not exists public.whatsapp_branch_rule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  from_wa_id text,
  phone_number_id text,
  proveedor_id uuid references public.proveedor(id) on delete set null,
  sucursal_id uuid not null references public.sucursal(id) on delete cascade,
  prioridad integer not null default 0,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_outbound_message (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  to_wa_id text not null,
  phone_number_id text,
  body text not null,
  status text not null default 'queued',
  related_job_id uuid references public.whatsapp_processing_job(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_whatsapp_job_branch_pending
  on public.whatsapp_processing_job(tenant_id, status, branch_prompt_deadline_at);

create index if not exists idx_whatsapp_branch_rule_lookup
  on public.whatsapp_branch_rule(tenant_id, activa, from_wa_id, phone_number_id, prioridad desc);

create index if not exists idx_whatsapp_outbound_status
  on public.whatsapp_outbound_message(tenant_id, status, created_at);

alter table public.whatsapp_branch_rule enable row level security;
alter table public.whatsapp_outbound_message enable row level security;

drop policy if exists whatsapp_branch_rule_tenant_select on public.whatsapp_branch_rule;
create policy whatsapp_branch_rule_tenant_select
  on public.whatsapp_branch_rule
  for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_outbound_message_tenant_select on public.whatsapp_outbound_message;
create policy whatsapp_outbound_message_tenant_select
  on public.whatsapp_outbound_message
  for select
  using (tenant_id = public.current_tenant_id());
