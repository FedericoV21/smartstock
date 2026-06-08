-- V80-CAJA-004: cierre diario por ciclo apertura → cierre (varios por día).
-- Reemplaza el índice único por fecha/caja (059) por uno por apertura vinculada.

ALTER TABLE public.cierre_z
  ADD COLUMN IF NOT EXISTS caja_apertura_id UUID REFERENCES public.caja_apertura (id) ON DELETE SET NULL;

DROP INDEX IF EXISTS public.uq_cierre_z_diario;

-- Un solo cierre diario por apertura cuando el cierre referencia esa fila.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cierre_z_diario_por_apertura
  ON public.cierre_z (caja_apertura_id)
  WHERE tipo_cierre = 'diario' AND caja_apertura_id IS NOT NULL;

COMMENT ON COLUMN public.cierre_z.caja_apertura_id IS
  'Sesión de caja: cierre diario vinculado a la apertura; permite múltiples cierres el mismo día operativo.';

-- Backfill desde payload v4 (si ya estaba guardado solo en JSON).
UPDATE public.cierre_z c
SET caja_apertura_id = (c.payload_resumen->>'caja_apertura_id')::uuid
WHERE c.tipo_cierre = 'diario'
  AND c.caja_apertura_id IS NULL
  AND NULLIF(trim(c.payload_resumen->>'caja_apertura_id'), '') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.caja_apertura a
    WHERE a.id = (c.payload_resumen->>'caja_apertura_id')::uuid
      AND a.tenant_id = c.tenant_id
  );
