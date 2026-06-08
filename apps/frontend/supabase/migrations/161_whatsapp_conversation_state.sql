-- v14.1 / V141-WA-001
-- Memoria conversacional corta por actor para follow-ups en WhatsApp.

create table if not exists public.whatsapp_conversation_state (
  actor_id uuid primary key references public.whatsapp_actor(id) on delete cascade,
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  from_wa_id text not null,
  topic text,
  last_intent text,
  last_entity_type text,
  last_entity_name text,
  pending_prompt text,
  last_options jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_conversation_state_tenant_exp
  on public.whatsapp_conversation_state(tenant_id, expires_at desc);

drop trigger if exists trg_whatsapp_conversation_state_updated_at on public.whatsapp_conversation_state;
create trigger trg_whatsapp_conversation_state_updated_at
  before update on public.whatsapp_conversation_state
  for each row execute function moddatetime(updated_at);

alter table public.whatsapp_conversation_state enable row level security;

drop policy if exists whatsapp_conversation_state_tenant_select on public.whatsapp_conversation_state;
create policy whatsapp_conversation_state_tenant_select
  on public.whatsapp_conversation_state
  for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_conversation_state_tenant_insert on public.whatsapp_conversation_state;
create policy whatsapp_conversation_state_tenant_insert
  on public.whatsapp_conversation_state
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_conversation_state_tenant_update on public.whatsapp_conversation_state;
create policy whatsapp_conversation_state_tenant_update
  on public.whatsapp_conversation_state
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
