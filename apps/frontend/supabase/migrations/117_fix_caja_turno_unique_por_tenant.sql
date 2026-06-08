-- Fix: los índices únicos de turno abierto deben ser por tenant.
-- Motivación: un mismo usuario puede existir/operar en múltiples tenants; la unicidad global por usuario
-- bloquea aperturas válidas en tenants distintos.

DO $$
BEGIN
  -- Usuario: permitir 1 turno abierto POR tenant (no global).
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uk_caja_turno_usuario_abierto'
  ) THEN
    EXECUTE 'DROP INDEX public.uk_caja_turno_usuario_abierto';
  END IF;

  EXECUTE $i$
    CREATE UNIQUE INDEX IF NOT EXISTS uk_caja_turno_usuario_abierto
      ON public.caja_turno (tenant_id, usuario_id)
      WHERE estado = 'abierto'
  $i$;

  -- Caja: por consistencia, scope por tenant también (aunque caja_id sea UUID global).
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uk_caja_turno_caja_abierto'
  ) THEN
    EXECUTE 'DROP INDEX public.uk_caja_turno_caja_abierto';
  END IF;

  EXECUTE $i$
    CREATE UNIQUE INDEX IF NOT EXISTS uk_caja_turno_caja_abierto
      ON public.caja_turno (tenant_id, caja_id)
      WHERE estado = 'abierto'
  $i$;
END $$;

