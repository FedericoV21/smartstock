-- v14.2 / V142-WA-001
-- Chat interno de prueba para el agente WhatsApp, aislado del canal Meta real.

create table if not exists public.whatsapp_sandbox_message (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  actor_id uuid references public.whatsapp_actor(id) on delete set null,
  role text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint whatsapp_sandbox_message_role_check
    check (role in ('user', 'assistant', 'system'))
);

create table if not exists public.whatsapp_sandbox_pending_action (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  actor_id uuid not null references public.whatsapp_actor(id) on delete cascade,
  from_wa_id text not null,
  action_type text not null,
  status text not null default 'pending_confirmation',
  action_signature text not null,
  confirmation_token text not null,
  confirmation_expires_at timestamptz not null,
  action_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint whatsapp_sandbox_pending_action_status_check
    check (status in ('pending_confirmation', 'simulated', 'cancelled', 'error'))
);

create index if not exists idx_whatsapp_sandbox_message_user_created
  on public.whatsapp_sandbox_message(tenant_id, usuario_id, created_at asc);

create index if not exists idx_whatsapp_sandbox_pending_action_user_status
  on public.whatsapp_sandbox_pending_action(tenant_id, usuario_id, status, created_at desc);

create unique index if not exists uq_whatsapp_sandbox_pending_action_signature
  on public.whatsapp_sandbox_pending_action(tenant_id, usuario_id, action_signature)
  where status = 'pending_confirmation';

drop trigger if exists trg_whatsapp_sandbox_pending_action_updated_at
  on public.whatsapp_sandbox_pending_action;
create trigger trg_whatsapp_sandbox_pending_action_updated_at
  before update on public.whatsapp_sandbox_pending_action
  for each row execute function moddatetime(updated_at);

alter table public.whatsapp_sandbox_message enable row level security;
alter table public.whatsapp_sandbox_pending_action enable row level security;

drop policy if exists whatsapp_sandbox_message_tenant_user_select
  on public.whatsapp_sandbox_message;
create policy whatsapp_sandbox_message_tenant_user_select
  on public.whatsapp_sandbox_message
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id() and usuario_id = auth.uid());

drop policy if exists whatsapp_sandbox_message_tenant_user_insert
  on public.whatsapp_sandbox_message;
create policy whatsapp_sandbox_message_tenant_user_insert
  on public.whatsapp_sandbox_message
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id() and usuario_id = auth.uid());

drop policy if exists whatsapp_sandbox_message_tenant_user_delete
  on public.whatsapp_sandbox_message;
create policy whatsapp_sandbox_message_tenant_user_delete
  on public.whatsapp_sandbox_message
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id() and usuario_id = auth.uid());

drop policy if exists whatsapp_sandbox_pending_action_tenant_user_select
  on public.whatsapp_sandbox_pending_action;
create policy whatsapp_sandbox_pending_action_tenant_user_select
  on public.whatsapp_sandbox_pending_action
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id() and usuario_id = auth.uid());

drop policy if exists whatsapp_sandbox_pending_action_tenant_user_insert
  on public.whatsapp_sandbox_pending_action;
create policy whatsapp_sandbox_pending_action_tenant_user_insert
  on public.whatsapp_sandbox_pending_action
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id() and usuario_id = auth.uid());

drop policy if exists whatsapp_sandbox_pending_action_tenant_user_update
  on public.whatsapp_sandbox_pending_action;
create policy whatsapp_sandbox_pending_action_tenant_user_update
  on public.whatsapp_sandbox_pending_action
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id() and usuario_id = auth.uid())
  with check (tenant_id = public.current_tenant_id() and usuario_id = auth.uid());

drop policy if exists whatsapp_sandbox_pending_action_tenant_user_delete
  on public.whatsapp_sandbox_pending_action;
create policy whatsapp_sandbox_pending_action_tenant_user_delete
  on public.whatsapp_sandbox_pending_action
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id() and usuario_id = auth.uid());
