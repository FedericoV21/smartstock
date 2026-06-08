-- Canal WhatsApp compartido (SmartStock central) + routing por remitente

create table if not exists public.whatsapp_platform_channel (
  id uuid primary key default gen_random_uuid(),
  phone_number_id text not null,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_whatsapp_platform_channel_phone unique (phone_number_id)
);

create unique index if not exists uq_whatsapp_platform_channel_one_active
  on public.whatsapp_platform_channel ((activa))
  where activa = true;

create table if not exists public.whatsapp_platform_routing_state (
  from_wa_id text primary key,
  selected_tenant_id uuid references public.tenant(id) on delete set null,
  pending_choices jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_platform_routing_expires
  on public.whatsapp_platform_routing_state (expires_at);

drop trigger if exists trg_whatsapp_platform_channel_updated_at on public.whatsapp_platform_channel;
create trigger trg_whatsapp_platform_channel_updated_at
  before update on public.whatsapp_platform_channel
  for each row execute function moddatetime(updated_at);

drop trigger if exists trg_whatsapp_platform_routing_state_updated_at on public.whatsapp_platform_routing_state;
create trigger trg_whatsapp_platform_routing_state_updated_at
  before update on public.whatsapp_platform_routing_state
  for each row execute function moddatetime(updated_at);

alter table public.whatsapp_platform_channel enable row level security;
alter table public.whatsapp_platform_routing_state enable row level security;

drop policy if exists whatsapp_platform_channel_read on public.whatsapp_platform_channel;
create policy whatsapp_platform_channel_read
  on public.whatsapp_platform_channel
  for select
  using (true);

-- Migrar el primer canal activo existente al canal de plataforma compartido.
insert into public.whatsapp_platform_channel (phone_number_id, activa)
select wc.phone_number_id, true
from public.whatsapp_channel wc
where wc.activa = true
  and nullif(trim(wc.phone_number_id), '') is not null
order by wc.updated_at desc nulls last, wc.created_at desc
limit 1
on conflict (phone_number_id) do update
  set activa = excluded.activa,
      updated_at = now();

-- Permitir reutilizar el mismo Phone Number ID en whatsapp_channel (legacy / transición).
alter table public.whatsapp_channel
  drop constraint if exists whatsapp_channel_phone_number_id_key;
