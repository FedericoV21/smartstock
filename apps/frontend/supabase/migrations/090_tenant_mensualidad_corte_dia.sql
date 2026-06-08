-- Día del mes en que cierra el ciclo de facturación / suscripción (evita 29-31 para no romper febrero).

ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS mensualidad_corte_dia smallint
    NULL
    CHECK (
      mensualidad_corte_dia IS NULL
      OR (mensualidad_corte_dia >= 1 AND mensualidad_corte_dia <= 28)
    );

COMMENT ON COLUMN public.tenant.mensualidad_corte_dia IS
  'Día de calendario (1-28) del corte mensual; NULL si aún no está definido.';
