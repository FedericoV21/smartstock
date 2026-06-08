-- v14.0 / Hotfix
-- Permite gestionar el feature flag WhatsApp por tenant desde UI autenticada.

alter table public.whatsapp_agent_feature_flag enable row level security;

drop policy if exists whatsapp_agent_feature_flag_tenant_insert on public.whatsapp_agent_feature_flag;
create policy whatsapp_agent_feature_flag_tenant_insert
  on public.whatsapp_agent_feature_flag
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_agent_feature_flag_tenant_update on public.whatsapp_agent_feature_flag;
create policy whatsapp_agent_feature_flag_tenant_update
  on public.whatsapp_agent_feature_flag
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
