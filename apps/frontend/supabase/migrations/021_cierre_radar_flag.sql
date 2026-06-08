-- V50-ANAL-005: cierre_mensual, radar_inflacion y flag analizador_rentabilidad.

-- ─── CIERRE MENSUAL ──────────────────────────────────────────────────

CREATE TABLE public.cierre_mensual (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  periodo           TEXT NOT NULL,

  ingresos_brutos       NUMERIC(18, 6) NOT NULL DEFAULT 0,
  costo_mercaderia      NUMERIC(18, 6) NOT NULL DEFAULT 0,
  margen_bruto          NUMERIC(18, 6) NOT NULL DEFAULT 0,
  margen_bruto_pct      NUMERIC(12, 6),
  unidades_vendidas     INTEGER NOT NULL DEFAULT 0,
  comprobantes_emitidos INTEGER NOT NULL DEFAULT 0,
  ticket_promedio       NUMERIC(18, 6),

  top_productos         JSONB,
  por_categoria         JSONB,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_cierre_mensual_tenant_periodo
    UNIQUE (tenant_id, periodo)
);

CREATE INDEX idx_cierre_mensual_tenant
  ON public.cierre_mensual (tenant_id, periodo DESC);

CREATE TRIGGER set_cierre_mensual_updated_at
  BEFORE UPDATE ON public.cierre_mensual
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.cierre_mensual ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_cierre_mensual
  ON public.cierre_mensual FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_cierre_mensual
  ON public.cierre_mensual FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_cierre_mensual
  ON public.cierre_mensual FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_cierre_mensual
  ON public.cierre_mensual FOR DELETE
  USING (tenant_id = public.current_tenant_id());

-- ─── RADAR INFLACION (cross-tenant, anonimizado) ────────────────────

CREATE TABLE public.radar_inflacion (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rubro             TEXT NOT NULL,
  proveedor_nombre  TEXT NOT NULL,
  periodo           TEXT NOT NULL,

  variacion_promedio_pct  NUMERIC(12, 6) NOT NULL DEFAULT 0,
  cantidad_listas         INTEGER NOT NULL DEFAULT 1,
  cantidad_items          INTEGER NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_radar_rubro_proveedor_periodo
    UNIQUE (rubro, proveedor_nombre, periodo)
);

CREATE INDEX idx_radar_inflacion_periodo
  ON public.radar_inflacion (periodo DESC);

CREATE TRIGGER set_radar_inflacion_updated_at
  BEFORE UPDATE ON public.radar_inflacion
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.radar_inflacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY radar_select_authenticated
  ON public.radar_inflacion FOR SELECT
  TO authenticated
  USING (true);

-- ─── FUNCIÓN: contribuir_radar (UPSERT ponderado) ───────────────────

CREATE OR REPLACE FUNCTION public.contribuir_radar(
  p_rubro               TEXT,
  p_proveedor_nombre    TEXT,
  p_periodo             TEXT,
  p_variacion_pct       NUMERIC,
  p_cantidad_items      INTEGER DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.radar_inflacion (
    rubro, proveedor_nombre, periodo,
    variacion_promedio_pct, cantidad_listas, cantidad_items
  ) VALUES (
    p_rubro, p_proveedor_nombre, p_periodo,
    p_variacion_pct, 1, p_cantidad_items
  )
  ON CONFLICT (rubro, proveedor_nombre, periodo) DO UPDATE SET
    variacion_promedio_pct = (
      (radar_inflacion.variacion_promedio_pct * radar_inflacion.cantidad_listas + p_variacion_pct)
      / (radar_inflacion.cantidad_listas + 1)
    ),
    cantidad_listas = radar_inflacion.cantidad_listas + 1,
    cantidad_items  = radar_inflacion.cantidad_items + p_cantidad_items;
END;
$$;

-- ─── FLAG analizador_rentabilidad en modulo_config ───────────────────

ALTER TABLE public.modulo_config
  ADD COLUMN analizador_rentabilidad BOOLEAN NOT NULL DEFAULT false;

-- ─── ACTUALIZAR activar_plan ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION activar_plan(
  p_tenant_id UUID,
  p_plan      plan_tipo
) RETURNS void AS $$
BEGIN
  UPDATE tenant SET plan = p_plan WHERE id = p_tenant_id;

  IF p_plan = 'completo' THEN
    UPDATE modulo_config SET
      facturador_simple = true,
      facturador_arca = true,
      pedidos = true,
      presupuestos = true,
      ia_precios = true,
      analizador_rentabilidad = true
    WHERE tenant_id = p_tenant_id;
  ELSIF p_plan = 'base' THEN
    UPDATE modulo_config SET
      facturador_arca = false,
      presupuestos = false,
      pedidos = true,
      ia_precios = true,
      analizador_rentabilidad = false
    WHERE tenant_id = p_tenant_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
