-- Configuración ARCA por sucursal (independiente).
-- Compat: migra el modelo previo (1 fila por tenant) copiándolo a todas las sucursales activas.

BEGIN;

-- 1) Nuevo scope: sucursal.
ALTER TABLE public.arca_config
  ADD COLUMN IF NOT EXISTS sucursal_id uuid;

-- FK (se crea antes del backfill; admite NULL temporalmente).
ALTER TABLE public.arca_config
  DROP CONSTRAINT IF EXISTS arca_config_sucursal_id_fkey;
ALTER TABLE public.arca_config
  ADD CONSTRAINT arca_config_sucursal_id_fkey
  FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE CASCADE;

-- 2) Unicidad: dejar de ser 1:1 por tenant; pasa a ser por tenant+sucursal.
-- (Nombres de constraint pueden variar según cómo se creó la tabla originalmente.)
ALTER TABLE public.arca_config
  DROP CONSTRAINT IF EXISTS arca_config_tenant_id_key;
ALTER TABLE public.arca_config
  DROP CONSTRAINT IF EXISTS arca_config_tenant_id_unique;

DROP INDEX IF EXISTS public.idx_arca_config_tenant_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_config_tenant_sucursal
  ON public.arca_config(tenant_id, sucursal_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_config_sucursal_id
  ON public.arca_config(sucursal_id);

-- 3) Backfill:
-- 3.a) Asignar sucursal_id a la fila existente (principal o primera activa).
WITH principal AS (
  SELECT DISTINCT ON (tenant_id)
    tenant_id,
    id AS sucursal_id
  FROM public.sucursal
  WHERE activa = true
  ORDER BY tenant_id, es_principal DESC, created_at ASC
)
UPDATE public.arca_config ac
SET sucursal_id = p.sucursal_id
FROM principal p
WHERE ac.tenant_id = p.tenant_id
  AND ac.sucursal_id IS NULL;

-- 3.b) Copiar esa configuración a todas las otras sucursales activas del tenant.
INSERT INTO public.arca_config (
  tenant_id,
  sucursal_id,
  ambiente,
  certificado_pem,
  clave_privada_pem,
  cuit_emisor,
  punto_de_venta,
  ticket_acceso,
  ticket_sign,
  ticket_expiracion,
  ultimo_comprobante,
  created_at,
  updated_at
)
SELECT
  ac.tenant_id,
  s.id AS sucursal_id,
  ac.ambiente,
  ac.certificado_pem,
  ac.clave_privada_pem,
  ac.cuit_emisor,
  ac.punto_de_venta,
  ac.ticket_acceso,
  ac.ticket_sign,
  ac.ticket_expiracion,
  ac.ultimo_comprobante,
  ac.created_at,
  ac.updated_at
FROM public.arca_config ac
JOIN public.sucursal s
  ON s.tenant_id = ac.tenant_id
 AND s.activa = true
WHERE ac.sucursal_id IS NOT NULL
  AND s.id <> ac.sucursal_id
ON CONFLICT (tenant_id, sucursal_id) DO NOTHING;

-- 3.c) Limpieza: si quedó alguna fila sin sucursal (tenant sin sucursales activas), eliminarla.
DELETE FROM public.arca_config WHERE sucursal_id IS NULL;

-- 4) Enforce: ya no debe haber config sin sucursal.
ALTER TABLE public.arca_config
  ALTER COLUMN sucursal_id SET NOT NULL;

COMMIT;

