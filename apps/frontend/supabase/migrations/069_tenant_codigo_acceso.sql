-- V91-AUTH-LOCAL-001: código de acceso corto por tenant para login local.
-- Evita pedir UUID de tenant en pantalla de usuario+PIN.

ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS codigo_acceso TEXT;

COMMENT ON COLUMN public.tenant.codigo_acceso IS
  'Código corto único del negocio para login local (usuario + PIN).';

CREATE OR REPLACE FUNCTION public.normalize_tenant_access_code(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.ensure_tenant_access_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_base TEXT;
BEGIN
  IF NEW.codigo_acceso IS NULL OR btrim(NEW.codigo_acceso) = '' THEN
    v_base := public.normalize_tenant_access_code(NEW.nombre);
    IF v_base = '' THEN
      v_base := 'negocio';
    END IF;

    NEW.codigo_acceso := left(v_base, 10) || substring(replace(NEW.id::text, '-', ''), 1, 6);
  ELSE
    NEW.codigo_acceso := public.normalize_tenant_access_code(NEW.codigo_acceso);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenant_codigo_acceso_before_ins_upd ON public.tenant;
CREATE TRIGGER tenant_codigo_acceso_before_ins_upd
  BEFORE INSERT OR UPDATE OF codigo_acceso, nombre ON public.tenant
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_tenant_access_code();

-- Backfill para tenants existentes.
UPDATE public.tenant
SET codigo_acceso = NULL
WHERE codigo_acceso IS NULL OR btrim(codigo_acceso) = '';

ALTER TABLE public.tenant
  ALTER COLUMN codigo_acceso SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_codigo_acceso_unique
  ON public.tenant (codigo_acceso);

