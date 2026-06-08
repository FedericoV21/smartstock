-- Orden de visualización / de envío en PUT para tramos de ganancia (mismo producto).
ALTER TABLE public.producto_ganancia_tramo
ADD COLUMN IF NOT EXISTS orden integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.producto_ganancia_tramo.orden IS
  '0-based: posición en el array al guardar; GET devuelve ordenado por esta columna.';

WITH ranked AS (
  SELECT
    id,
    (row_number() OVER (
      PARTITION BY tenant_id, producto_id
      ORDER BY cantidad_desde
    ) - 1)::integer AS rn
  FROM public.producto_ganancia_tramo
)
UPDATE public.producto_ganancia_tramo p
SET orden = ranked.rn
FROM ranked
WHERE p.id = ranked.id;

CREATE INDEX IF NOT EXISTS idx_producto_ganancia_tramo_tenant_producto_orden
  ON public.producto_ganancia_tramo (tenant_id, producto_id, orden);

NOTIFY pgrst, 'reload schema';
