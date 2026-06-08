-- Cierre automático de turno POS: horas máximas desde apertura del turno (cliente + validación servidor).
ALTER TABLE public.caja
ADD COLUMN IF NOT EXISTS auto_cierre_horas INTEGER NULL;

ALTER TABLE public.caja
DROP CONSTRAINT IF EXISTS chk_caja_auto_cierre_horas_rango;

ALTER TABLE public.caja
ADD CONSTRAINT chk_caja_auto_cierre_horas_rango CHECK (
  auto_cierre_horas IS NULL
  OR (
    auto_cierre_horas >= 1
    AND auto_cierre_horas <= 168
  )
);

COMMENT ON COLUMN public.caja.auto_cierre_horas IS
  'Si no es NULL, tras esta cantidad de horas desde el turno abierto el POS puede ejecutar cierre Z automático (efectivo contado = esperado sistema).';
