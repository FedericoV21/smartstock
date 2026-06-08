-- Plantillas de despiece sin producto padre (costo referencia solo manual / ingresos).

ALTER TABLE public.despiece_plantilla
  ALTER COLUMN producto_padre_id DROP NOT NULL;

DROP INDEX IF EXISTS public.idx_despiece_plantilla_padre;

-- Un mismo tenant no repite nombre con el mismo padre (cuando hay padre).
CREATE UNIQUE INDEX IF NOT EXISTS idx_despiece_plantilla_tenant_padre_nombre
  ON public.despiece_plantilla(tenant_id, producto_padre_id, nombre)
  WHERE producto_padre_id IS NOT NULL;

-- Sin padre: nombre único por tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_despiece_plantilla_tenant_nombre_sin_padre
  ON public.despiece_plantilla(tenant_id, nombre)
  WHERE producto_padre_id IS NULL;

NOTIFY pgrst, 'reload schema';
