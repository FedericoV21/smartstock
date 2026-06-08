-- Numeración y unicidad de comprobantes por sucursal.
-- Fix: evitar colisiones de (tipo, numero) entre sucursales del mismo tenant.

-- 1) Unicidad: incluir sucursal_id en el índice único.
DROP INDEX IF EXISTS public.idx_comprobante_numero;
CREATE UNIQUE INDEX IF NOT EXISTS idx_comprobante_numero
  ON public.comprobante(tenant_id, sucursal_id, tipo, numero)
  WHERE numero IS NOT NULL AND numero > 0;

-- 2) RPC: siguiente número por (tenant, sucursal, tipo).
DROP FUNCTION IF EXISTS public.siguiente_numero_comprobante(uuid, public.tipo_comprobante);
CREATE OR REPLACE FUNCTION public.siguiente_numero_comprobante(
  p_tenant_id uuid,
  p_sucursal_id uuid,
  p_tipo public.tipo_comprobante
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_siguiente integer;
BEGIN
  SELECT COALESCE(MAX(c.numero), 0) + 1
  INTO v_siguiente
  FROM public.comprobante c
  WHERE c.tenant_id = p_tenant_id
    AND c.sucursal_id = p_sucursal_id
    AND c.tipo = p_tipo
    AND c.numero IS NOT NULL
    AND c.numero > 0;

  RETURN v_siguiente;
END;
$$;

REVOKE ALL ON FUNCTION public.siguiente_numero_comprobante(uuid, uuid, public.tipo_comprobante) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.siguiente_numero_comprobante(uuid, uuid, public.tipo_comprobante) TO authenticated, service_role;

COMMENT ON FUNCTION public.siguiente_numero_comprobante(uuid, uuid, public.tipo_comprobante)
  IS 'Devuelve el siguiente número de comprobante por tenant+sucursal+tipo (excluye NULL y números archivados negativos).';

