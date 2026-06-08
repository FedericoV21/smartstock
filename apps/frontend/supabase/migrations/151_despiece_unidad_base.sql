-- Plantillas de despiece con unidad base opcional (ej. 7 pollos = 18 kg).

ALTER TABLE public.despiece_plantilla
  ADD COLUMN IF NOT EXISTS unidad_base_tipo TEXT NOT NULL DEFAULT 'kg',
  ADD COLUMN IF NOT EXISTS unidad_base_nombre TEXT,
  ADD COLUMN IF NOT EXISTS unidad_base_cantidad NUMERIC(10,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unidad_contenedor_nombre TEXT,
  ADD COLUMN IF NOT EXISTS unidad_contenedor_cantidad NUMERIC(10,3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_despiece_plantilla_unidad_base_tipo'
      AND conrelid = 'public.despiece_plantilla'::regclass
  ) THEN
    ALTER TABLE public.despiece_plantilla
      ADD CONSTRAINT chk_despiece_plantilla_unidad_base_tipo
      CHECK (unidad_base_tipo IN ('kg', 'unidad'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_despiece_plantilla_unidad_base_cantidad'
      AND conrelid = 'public.despiece_plantilla'::regclass
  ) THEN
    ALTER TABLE public.despiece_plantilla
      ADD CONSTRAINT chk_despiece_plantilla_unidad_base_cantidad
      CHECK (unidad_base_cantidad > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_despiece_plantilla_unidad_contenedor_cantidad'
      AND conrelid = 'public.despiece_plantilla'::regclass
  ) THEN
    ALTER TABLE public.despiece_plantilla
      ADD CONSTRAINT chk_despiece_plantilla_unidad_contenedor_cantidad
      CHECK (unidad_contenedor_cantidad IS NULL OR unidad_contenedor_cantidad > 0);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
