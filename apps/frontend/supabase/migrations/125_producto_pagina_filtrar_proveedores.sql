-- Paginación por proveedor (principal o producto_proveedor) sin armar URLs con miles de UUID.
-- Evita error 500 de PostgREST / proxy por query string demasiado largo.

CREATE OR REPLACE FUNCTION public.producto_ids_pagina_filtrar_proveedores(
  p_tenant_id uuid,
  p_activo boolean,
  p_sucursal_ids uuid[],
  p_proveedor_ids uuid[],
  p_offset integer,
  p_limit integer,
  p_orden_por_actualizado boolean,
  p_restringir_a_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (producto_id uuid, full_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH cand AS (
    SELECT DISTINCT p.id, p.nombre, p.updated_at
    FROM public.producto p
    WHERE p.tenant_id = p_tenant_id
      AND p.activo = p_activo
      AND p.sucursal_id = ANY (p_sucursal_ids)
      AND (
        p.proveedor_id = ANY (p_proveedor_ids)
        OR EXISTS (
          SELECT 1
          FROM public.producto_proveedor pp
          WHERE pp.tenant_id = p_tenant_id
            AND pp.producto_id = p.id
            AND pp.proveedor_id = ANY (p_proveedor_ids)
        )
      )
      AND (
        p_restringir_a_ids IS NULL
        OR p.id = ANY (p_restringir_a_ids)
      )
  ),
  ord AS (
    SELECT
      c.id,
      c.nombre,
      c.updated_at,
      COUNT(*) OVER ()::bigint AS full_count
    FROM cand c
  )
  SELECT o.id AS producto_id, o.full_count
  FROM ord o
  ORDER BY
    CASE WHEN p_orden_por_actualizado THEN o.updated_at END DESC NULLS LAST,
    o.nombre ASC
  OFFSET p_offset
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.producto_ids_pagina_filtrar_proveedores(
  uuid, boolean, uuid[], uuid[], integer, integer, boolean, uuid[]
) IS
  'IDs de producto paginados: proveedor principal o vínculo producto_proveedor; sin lista masiva en la URL de PostgREST.';

GRANT EXECUTE ON FUNCTION public.producto_ids_pagina_filtrar_proveedores(
  uuid, boolean, uuid[], uuid[], integer, integer, boolean, uuid[]
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.producto_ids_pagina_filtrar_proveedores(
  uuid, boolean, uuid[], uuid[], integer, integer, boolean, uuid[]
) TO service_role;
