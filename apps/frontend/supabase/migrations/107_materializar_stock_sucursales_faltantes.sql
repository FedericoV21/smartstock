-- Crea filas `stock_sucursal` en 0 para cada par (producto activo × sucursal activa del mismo tenant)
-- donde aún no exista registro. No modifica `producto` ni fusiona catálogo.
-- Seguridad: si el JWT trae `tenant_id`, debe coincidir con `p_tenant_id` (evita cross-tenant desde cliente).

CREATE OR REPLACE FUNCTION public.materializar_stock_sucursales_faltantes(p_tenant_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim uuid;
  n bigint;
BEGIN
  v_claim := public.current_tenant_id();
  IF v_claim IS NOT NULL AND v_claim IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
  SELECT p.tenant_id, p.id, s.id, 0::numeric(12, 3), 0::numeric(12, 3), NULL::text
  FROM public.producto p
  INNER JOIN public.sucursal s
    ON s.tenant_id = p.tenant_id
    AND s.activa = true
  WHERE p.tenant_id = p_tenant_id
    AND p.activo = true
    AND p.sucursal_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.stock_sucursal ss
      WHERE ss.tenant_id = p.tenant_id
        AND ss.producto_id = p.id
        AND ss.sucursal_id = s.id
    )
  ON CONFLICT (producto_id, sucursal_id) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.materializar_stock_sucursales_faltantes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materializar_stock_sucursales_faltantes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.materializar_stock_sucursales_faltantes(uuid) TO service_role;

COMMENT ON FUNCTION public.materializar_stock_sucursales_faltantes(uuid) IS
  'Inserta filas faltantes en stock_sucursal (stock 0) para cada producto activo y sucursal activa del tenant.';

NOTIFY pgrst, 'reload schema';
