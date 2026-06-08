-- Búsqueda de PLU por valor entero: "23" encuentra PLU 00023 en texto_buscable y POS rápido.

CREATE OR REPLACE FUNCTION public.plu_entero_para_busqueda_db(plu text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN COALESCE(btrim(plu), '') = '' THEN ''
    WHEN regexp_replace(btrim(plu), '\D', '', 'g') = '' THEN ''
    ELSE (regexp_replace(btrim(plu), '\D', '', 'g')::bigint)::text
  END;
$$;

COMMENT ON FUNCTION public.plu_entero_para_busqueda_db(text) IS
  'PLU sin ceros a la izquierda para búsqueda (00023 → 23).';

ALTER TABLE public.producto DROP COLUMN IF EXISTS texto_buscable;

ALTER TABLE public.producto
  ADD COLUMN texto_buscable text
  GENERATED ALWAYS AS (
    public.normalizar_texto_buscable_db(
      coalesce(nombre, '') || ' ' ||
      coalesce(codigo, '') || ' ' ||
      coalesce(codigo_barras, '') || ' ' ||
      coalesce(plu, '') || ' ' ||
      public.plu_entero_para_busqueda_db(plu::text) || ' ' ||
      coalesce(descripcion, '') || ' ' ||
      coalesce(rubro, '') || ' ' ||
      coalesce(subrubro, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_producto_activo_texto_buscable_trgm
  ON public.producto
  USING gin (texto_buscable gin_trgm_ops)
  WHERE activo = true;

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
      regexp_replace(btrim(COALESCE(p_q, '')), '\D', '', 'g') AS digits_q,
      CASE
        WHEN regexp_replace(btrim(COALESCE(p_q, '')), '\D', '', 'g') = '' THEN ''
        ELSE (regexp_replace(btrim(COALESCE(p_q, '')), '\D', '', 'g')::bigint)::text
      END AS plu_int_q
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
        WHEN (SELECT plu_int_q FROM q) <> ''
             AND public.plu_entero_para_busqueda_db(p.plu::text) = (SELECT plu_int_q FROM q) THEN 2
        WHEN lower(COALESCE(p.codigo, '')) LIKE lower((SELECT norm_q FROM q)) || '%' THEN 3
        WHEN (SELECT plu_int_q FROM q) <> ''
             AND public.plu_entero_para_busqueda_db(p.plu::text) LIKE (SELECT plu_int_q FROM q) || '%' THEN 3
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
          OR (SELECT plu_int_q FROM q) <> ''
             AND public.plu_entero_para_busqueda_db(p.plu::text) = (SELECT plu_int_q FROM q)
          OR (SELECT plu_int_q FROM q) <> ''
             AND public.plu_entero_para_busqueda_db(p.plu::text) LIKE (SELECT plu_int_q FROM q) || '%'
        )
      )
  )
  SELECT c.id AS producto_id, c.rank_score
  FROM cand c
  ORDER BY c.rank_score ASC, c.nombre ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 140), 1), 300);
$$;

COMMENT ON FUNCTION public.buscar_productos_pos_rapido(uuid, text, uuid, integer) IS
  'Búsqueda rápida POS con ranking (exacto código/barra/plu entero > prefijo > subcadena).';
