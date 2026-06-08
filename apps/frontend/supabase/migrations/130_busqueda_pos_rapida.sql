-- Búsqueda POS rápida con ranking en una sola query SQL.
-- Prioriza exactos de código/barra/PLU, luego prefijos y por último subcadena.

CREATE OR REPLACE FUNCTION public.buscar_productos_pos_rapido(
  p_tenant_id uuid,
  p_q text,
  p_proveedor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 140
)
RETURNS TABLE (producto_id uuid, rank_score integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH q AS (
    SELECT
      btrim(COALESCE(p_q, '')) AS raw_q,
      public.normalizar_texto_buscable_db(btrim(COALESCE(p_q, ''))) AS norm_q,
      regexp_replace(btrim(COALESCE(p_q, '')), '\D', '', 'g') AS digits_q
  ),
  cand AS (
    SELECT
      p.id,
      p.nombre,
      CASE
        WHEN (SELECT digits_q FROM q) <> ''
             AND char_length((SELECT digits_q FROM q)) >= 6
             AND COALESCE(p.codigo_barras, '') = (SELECT digits_q FROM q) THEN 0
        WHEN lower(COALESCE(p.codigo, '')) = lower((SELECT raw_q FROM q)) THEN 1
        WHEN lower(COALESCE(p.codigo_barras, '')) = lower((SELECT raw_q FROM q)) THEN 2
        WHEN lower(COALESCE(p.codigo, '')) LIKE lower((SELECT norm_q FROM q)) || '%' THEN 3
        WHEN lower(COALESCE(p.nombre, '')) LIKE lower((SELECT norm_q FROM q)) || '%' THEN 4
        WHEN lower(COALESCE(p.nombre, '')) LIKE '% ' || lower((SELECT norm_q FROM q)) || '%' THEN 5
        ELSE 6
      END AS rank_score
    FROM public.producto p
    WHERE p.tenant_id = p_tenant_id
      AND p.activo = true
      AND (p_proveedor_id IS NULL OR p.proveedor_id = p_proveedor_id)
      AND (
        COALESCE((SELECT norm_q FROM q), '') <> ''
        AND (
          p.texto_buscable ILIKE '%' || (SELECT norm_q FROM q) || '%'
          OR p.codigo ILIKE (SELECT norm_q FROM q) || '%'
          OR p.nombre ILIKE (SELECT norm_q FROM q) || '%'
          OR (SELECT digits_q FROM q) <> '' AND COALESCE(p.codigo_barras, '') = (SELECT digits_q FROM q)
          OR (SELECT digits_q FROM q) <> '' AND COALESCE(p.plu, '') = (SELECT digits_q FROM q)
        )
      )
  )
  SELECT c.id AS producto_id, c.rank_score
  FROM cand c
  ORDER BY c.rank_score ASC, c.nombre ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 140), 1), 300);
$$;

COMMENT ON FUNCTION public.buscar_productos_pos_rapido(uuid, text, uuid, integer) IS
  'Búsqueda rápida POS con ranking (exacto código/barra/plu > prefijo > subcadena).';

GRANT EXECUTE ON FUNCTION public.buscar_productos_pos_rapido(uuid, text, uuid, integer)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.buscar_productos_pos_rapido(uuid, text, uuid, integer)
  TO service_role;
