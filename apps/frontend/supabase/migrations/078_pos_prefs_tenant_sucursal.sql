-- Preferencias POS por negocio (defaults) y por sucursal (snapshot opcional).
-- sucursal.pos_prefs NULL = heredar solo del tenant.

ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS pos_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.sucursal
  ADD COLUMN IF NOT EXISTS pos_prefs jsonb NULL;

COMMENT ON COLUMN public.tenant.pos_prefs IS 'Preferencias POS por defecto del negocio (JSON parcial o completo; normaliza la app).';
COMMENT ON COLUMN public.sucursal.pos_prefs IS 'Preferencias POS de la sucursal; NULL = usar solo tenant.pos_prefs.';
