-- V80-CAJA-002: habilitar múltiples cierres parciales por fecha/caja y reforzar idempotencia.

ALTER TABLE public.cierre_z
  DROP CONSTRAINT IF EXISTS uq_cierre_z_diario;

-- Un solo cierre diario final por tenant/caja/fecha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cierre_z_diario
  ON public.cierre_z (tenant_id, caja_id, fecha_operativa)
  WHERE tipo_cierre = 'diario';

-- Idempotencia para parciales por rango exacto (sin impedir múltiples parciales distintos).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cierre_z_parcial_rango
  ON public.cierre_z (tenant_id, caja_id, tipo_cierre, rango_desde, rango_hasta)
  WHERE tipo_cierre = 'parcial';
