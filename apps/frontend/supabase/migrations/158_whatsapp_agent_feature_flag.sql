-- v14.0 / V140-WA-007
-- Feature flag por tenant para activar el canal agéntico de WhatsApp en modo piloto

create table if not exists public.whatsapp_agent_feature_flag (
  tenant_id uuid primary key references public.tenant(id) on delete cascade,
  enabled boolean not null default false,
  rollout_stage text not null default 'disabled',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_whatsapp_agent_feature_flag_updated_at on public.whatsapp_agent_feature_flag;
create trigger trg_whatsapp_agent_feature_flag_updated_at
  before update on public.whatsapp_agent_feature_flag
  for each row execute function moddatetime(updated_at);

alter table public.whatsapp_agent_feature_flag enable row level security;

drop policy if exists whatsapp_agent_feature_flag_tenant_select on public.whatsapp_agent_feature_flag;
create policy whatsapp_agent_feature_flag_tenant_select
  on public.whatsapp_agent_feature_flag
  for select
  using (tenant_id = public.current_tenant_id());

