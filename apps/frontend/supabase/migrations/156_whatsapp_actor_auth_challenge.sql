-- v14.0 / V140-WA-001
-- Identidad de actor WhatsApp + challenges OTP de vinculacion

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'whatsapp_actor_trust_level'
      and n.nspname = 'public'
  ) then
    create type public.whatsapp_actor_trust_level as enum (
      'verified',
      'unverified',
      'blocked'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'whatsapp_auth_challenge_status'
      and n.nspname = 'public'
  ) then
    create type public.whatsapp_auth_challenge_status as enum (
      'pending',
      'verified',
      'expired',
      'blocked',
      'cancelled'
    );
  end if;
end
$$;

create table if not exists public.whatsapp_actor (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  from_wa_id text not null,
  rol_whatsapp text not null default 'operador',
  trust_level public.whatsapp_actor_trust_level not null default 'unverified',
  activo boolean not null default true,
  verified_at timestamptz,
  replaced_by_actor_id uuid references public.whatsapp_actor(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_whatsapp_actor_verified_at
    check (
      (trust_level = 'verified' and verified_at is not null)
      or (trust_level <> 'verified')
    )
);

create table if not exists public.whatsapp_auth_challenge (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  actor_id uuid not null references public.whatsapp_actor(id) on delete cascade,
  channel_phone_number_id text,
  otp_hash text not null,
  otp_salt text not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  resend_count integer not null default 0,
  blocked_until timestamptz,
  status public.whatsapp_auth_challenge_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz,
  constraint chk_whatsapp_auth_challenge_attempt_count
    check (attempt_count >= 0),
  constraint chk_whatsapp_auth_challenge_max_attempts
    check (max_attempts > 0),
  constraint chk_whatsapp_auth_challenge_resend_count
    check (resend_count >= 0),
  constraint chk_whatsapp_auth_challenge_verified_at
    check (
      (status = 'verified' and verified_at is not null)
      or (status <> 'verified')
    )
);

create unique index if not exists uq_whatsapp_actor_active_from_wa
  on public.whatsapp_actor(tenant_id, from_wa_id)
  where activo = true;

create index if not exists idx_whatsapp_actor_tenant_usuario
  on public.whatsapp_actor(tenant_id, usuario_id, activo);

create index if not exists idx_whatsapp_actor_tenant_created
  on public.whatsapp_actor(tenant_id, created_at desc);

create index if not exists idx_whatsapp_auth_challenge_actor_status
  on public.whatsapp_auth_challenge(actor_id, status, created_at desc);

create index if not exists idx_whatsapp_auth_challenge_tenant_status_expires
  on public.whatsapp_auth_challenge(tenant_id, status, expires_at);

drop trigger if exists trg_whatsapp_actor_updated_at on public.whatsapp_actor;
create trigger trg_whatsapp_actor_updated_at
  before update on public.whatsapp_actor
  for each row execute function moddatetime(updated_at);

drop trigger if exists trg_whatsapp_auth_challenge_updated_at on public.whatsapp_auth_challenge;
create trigger trg_whatsapp_auth_challenge_updated_at
  before update on public.whatsapp_auth_challenge
  for each row execute function moddatetime(updated_at);

alter table public.whatsapp_actor enable row level security;
alter table public.whatsapp_auth_challenge enable row level security;

drop policy if exists whatsapp_actor_tenant_select on public.whatsapp_actor;
create policy whatsapp_actor_tenant_select
  on public.whatsapp_actor
  for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_auth_challenge_tenant_select on public.whatsapp_auth_challenge;
create policy whatsapp_auth_challenge_tenant_select
  on public.whatsapp_auth_challenge
  for select
  using (tenant_id = public.current_tenant_id());
