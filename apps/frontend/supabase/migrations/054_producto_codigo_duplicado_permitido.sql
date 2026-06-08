-- Varios productos activos del mismo tenant pueden compartir el mismo código interno (SKU).
-- Se elimina el índice único parcial histórico y se reemplaza por uno no único para listados/import.

DROP INDEX IF EXISTS public.idx_producto_codigo_tenant;

CREATE INDEX IF NOT EXISTS idx_producto_codigo_tenant_lookup
  ON public.producto (tenant_id, lower(codigo))
  WHERE activo = true;
