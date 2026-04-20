-- Acelera búsqueda POS por subcadena (ILIKE %q%) en nombre y código.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_producto_activo_nombre_trgm
  ON public.producto
  USING gin (nombre gin_trgm_ops)
  WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_producto_activo_codigo_trgm
  ON public.producto
  USING gin (codigo gin_trgm_ops)
  WHERE activo = true;
