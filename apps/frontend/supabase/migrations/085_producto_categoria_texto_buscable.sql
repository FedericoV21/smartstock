-- Búsqueda insensible a tildes/acentos: columna en minúsculas + unaccent.
-- Debe alinearse con normalizarTextoBusqueda() en la API (NFD + quitar marcas + lower).
--
-- unaccent() es STABLE en PostgreSQL; las columnas GENERATED STORED exigen expresiones
-- inmutables. Esta función SQL declarada IMMUTABLE es el patrón habitual (diccionario fijo).
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.normalizar_texto_buscable_db(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(unaccent('unaccent', coalesce(input, '')));
$$;

ALTER TABLE public.categoria
  ADD COLUMN IF NOT EXISTS texto_buscable text
  GENERATED ALWAYS AS (public.normalizar_texto_buscable_db(nombre)) STORED;

CREATE INDEX IF NOT EXISTS idx_categoria_texto_buscable_trgm
  ON public.categoria
  USING gin (texto_buscable gin_trgm_ops);

ALTER TABLE public.producto
  ADD COLUMN IF NOT EXISTS texto_buscable text
  GENERATED ALWAYS AS (
    public.normalizar_texto_buscable_db(
      coalesce(nombre, '') || ' ' ||
      coalesce(codigo, '') || ' ' ||
      coalesce(codigo_barras, '') || ' ' ||
      coalesce(plu, '') || ' ' ||
      coalesce(descripcion, '') || ' ' ||
      coalesce(rubro, '') || ' ' ||
      coalesce(subrubro, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_producto_activo_texto_buscable_trgm
  ON public.producto
  USING gin (texto_buscable gin_trgm_ops)
  WHERE activo = true;
