-- v14.4 / V144-WA-002
-- Permite gestionar reglas de sucursal WhatsApp desde UI autenticada.

drop policy if exists whatsapp_branch_rule_tenant_insert on public.whatsapp_branch_rule;
create policy whatsapp_branch_rule_tenant_insert
  on public.whatsapp_branch_rule
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_branch_rule_tenant_update on public.whatsapp_branch_rule;
create policy whatsapp_branch_rule_tenant_update
  on public.whatsapp_branch_rule
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists whatsapp_branch_rule_tenant_delete on public.whatsapp_branch_rule;
create policy whatsapp_branch_rule_tenant_delete
  on public.whatsapp_branch_rule
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());
