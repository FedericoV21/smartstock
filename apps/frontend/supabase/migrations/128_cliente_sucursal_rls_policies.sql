-- cliente_sucursal tenía RLS activado sin políticas para el rol autenticado,
-- lo que provoca al guardar: "new row violates row-level security policy for table cliente_sucursal".
-- Alineado con public.cliente (tenant_id = public.tenant_id()).

ALTER TABLE public.cliente_sucursal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_cliente_sucursal ON public.cliente_sucursal;
CREATE POLICY tenant_select_cliente_sucursal ON public.cliente_sucursal
  FOR SELECT
  USING (tenant_id = public.tenant_id());

DROP POLICY IF EXISTS tenant_insert_cliente_sucursal ON public.cliente_sucursal;
CREATE POLICY tenant_insert_cliente_sucursal ON public.cliente_sucursal
  FOR INSERT
  WITH CHECK (tenant_id = public.tenant_id());

DROP POLICY IF EXISTS tenant_update_cliente_sucursal ON public.cliente_sucursal;
CREATE POLICY tenant_update_cliente_sucursal ON public.cliente_sucursal
  FOR UPDATE
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

DROP POLICY IF EXISTS tenant_delete_cliente_sucursal ON public.cliente_sucursal;
CREATE POLICY tenant_delete_cliente_sucursal ON public.cliente_sucursal
  FOR DELETE
  USING (tenant_id = public.tenant_id());
