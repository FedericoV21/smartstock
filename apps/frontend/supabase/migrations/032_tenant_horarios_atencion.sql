-- Horarios de atención para mostrar en tickets, comprobantes o futuras vistas públicas.
ALTER TABLE public.tenant
ADD COLUMN IF NOT EXISTS horarios_atencion TEXT;

COMMENT ON COLUMN public.tenant.horarios_atencion IS 'Texto libre, ej. Lun–Vie 9–18 hs';
