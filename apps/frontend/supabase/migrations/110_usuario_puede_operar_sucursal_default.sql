-- Operadores con sucursal por defecto en perfil pero sin fila en usuario_sucursal
-- deben poder validar alcance (POS, caja, etc.) igual que con membresía explícita.

CREATE OR REPLACE FUNCTION public.usuario_puede_operar_sucursal(p_sucursal_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_allowed BOOLEAN := false;
BEGIN
  IF v_uid IS NULL OR p_sucursal_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.usuario u
    JOIN public.sucursal s ON s.id = p_sucursal_id
    WHERE u.id = v_uid
      AND u.es_super_admin = true
      AND s.tenant_id = public.current_tenant_id()
  ) THEN
    RETURN true;
  END IF;

  IF public.has_permiso('sucursales.ver_todas') THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.sucursal s
      WHERE s.id = p_sucursal_id
        AND s.tenant_id = public.current_tenant_id()
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.usuario_sucursal us
    JOIN public.sucursal s ON s.id = us.sucursal_id
    WHERE us.usuario_id = v_uid
      AND us.sucursal_id = p_sucursal_id
      AND s.tenant_id = public.current_tenant_id()
  )
  INTO v_allowed;

  IF COALESCE(v_allowed, false) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.usuario u
    INNER JOIN public.sucursal s ON s.id = u.sucursal_default_id
    WHERE u.id = v_uid
      AND u.sucursal_default_id = p_sucursal_id
      AND s.tenant_id = public.current_tenant_id()
      AND s.activa = true
  );
END;
$$;
