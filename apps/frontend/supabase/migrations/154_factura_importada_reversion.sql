-- Trazabilidad para revertir facturas/remitos importados de compra (manual o lector IA).
-- Guarda una aplicación por comprobante y snapshots de catálogo por producto afectado.

ALTER TABLE public.lector_factura_log
  DROP CONSTRAINT IF EXISTS chk_lector_factura_log_estado;

ALTER TABLE public.lector_factura_log
  ADD CONSTRAINT chk_lector_factura_log_estado CHECK (
    estado IN ('extraido', 'confirmado', 'descartado', 'error', 'revertido')
  );

CREATE TABLE public.factura_importada_aplicacion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  comprobante_id UUID NOT NULL REFERENCES public.comprobante (id) ON DELETE CASCADE,
  lector_factura_log_id UUID NULL REFERENCES public.lector_factura_log (id) ON DELETE SET NULL,
  origen TEXT NOT NULL CHECK (origen IN ('lector', 'manual')),
  afecta_stock BOOLEAN NOT NULL DEFAULT true,
  afecta_cuenta_corriente BOOLEAN NOT NULL DEFAULT true,
  actualizar_costos BOOLEAN NOT NULL DEFAULT false,
  precios_items_con_iva_incluido BOOLEAN NOT NULL DEFAULT false,
  subtotal NUMERIC(18, 6) NOT NULL DEFAULT 0,
  iva_monto NUMERIC(18, 6) NOT NULL DEFAULT 0,
  percepcion_iibb_monto NUMERIC(18, 6) NOT NULL DEFAULT 0,
  percepcion_iva_monto NUMERIC(18, 6) NOT NULL DEFAULT 0,
  total NUMERIC(18, 6) NOT NULL DEFAULT 0,
  cuenta_corriente_delta NUMERIC(18, 6) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'aplicada' CHECK (estado IN ('aplicada', 'revertida')),
  revertida_at TIMESTAMPTZ NULL,
  revertida_por UUID NULL REFERENCES public.usuario (id) ON DELETE SET NULL,
  motivo_reversion TEXT NULL,
  resumen_reversion JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_factura_importada_aplicacion_comprobante UNIQUE (tenant_id, comprobante_id),
  CONSTRAINT chk_factura_importada_aplicacion_montos CHECK (
    subtotal >= 0
    AND iva_monto >= 0
    AND percepcion_iibb_monto >= 0
    AND percepcion_iva_monto >= 0
    AND total >= 0
  )
);

CREATE INDEX idx_factura_importada_aplicacion_tenant_estado
  ON public.factura_importada_aplicacion (tenant_id, estado);

CREATE INDEX idx_factura_importada_aplicacion_log
  ON public.factura_importada_aplicacion (lector_factura_log_id)
  WHERE lector_factura_log_id IS NOT NULL;

COMMENT ON TABLE public.factura_importada_aplicacion IS
  'Efectos aplicados al confirmar una factura/remito importado de compra. Permite una reversión auditada.';

COMMENT ON COLUMN public.factura_importada_aplicacion.cuenta_corriente_delta IS
  'Monto que se sumó a la cuenta corriente del proveedor al confirmar. Incluye IVA y percepciones.';

CREATE TRIGGER set_factura_importada_aplicacion_updated_at
  BEFORE UPDATE ON public.factura_importada_aplicacion
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.factura_importada_aplicacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_factura_importada_aplicacion
  ON public.factura_importada_aplicacion FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_factura_importada_aplicacion
  ON public.factura_importada_aplicacion FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_factura_importada_aplicacion
  ON public.factura_importada_aplicacion FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TABLE public.factura_importada_producto_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  aplicacion_id UUID NOT NULL REFERENCES public.factura_importada_aplicacion (id) ON DELETE CASCADE,
  comprobante_id UUID NOT NULL REFERENCES public.comprobante (id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  creado_en_confirmacion BOOLEAN NOT NULL DEFAULT false,
  producto_before JSONB NULL,
  producto_after JSONB NOT NULL,
  producto_after_hash TEXT NOT NULL,
  precio_sucursal_before JSONB NOT NULL DEFAULT '[]'::jsonb,
  precio_sucursal_after JSONB NOT NULL DEFAULT '[]'::jsonb,
  precio_sucursal_after_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_factura_importada_producto_snapshot UNIQUE (aplicacion_id, producto_id)
);

CREATE INDEX idx_factura_importada_producto_snapshot_producto
  ON public.factura_importada_producto_snapshot (tenant_id, producto_id);

COMMENT ON TABLE public.factura_importada_producto_snapshot IS
  'Snapshot de catálogo antes/después de confirmar una factura importada. La reversión solo restaura si el after_hash sigue vigente.';

ALTER TABLE public.factura_importada_producto_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_factura_importada_producto_snapshot
  ON public.factura_importada_producto_snapshot FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_factura_importada_producto_snapshot
  ON public.factura_importada_producto_snapshot FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_factura_importada_producto_snapshot
  ON public.factura_importada_producto_snapshot FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

NOTIFY pgrst, 'reload schema';
