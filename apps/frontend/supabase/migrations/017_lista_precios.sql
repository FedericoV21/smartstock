-- V50-ANAL-001: listas de precios persistentes (documento + ítems).
-- Requiere migraciones base (tenant, usuario, proveedor, producto, enums incl. origen_precio, unidad_medida, moddatetime).

-- Helper RLS: en Supabase Dashboard no se puede crear en schema `auth` (42501).
-- Equivalente a `auth.tenant_id()` en docs/smartstock; policies de esta migración usan public.current_tenant_id().
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid,
    NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO service_role;

CREATE TYPE public.estado_lista_precios AS ENUM (
  'pendiente',
  'analizada',
  'aplicada_total',
  'aplicada_parcial',
  'archivada',
  'error'
);

CREATE TABLE public.lista_precios (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  proveedor_id            UUID NOT NULL REFERENCES public.proveedor (id) ON DELETE RESTRICT,
  usuario_id              UUID REFERENCES public.usuario (id) ON DELETE SET NULL,

  nombre_archivo          TEXT NOT NULL,
  mime_type               TEXT,
  storage_bucket          TEXT NOT NULL DEFAULT 'listas-precios',
  storage_path            TEXT,
  origen_extraccion       public.origen_precio NOT NULL,
  fecha_recepcion         TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_vigencia_desde    DATE,
  fecha_vigencia_hasta    DATE,

  estado                  public.estado_lista_precios NOT NULL DEFAULT 'pendiente',
  error_mensaje           TEXT,

  total_items                      INTEGER NOT NULL DEFAULT 0,
  items_matcheados_seguros         INTEGER NOT NULL DEFAULT 0,
  items_matcheados_dudosos         INTEGER NOT NULL DEFAULT 0,
  items_sin_match                  INTEGER NOT NULL DEFAULT 0,
  items_con_aumento                INTEGER NOT NULL DEFAULT 0,
  items_con_baja                   INTEGER NOT NULL DEFAULT 0,
  items_sin_cambio                 INTEGER NOT NULL DEFAULT 0,

  variacion_promedio_pct           NUMERIC(12, 6),
  margen_global_anterior_pct       NUMERIC(12, 6),
  margen_global_nuevo_pct          NUMERIC(12, 6),
  impacto_por_categoria            JSONB,
  resumen_ia                       JSONB,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lista_precios_tenant_proveedor
  ON public.lista_precios (tenant_id, proveedor_id);

CREATE INDEX idx_lista_precios_tenant_fecha_recepcion
  ON public.lista_precios (tenant_id, fecha_recepcion DESC);

CREATE TRIGGER set_lista_precios_updated_at
  BEFORE UPDATE ON public.lista_precios
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

CREATE TABLE public.lista_precios_item (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lista_id                UUID NOT NULL REFERENCES public.lista_precios (id) ON DELETE CASCADE,

  orden                   INTEGER,
  codigo_proveedor        TEXT,
  nombre_raw              TEXT NOT NULL,
  nombre_normalizado      TEXT,
  unidad                  public.unidad_medida,
  precio_lista            NUMERIC(18, 6) NOT NULL,

  producto_id             UUID REFERENCES public.producto (id) ON DELETE SET NULL,
  match_confidence        NUMERIC(6, 5)
    CONSTRAINT chk_lista_precios_item_confidence
      CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),
  match_metodo            TEXT,

  precio_costo_anterior   NUMERIC(18, 6),
  variacion_pct           NUMERIC(12, 6),
  precio_venta_actual     NUMERIC(18, 6),
  margen_anterior_pct     NUMERIC(12, 6),
  margen_nuevo_pct        NUMERIC(12, 6),
  precio_venta_sugerido   NUMERIC(18, 6),
  precio_venta_decidido   NUMERIC(18, 6),

  incluir_en_aplicacion   BOOLEAN NOT NULL DEFAULT true,
  notas                   TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lista_precios_item_lista
  ON public.lista_precios_item (lista_id);

CREATE INDEX idx_lista_precios_item_producto
  ON public.lista_precios_item (producto_id);

-- RLS: aislamiento por tenant (ítems vía lista padre).
ALTER TABLE public.lista_precios ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_lista_precios
  ON public.lista_precios FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_lista_precios
  ON public.lista_precios FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_lista_precios
  ON public.lista_precios FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_lista_precios
  ON public.lista_precios FOR DELETE
  USING (tenant_id = public.current_tenant_id());

ALTER TABLE public.lista_precios_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_lista_precios_item
  ON public.lista_precios_item FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.lista_precios lp
      WHERE lp.id = lista_precios_item.lista_id
        AND lp.tenant_id = public.current_tenant_id()
    )
  );

CREATE POLICY tenant_insert_lista_precios_item
  ON public.lista_precios_item FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.lista_precios lp
      WHERE lp.id = lista_precios_item.lista_id
        AND lp.tenant_id = public.current_tenant_id()
    )
  );

CREATE POLICY tenant_update_lista_precios_item
  ON public.lista_precios_item FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.lista_precios lp
      WHERE lp.id = lista_precios_item.lista_id
        AND lp.tenant_id = public.current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.lista_precios lp
      WHERE lp.id = lista_precios_item.lista_id
        AND lp.tenant_id = public.current_tenant_id()
    )
  );

CREATE POLICY tenant_delete_lista_precios_item
  ON public.lista_precios_item FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.lista_precios lp
      WHERE lp.id = lista_precios_item.lista_id
        AND lp.tenant_id = public.current_tenant_id()
    )
  );
