-- Registra intentos de emision que fallan antes de crear un comprobante real.
-- No consume numeracion fiscal ni numero_orden: es una bitacora operativa del POS/facturacion.

CREATE TABLE IF NOT EXISTS public.emision_intento_error (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  usuario_id UUID NULL REFERENCES public.usuario(id) ON DELETE SET NULL,
  cliente_id UUID NULL REFERENCES public.cliente(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  origen TEXT NOT NULL DEFAULT 'facturacion_emitir',
  etapa TEXT NOT NULL DEFAULT 'emision',
  tipo TEXT NULL,
  caja_id TEXT NULL,
  metodo_pago TEXT NULL,
  metodo_pago_detalle JSONB NULL,
  total_estimado NUMERIC(12, 2) NULL,
  items_count INTEGER NOT NULL DEFAULT 0,
  items_resumen JSONB NOT NULL DEFAULT '[]'::jsonb,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_status INTEGER NULL,
  error_mensaje TEXT NOT NULL,
  resuelto_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_emision_intento_error_tenant_sucursal_created
  ON public.emision_intento_error (tenant_id, sucursal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_emision_intento_error_tenant_etapa
  ON public.emision_intento_error (tenant_id, etapa);

ALTER TABLE public.emision_intento_error ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_emision_intento_error ON public.emision_intento_error;
CREATE POLICY tenant_select_emision_intento_error ON public.emision_intento_error
  FOR SELECT
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_emision_intento_error ON public.emision_intento_error;
CREATE POLICY tenant_insert_emision_intento_error ON public.emision_intento_error
  FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_update_emision_intento_error ON public.emision_intento_error;
CREATE POLICY tenant_update_emision_intento_error ON public.emision_intento_error
  FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_emision_intento_error ON public.emision_intento_error;
CREATE POLICY tenant_delete_emision_intento_error ON public.emision_intento_error
  FOR DELETE
  USING (tenant_id = public.current_tenant_id());
