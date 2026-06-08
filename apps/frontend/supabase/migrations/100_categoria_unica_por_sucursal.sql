-- Reemplaza un posible unique (tenant, lower(nombre)) heredado: en un tenant con varias
-- sucursales, el mismo nombre de categoría debe poder existir por sucursal. Mantiene
-- a la vez a lo sumo una fila activa por (tenant, sucursal, lower(nombre)).
DROP INDEX IF EXISTS public.idx_categoria_nombre_tenant;

CREATE UNIQUE INDEX IF NOT EXISTS idx_categoria_nombre_tenant_sucursal
  ON public.categoria (tenant_id, sucursal_id, (lower(trim(nombre))))
  WHERE activa = true;

NOTIFY pgrst, 'reload schema';
