-- Preferencias de negocio (catálogo / importación) por tenant con override opcional por sucursal.
-- Mismo patrón que `pos_prefs` (migración 078): la app normaliza el JSON.

ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS business_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.sucursal
  ADD COLUMN IF NOT EXISTS business_prefs jsonb NULL;

COMMENT ON COLUMN public.tenant.business_prefs IS
  'Preferencias de negocio (catálogo, importación, etc.); JSON parcial o completo. Normaliza la app.';
COMMENT ON COLUMN public.sucursal.business_prefs IS
  'Override por sucursal de business_prefs; NULL = heredar tenant.';

NOTIFY pgrst, 'reload schema';
