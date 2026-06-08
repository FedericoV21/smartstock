-- Datos que aparecen en el ticket térmico del POS: por defecto heredan del tenant.

ALTER TABLE public.sucursal
  ADD COLUMN IF NOT EXISTS hereda_datos_ticket boolean NOT NULL DEFAULT true;

ALTER TABLE public.sucursal
  ADD COLUMN IF NOT EXISTS razon_social text NULL;

ALTER TABLE public.sucursal
  ADD COLUMN IF NOT EXISTS cuit text NULL;

ALTER TABLE public.sucursal
  ADD COLUMN IF NOT EXISTS telefono text NULL;

ALTER TABLE public.sucursal
  ADD COLUMN IF NOT EXISTS horarios_atencion text NULL;

ALTER TABLE public.sucursal
  ADD COLUMN IF NOT EXISTS email text NULL;

COMMENT ON COLUMN public.sucursal.hereda_datos_ticket IS 'Si true, el ticket usa razón social, CUIT y domicilio del tenant; si false, usa datos de la sucursal con fallback al tenant.';
COMMENT ON COLUMN public.sucursal.razon_social IS 'Razón social en ticket cuando hereda_datos_ticket es false; null = usar tenant.';
COMMENT ON COLUMN public.sucursal.cuit IS 'CUIT en ticket cuando hereda_datos_ticket es false; null = usar tenant.';
