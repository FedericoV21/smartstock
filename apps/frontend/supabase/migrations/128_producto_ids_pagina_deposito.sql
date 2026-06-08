-- Listado paginado por depósito (producto hogar en la sucursal o fila en stock_sucursal)
-- sin exponer miles de UUID en la query string PostgREST (evita 414 Request-URI Too Large).

CREATE OR REPLACE FUNCTION public.producto_ids_pagina_deposito(
  p_tenant_id uuid,
  p_deposito_id uuid,
  p_activo boolean,
  p_offset integer,
  p_limit integer,
  p_orden_por_actualizado boolean,
  p_texto_buscable_ilike text DEFAULT NULL,
  p_categoria_ids_por_busqueda uuid[] DEFAULT NULL,
  p_categoria_id uuid DEFAULT NULL,
  p_vencidos_hasta date DEFAULT NULL
)
RETURNS TABLE (producto_id uuid, full_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH vis AS (
    SELECT p.id AS producto_id
    FROM public.producto p
    WHERE p.tenant_id = p_tenant_id
      AND p.sucursal_id = p_deposito_id
    UNION
    SELECT ss.producto_id
    FROM public.stock_sucursal ss
    WHERE ss.tenant_id = p_tenant_id
      AND ss.sucursal_id = p_deposito_id
  ),
  cand AS (
    SELECT
      p.id,
      p.nombre,
      p.updated_at
    FROM public.producto p
    INNER JOIN vis v ON v.producto_id = p.id
    WHERE p.tenant_id = p_tenant_id
      AND p.activo = p_activo
      AND (p_categoria_id IS NULL OR p.categoria_id = p_categoria_id)
      AND (
        (
          COALESCE(btrim(p_texto_buscable_ilike), '') = ''
          AND (
            p_categoria_ids_por_busqueda IS NULL
            OR cardinality(p_categoria_ids_por_busqueda) = 0
          )
        )
        OR (
          COALESCE(btrim(p_texto_buscable_ilike), '') <> ''
          AND p.texto_buscable ILIKE ('%' || btrim(p_texto_buscable_ilike) || '%')
        )
        OR (
          p_categoria_ids_por_busqueda IS NOT NULL
          AND cardinality(p_categoria_ids_por_busqueda) > 0
          AND p.categoria_id = ANY (p_categoria_ids_por_busqueda)
        )
      )
      AND (
        p_vencidos_hasta IS NULL
        OR (
          p.fecha_vencimiento IS NOT NULL
          AND p.fecha_vencimiento <= p_vencidos_hasta
        )
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

COMMENT ON FUNCTION public.producto_ids_pagina_deposito(
  uuid, uuid, boolean, integer, integer, boolean, text, uuid[], uuid, date
) IS
  'Paginación en depósito: catálogo hogar en sucursal o stock_sucursal. Evita id.in/or gigantes en cliente PostgREST.';

GRANT EXECUTE ON FUNCTION public.producto_ids_pagina_deposito(
  uuid, uuid, boolean, integer, integer, boolean, text, uuid[], uuid, date
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.producto_ids_pagina_deposito(
  uuid, uuid, boolean, integer, integer, boolean, text, uuid[], uuid, date
) TO service_role;
