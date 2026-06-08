-- Local / sucursal del tenant. proveedor.sucursal_id NOT NULL con valor por defecto vía trigger.
-- Idempotente: si la columna ya existe en un remoto, completa filas, políticas y trigger.

-- ─── Tabla sucursal ───
CREATE TABLE IF NOT EXISTS public.sucursal (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  codigo      TEXT NOT NULL DEFAULT '1',
  nombre      TEXT NOT NULL DEFAULT 'Principal',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_sucursal_tenant_codigo
    UNIQUE (tenant_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_sucursal_tenant
  ON public.sucursal (tenant_id);

DROP TRIGGER IF EXISTS set_sucursal_updated_at ON public.sucursal;
CREATE TRIGGER set_sucursal_updated_at
  BEFORE UPDATE ON public.sucursal
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- Al menos una sucursal por tenant (para rellenar proveedor y futuros usos)
INSERT INTO public.sucursal (tenant_id, nombre, codigo)
SELECT t.id, 'Principal', '1'
FROM public.tenant t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.sucursal s
  WHERE s.tenant_id = t.id
);

-- ─── proveedor.sucursal_id ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proveedor'
      AND column_name = 'sucursal_id'
  ) THEN
    ALTER TABLE public.proveedor
      ADD COLUMN sucursal_id UUID REFERENCES public.sucursal (id) ON DELETE RESTRICT;
  END IF;
END $$;

UPDATE public.proveedor p
SET sucursal_id = s.id
FROM (
  SELECT DISTINCT ON (tenant_id) id, tenant_id
  FROM public.sucursal
  ORDER BY tenant_id, id
) s
WHERE p.tenant_id = s.tenant_id
  AND p.sucursal_id IS NULL;

ALTER TABLE public.proveedor
  ALTER COLUMN sucursal_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proveedor_sucursal
  ON public.proveedor (sucursal_id);

COMMENT ON TABLE public.sucursal IS
  'Punto de operación del tenant; proveedores se asocian a una sucursal (por ahora "Principal" por defecto).';
COMMENT ON COLUMN public.proveedor.sucursal_id IS
  'Sucursal a la que aplica el proveedor; rellenado automáticamente si no se envía.';

-- RLS
ALTER TABLE public.sucursal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_sucursal ON public.sucursal;
CREATE POLICY tenant_select_sucursal
  ON public.sucursal FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_sucursal ON public.sucursal;
CREATE POLICY tenant_insert_sucursal
  ON public.sucursal FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_update_sucursal ON public.sucursal;
CREATE POLICY tenant_update_sucursal
  ON public.sucursal FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_sucursal ON public.sucursal;
CREATE POLICY tenant_delete_sucursal
  ON public.sucursal FOR DELETE
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- Valor por defecto si el cliente (API) no envía sucursal_id
CREATE OR REPLACE FUNCTION public.proveedor_set_sucursal_por_defecto ()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $f$
DECLARE
  v_sucursal uuid;
BEGIN
  IF NEW.sucursal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.id INTO v_sucursal
  FROM public.sucursal s
  WHERE s.tenant_id = NEW.tenant_id
  ORDER BY s.id
  LIMIT 1;
  IF v_sucursal IS NULL THEN
    RAISE EXCEPTION 'sucursal: no hay fila para tenant_id=%, imposible asignar proveedor.sucursal_id', NEW.tenant_id
      USING ERRCODE = '23514';
  END IF;
  NEW.sucursal_id := v_sucursal;
  RETURN NEW;
END;
$f$;

REVOKE ALL ON FUNCTION public.proveedor_set_sucursal_por_defecto () FROM PUBLIC;

DROP TRIGGER IF EXISTS proveedor_set_sucursal_por_defecto ON public.proveedor;
CREATE TRIGGER proveedor_set_sucursal_por_defecto
  BEFORE INSERT OR UPDATE OF tenant_id
  ON public.proveedor
  FOR EACH ROW
  EXECUTE FUNCTION public.proveedor_set_sucursal_por_defecto ();

COMMENT ON FUNCTION public.proveedor_set_sucursal_por_defecto () IS
  'Si proveedor.sucursal_id es NULL, asigna la primera sucursal del tenant.';

-- Cada tenant nuevo recibe automáticamente la sucursal "Principal" (p. ej. seed o alta de comercio)
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

REVOKE ALL ON FUNCTION public.tenant_crea_sucursal_por_defecto () FROM PUBLIC;

DROP TRIGGER IF EXISTS tenant_crea_sucursal_por_defecto ON public.tenant;
CREATE TRIGGER tenant_crea_sucursal_por_defecto
  AFTER INSERT ON public.tenant
  FOR EACH ROW
  EXECUTE FUNCTION public.tenant_crea_sucursal_por_defecto ();

COMMENT ON FUNCTION public.tenant_crea_sucursal_por_defecto () IS
  'Crea public.sucursal "Principal" al insertar un tenant.';
