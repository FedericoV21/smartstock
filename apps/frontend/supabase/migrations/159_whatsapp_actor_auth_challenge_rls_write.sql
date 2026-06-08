-- v14.0 / Hotfix
-- Habilita escritura por tenant en whatsapp_actor y whatsapp_auth_challenge
-- para que la vinculación OTP sea operable desde la UI autenticada.

alter table public.whatsapp_actor enable row level security;
alter table public.whatsapp_auth_challenge enable row level security;

drop policy if exists whatsapp_actor_tenant_insert on public.whatsapp_actor;
create policy whatsapp_actor_tenant_insert
  on public.whatsapp_actor
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_actor_tenant_update on public.whatsapp_actor;
create policy whatsapp_actor_tenant_update
  on public.whatsapp_actor
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_auth_challenge_tenant_insert on public.whatsapp_auth_challenge;
create policy whatsapp_auth_challenge_tenant_insert
  on public.whatsapp_auth_challenge
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_auth_challenge_tenant_update on public.whatsapp_auth_challenge;
create policy whatsapp_auth_challenge_tenant_update
  on public.whatsapp_auth_challenge
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
