-- Bandeja de pedidos por estado de workflow: operadores/visores con ≥1 fila solo ven pedidos en esos estados.

CREATE TABLE IF NOT EXISTS public.usuario_pedido_workflow_estado (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  workflow_estado_id UUID NOT NULL REFERENCES public.pedido_estado_workflow (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uk_usuario_pedido_wf_estado UNIQUE (tenant_id, usuario_id, workflow_estado_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_pedido_wf_estado_lookup
  ON public.usuario_pedido_workflow_estado (tenant_id, usuario_id);

COMMENT ON TABLE public.usuario_pedido_workflow_estado IS
  'Estados de workflow de pedidos asignados a un usuario operador o visor. Si no hay filas, el usuario sigue viendo todos los pedidos como antes (excepto admins que siempre ven todo sin filtrar desde esta tabla).';

ALTER TABLE public.usuario_pedido_workflow_estado ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_usuario_pedido_workflow_estado ON public.usuario_pedido_workflow_estado;
CREATE POLICY tenant_select_usuario_pedido_workflow_estado
  ON public.usuario_pedido_workflow_estado FOR SELECT
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_usuario_pedido_workflow_estado ON public.usuario_pedido_workflow_estado;
CREATE POLICY tenant_insert_usuario_pedido_workflow_estado
  ON public.usuario_pedido_workflow_estado FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_update_usuario_pedido_workflow_estado ON public.usuario_pedido_workflow_estado;
CREATE POLICY tenant_update_usuario_pedido_workflow_estado
  ON public.usuario_pedido_workflow_estado FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_usuario_pedido_workflow_estado ON public.usuario_pedido_workflow_estado;
CREATE POLICY tenant_delete_usuario_pedido_workflow_estado
  ON public.usuario_pedido_workflow_estado FOR DELETE
  USING (tenant_id = public.current_tenant_id());
