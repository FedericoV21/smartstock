-- v14.0 / V140-WA-006
-- Acciones WhatsApp con doble confirmacion e idempotencia por action_signature

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'whatsapp_action_status'
      and n.nspname = 'public'
  ) then
    create type public.whatsapp_action_status as enum (
      'pending_confirmation',
      'executed',
      'cancelled',
      'error'
    );
  end if;
end
$$;

create table if not exists public.whatsapp_action_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  actor_id uuid not null references public.whatsapp_actor(id) on delete cascade,
  inbound_message_id uuid references public.whatsapp_inbound_message(id) on delete set null,
  from_wa_id text not null,
  action_type text not null,
  action_status public.whatsapp_action_status not null default 'pending_confirmation',
  action_signature text not null,
  confirmation_token text,
  confirmation_expires_at timestamptz,
  action_payload jsonb not null,
  result_payload jsonb,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  executed_at timestamptz,
  unique (tenant_id, action_signature)
);

create index if not exists idx_whatsapp_action_pending
  on public.whatsapp_action_log(tenant_id, from_wa_id, action_status, confirmation_expires_at desc);

create index if not exists idx_whatsapp_action_actor_created
  on public.whatsapp_action_log(actor_id, created_at desc);

drop trigger if exists trg_whatsapp_action_log_updated_at on public.whatsapp_action_log;
create trigger trg_whatsapp_action_log_updated_at
  before update on public.whatsapp_action_log
  for each row execute function moddatetime(updated_at);

alter table public.whatsapp_action_log enable row level security;

drop policy if exists whatsapp_action_log_tenant_select on public.whatsapp_action_log;
create policy whatsapp_action_log_tenant_select
  on public.whatsapp_action_log
  for select
  using (tenant_id = public.current_tenant_id());
