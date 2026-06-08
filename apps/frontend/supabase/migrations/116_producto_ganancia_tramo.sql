-- V??-STOCK-PRICING-001: ganancia por tramos de cantidad (por producto, por tenant).
-- Permite definir % de ganancia distinto según cantidad (en unidad base = producto.unidad).
-- Regla de resolución (en app): mayor cantidad_desde <= cantidad.

CREATE TABLE IF NOT EXISTS public.producto_ganancia_tramo (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id    UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,

  -- Cantidad mínima en unidad base (producto.unidad). Para pesables puede ser decimal.
  cantidad_desde NUMERIC(12, 3) NOT NULL,
  ganancia_pct   NUMERIC(6, 2) NOT NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_producto_ganancia_tramo_cantidad_desde_pos
    CHECK (cantidad_desde >= 1),
  CONSTRAINT chk_producto_ganancia_tramo_ganancia_pct_nonneg
    CHECK (ganancia_pct >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_producto_ganancia_tramo_unique
  ON public.producto_ganancia_tramo (tenant_id, producto_id, cantidad_desde);

CREATE INDEX IF NOT EXISTS idx_producto_ganancia_tramo_tenant_producto
  ON public.producto_ganancia_tramo (tenant_id, producto_id, cantidad_desde DESC);

DROP TRIGGER IF EXISTS set_producto_ganancia_tramo_updated_at ON public.producto_ganancia_tramo;
CREATE TRIGGER set_producto_ganancia_tramo_updated_at
  BEFORE UPDATE ON public.producto_ganancia_tramo
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.producto_ganancia_tramo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_producto_ganancia_tramo ON public.producto_ganancia_tramo;
CREATE POLICY tenant_select_producto_ganancia_tramo
  ON public.producto_ganancia_tramo FOR SELECT
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_producto_ganancia_tramo ON public.producto_ganancia_tramo;
CREATE POLICY tenant_insert_producto_ganancia_tramo
  ON public.producto_ganancia_tramo FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_update_producto_ganancia_tramo ON public.producto_ganancia_tramo;
CREATE POLICY tenant_update_producto_ganancia_tramo
  ON public.producto_ganancia_tramo FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_producto_ganancia_tramo ON public.producto_ganancia_tramo;
CREATE POLICY tenant_delete_producto_ganancia_tramo
  ON public.producto_ganancia_tramo FOR DELETE
  USING (tenant_id = public.current_tenant_id());

NOTIFY pgrst, 'reload schema';
