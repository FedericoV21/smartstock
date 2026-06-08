-- URL pública del logo (bucket tenant-logos). Referenciada por GET /api/configuracion/tenant y logo API.
ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN public.tenant.logo_url IS 'URL pública del logo del negocio (Storage u otro origen)';
