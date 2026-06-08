-- Combinar filtro por proveedor con búsqueda (texto_buscable) y categoría.
--
-- Nombre distinto al de la migración 125: PostgREST no resuelve bien dos funciones
-- homónimas con distinta aridad (error 500 / "ambiguous function").

CREATE OR REPLACE FUNCTION public.producto_ids_pagina_filtrar_proveedores_ext(
  p_tenant_id uuid,
  p_activo boolean,
  p_sucursal_ids uuid[],
  p_proveedor_ids uuid[],
  p_offset integer,
  p_limit integer,
  p_orden_por_actualizado boolean,
  p_restringir_a_ids uuid[] DEFAULT NULL,
  p_categoria_id uuid DEFAULT NULL,
  p_texto_buscable_ilike text DEFAULT NULL,
  p_categoria_ids_por_busqueda uuid[] DEFAULT NULL
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
          AND p.texto_buscable ilike ('%' || btrim(p_texto_buscable_ilike) || '%')
        )
        OR (
          p_categoria_ids_por_busqueda IS NOT NULL
          AND cardinality(p_categoria_ids_por_busqueda) > 0
          AND p.categoria_id = ANY (p_categoria_ids_por_busqueda)
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

COMMENT ON FUNCTION public.producto_ids_pagina_filtrar_proveedores_ext(
  uuid, boolean, uuid[], uuid[], integer, integer, boolean, uuid[], uuid, text, uuid[]
) IS
  'Paginación por proveedor + opcional texto_buscable / rubro. Ver migración 125 para la variante de 8 args.';

GRANT EXECUTE ON FUNCTION public.producto_ids_pagina_filtrar_proveedores_ext(
  uuid, boolean, uuid[], uuid[], integer, integer, boolean, uuid[], uuid, text, uuid[]
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.producto_ids_pagina_filtrar_proveedores_ext(
  uuid, boolean, uuid[], uuid[], integer, integer, boolean, uuid[], uuid, text, uuid[]
) TO service_role;
