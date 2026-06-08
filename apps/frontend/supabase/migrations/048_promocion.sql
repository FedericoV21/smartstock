-- v8.0 — Motor de promociones: tipo ENUM y tabla promocion (V80-PROMO-001).

CREATE TYPE public.promocion_tipo AS ENUM (
  'porcentaje_off',
  'n_x_m',
  'porcentaje_unidad_n',
  'descuento_volumen'
);

CREATE TABLE public.promocion (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  tenant_id         UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  nombre            TEXT NOT NULL,
  tipo              public.promocion_tipo NOT NULL,
  cantidad_lleva    INTEGER,
  cantidad_paga     INTEGER,
  unidad_descuento  INTEGER,
  porcentaje        NUMERIC(5, 2),
  cantidad_minima   INTEGER,
  vigente_desde     DATE,
  vigente_hasta     DATE,
  dias_semana       INTEGER[],
  activa            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now (),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now (),
  CONSTRAINT chk_promo_nxm_valido CHECK (
    tipo <> 'n_x_m'::public.promocion_tipo
    OR (
      cantidad_lleva IS NOT NULL
      AND cantidad_paga IS NOT NULL
      AND cantidad_lleva > cantidad_paga
      AND cantidad_paga > 0
    )
  ),
  CONSTRAINT chk_promo_porcentaje_valido CHECK (
    tipo NOT IN (
      'porcentaje_off'::public.promocion_tipo,
      'porcentaje_unidad_n'::public.promocion_tipo,
      'descuento_volumen'::public.promocion_tipo
    )
    OR (
      porcentaje IS NOT NULL
      AND porcentaje > 0
      AND porcentaje <= 100
    )
  ),
  CONSTRAINT chk_promo_vigencia CHECK (
    vigente_hasta IS NULL
    OR vigente_desde IS NULL
    OR vigente_hasta >= vigente_desde
  ),
  CONSTRAINT chk_promo_volumen_minimo CHECK (
    tipo <> 'descuento_volumen'::public.promocion_tipo
    OR (cantidad_minima IS NOT NULL AND cantidad_minima >= 2)
  ),
  CONSTRAINT chk_promo_unidad_n CHECK (
    tipo <> 'porcentaje_unidad_n'::public.promocion_tipo
    OR (unidad_descuento IS NOT NULL AND unidad_descuento >= 2)
  )
);

CREATE INDEX idx_promocion_tenant ON public.promocion (tenant_id);

CREATE INDEX idx_promocion_activa_vigente ON public.promocion (tenant_id)
  WHERE activa = TRUE;

CREATE TRIGGER set_promocion_updated_at
  BEFORE UPDATE ON public.promocion
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.promocion ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_promocion
  ON public.promocion FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_promocion
  ON public.promocion FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_promocion
  ON public.promocion FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_promocion
  ON public.promocion FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

COMMENT ON TABLE public.promocion IS
  'Promociones por tenant. Parámetros según tipo en columnas nullable; validación adicional en aplicación.';
