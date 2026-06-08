-- Compatibilidad: muchas BDs tienen public.sucursal.codigo NOT NULL (código de sucursal).
-- 071 pudo insertar solo (tenant_id, nombre); este archivo alinea default + trigger.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sucursal'
      AND column_name = 'codigo'
  ) THEN
    ALTER TABLE public.sucursal
      ADD COLUMN codigo text NOT NULL DEFAULT '1';
  END IF;
END $$;

UPDATE public.sucursal
SET codigo = '1'
WHERE codigo IS NULL;

ALTER TABLE public.sucursal
  ALTER COLUMN codigo SET DEFAULT '1';

ALTER TABLE public.sucursal
  ALTER COLUMN codigo SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'sucursal'
      AND c.conname = 'uq_sucursal_tenant_codigo'
  ) THEN
    ALTER TABLE public.sucursal
      ADD CONSTRAINT uq_sucursal_tenant_codigo
      UNIQUE (tenant_id, codigo);
  END IF;
EXCEPTION
  WHEN unique_violation
    OR duplicate_object
    THEN NULL;
END $$;

-- Reemplaza trigger de 071: insert incluye codigo
CREATE OR REPLACE FUNCTION public.tenant_crea_sucursal_por_defecto ()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sucursal s WHERE s.tenant_id = NEW.id) THEN
    INSERT INTO public.sucursal (tenant_id, nombre, codigo)
    VALUES (NEW.id, 'Principal', '1');
  END IF;
  RETURN NEW;
END;
$f$;

COMMENT ON FUNCTION public.tenant_crea_sucursal_por_defecto () IS
  'Crea public.sucursal "Principal" (codigo 1) al insertar un tenant.';
