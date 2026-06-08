-- Configuración Mercado Pago por sucursal (independiente).
-- Alineado al enfoque de 095_arca_config_por_sucursal.sql:
-- - mp_point_config y mp_qr_config pasan de 1 fila por tenant a 1 fila por sucursal
-- - se backfillea copiando la config existente a todas las sucursales activas del tenant

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- MP POINT
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.mp_point_config
  ADD COLUMN IF NOT EXISTS sucursal_id uuid;

ALTER TABLE public.mp_point_config
  DROP CONSTRAINT IF EXISTS mp_point_config_sucursal_id_fkey;
ALTER TABLE public.mp_point_config
  ADD CONSTRAINT mp_point_config_sucursal_id_fkey
  FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE CASCADE;

-- dejar de ser 1:1 por tenant; pasa a ser por tenant+sucursal
ALTER TABLE public.mp_point_config
  DROP CONSTRAINT IF EXISTS mp_point_config_tenant_id_key;
ALTER TABLE public.mp_point_config
  DROP CONSTRAINT IF EXISTS mp_point_config_tenant_id_unique;

DROP INDEX IF EXISTS public.idx_mp_point_config_tenant;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_point_config_tenant_sucursal
  ON public.mp_point_config(tenant_id, sucursal_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_point_config_sucursal_id
  ON public.mp_point_config(sucursal_id);

-- backfill: asignar sucursal_id a la fila existente (principal o primera activa)
WITH principal AS (
  SELECT DISTINCT ON (tenant_id)
    tenant_id,
    id AS sucursal_id
  FROM public.sucursal
  WHERE activa = true
  ORDER BY tenant_id, es_principal DESC, created_at ASC
)
UPDATE public.mp_point_config c
SET sucursal_id = p.sucursal_id
FROM principal p
WHERE c.tenant_id = p.tenant_id
  AND c.sucursal_id IS NULL;

-- copiar config a otras sucursales activas del tenant
INSERT INTO public.mp_point_config (
  tenant_id,
  sucursal_id,
  access_token,
  device_id,
  webhook_secret,
  habilitado,
  last_payment_intent_id,
  created_at,
  updated_at
)
SELECT
  c.tenant_id,
  s.id AS sucursal_id,
  c.access_token,
  c.device_id,
  c.webhook_secret,
  c.habilitado,
  c.last_payment_intent_id,
  c.created_at,
  c.updated_at
FROM public.mp_point_config c
JOIN public.sucursal s
  ON s.tenant_id = c.tenant_id
 AND s.activa = true
WHERE c.sucursal_id IS NOT NULL
  AND s.id <> c.sucursal_id
ON CONFLICT (tenant_id, sucursal_id) DO NOTHING;

-- limpieza: si quedó alguna fila sin sucursal (tenant sin sucursales activas), eliminarla
DELETE FROM public.mp_point_config WHERE sucursal_id IS NULL;

ALTER TABLE public.mp_point_config
  ALTER COLUMN sucursal_id SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- MP QR
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.mp_qr_config
  ADD COLUMN IF NOT EXISTS sucursal_id uuid;

ALTER TABLE public.mp_qr_config
  DROP CONSTRAINT IF EXISTS mp_qr_config_sucursal_id_fkey;
ALTER TABLE public.mp_qr_config
  ADD CONSTRAINT mp_qr_config_sucursal_id_fkey
  FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE CASCADE;

ALTER TABLE public.mp_qr_config
  DROP CONSTRAINT IF EXISTS mp_qr_config_tenant_id_key;
ALTER TABLE public.mp_qr_config
  DROP CONSTRAINT IF EXISTS mp_qr_config_tenant_id_unique;

DROP INDEX IF EXISTS public.idx_mp_qr_config_tenant;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_qr_config_tenant_sucursal
  ON public.mp_qr_config(tenant_id, sucursal_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_qr_config_sucursal_id
  ON public.mp_qr_config(sucursal_id);

WITH principal AS (
  SELECT DISTINCT ON (tenant_id)
    tenant_id,
    id AS sucursal_id
  FROM public.sucursal
  WHERE activa = true
  ORDER BY tenant_id, es_principal DESC, created_at ASC
)
UPDATE public.mp_qr_config c
SET sucursal_id = p.sucursal_id
FROM principal p
WHERE c.tenant_id = p.tenant_id
  AND c.sucursal_id IS NULL;

INSERT INTO public.mp_qr_config (
  tenant_id,
  sucursal_id,
  access_token,
  user_id,
  external_pos_id,
  webhook_secret,
  habilitado,
  created_at,
  updated_at
)
SELECT
  c.tenant_id,
  s.id AS sucursal_id,
  c.access_token,
  c.user_id,
  c.external_pos_id,
  c.webhook_secret,
  c.habilitado,
  c.created_at,
  c.updated_at
FROM public.mp_qr_config c
JOIN public.sucursal s
  ON s.tenant_id = c.tenant_id
 AND s.activa = true
WHERE c.sucursal_id IS NOT NULL
  AND s.id <> c.sucursal_id
ON CONFLICT (tenant_id, sucursal_id) DO NOTHING;

DELETE FROM public.mp_qr_config WHERE sucursal_id IS NULL;

ALTER TABLE public.mp_qr_config
  ALTER COLUMN sucursal_id SET NOT NULL;

COMMIT;

