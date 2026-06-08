-- Auditoria de turnos del agente WhatsApp.
-- Guarda input, respuesta y traza tecnica por cuenta, con retencion operativa.

create table if not exists public.whatsapp_agent_turn_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  actor_id uuid references public.whatsapp_actor(id) on delete set null,
  usuario_id uuid references public.usuario(id) on delete set null,
  inbound_message_id uuid references public.whatsapp_inbound_message(id) on delete set null,
  action_log_id uuid references public.whatsapp_action_log(id) on delete set null,
  from_wa_id text,
  channel text not null,
  source text not null,
  input_body text not null,
  resolved_message text,
  reply_body text,
  replies jsonb not null default '[]'::jsonb,
  intent text,
  confidence numeric,
  fallback_reason text,
  status text not null,
  tool_name text,
  tool_args jsonb,
  tool_result jsonb,
  tool_trace jsonb,
  processing_trace jsonb not null default '{}'::jsonb,
  duration_ms integer,
  error_detail text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  constraint whatsapp_agent_turn_log_channel_check
    check (channel in ('live', 'sandbox')),
  constraint whatsapp_agent_turn_log_status_check
    check (status in ('success', 'fallback', 'error', 'blocked')),
  constraint whatsapp_agent_turn_log_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint whatsapp_agent_turn_log_duration_check
    check (duration_ms is null or duration_ms >= 0)
);

create index if not exists idx_whatsapp_agent_turn_log_tenant_created
  on public.whatsapp_agent_turn_log(tenant_id, created_at desc);

create index if not exists idx_whatsapp_agent_turn_log_actor_created
  on public.whatsapp_agent_turn_log(actor_id, created_at desc)
  where actor_id is not null;

create index if not exists idx_whatsapp_agent_turn_log_tenant_filters
  on public.whatsapp_agent_turn_log(tenant_id, channel, status, created_at desc);

create index if not exists idx_whatsapp_agent_turn_log_tool_created
  on public.whatsapp_agent_turn_log(tenant_id, tool_name, created_at desc)
  where tool_name is not null;

create index if not exists idx_whatsapp_agent_turn_log_intent_created
  on public.whatsapp_agent_turn_log(tenant_id, intent, created_at desc)
  where intent is not null;

create index if not exists idx_whatsapp_agent_turn_log_expires
  on public.whatsapp_agent_turn_log(expires_at);

alter table public.whatsapp_agent_turn_log enable row level security;

drop policy if exists whatsapp_agent_turn_log_admin_select on public.whatsapp_agent_turn_log;
create policy whatsapp_agent_turn_log_admin_select
  on public.whatsapp_agent_turn_log
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1
      from public.usuario u
      where u.id = auth.uid()
        and u.activo = true
        and (u.rol = 'admin'::public.rol_usuario or u.es_super_admin = true)
    )
  );

grant select on table public.whatsapp_agent_turn_log to authenticated;
grant all on table public.whatsapp_agent_turn_log to service_role;
