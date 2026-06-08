-- V80-CAJA-001: cierre Z diario por caja con snapshot inmutable y desglose por medio de pago.
-- Requiere: comprobante, pago, usuario, current_tenant_id (017).

CREATE TABLE public.cierre_z (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  caja_id                 TEXT NOT NULL DEFAULT '__sin_caja__',
  fecha_operativa         DATE NOT NULL,
  tipo_cierre             TEXT NOT NULL DEFAULT 'diario',
  rango_desde             TIMESTAMPTZ NOT NULL,
  rango_hasta             TIMESTAMPTZ NOT NULL,
  total_comprobantes      INTEGER NOT NULL DEFAULT 0,
  ventas_brutas           NUMERIC(18, 6) NOT NULL DEFAULT 0,
  notas_credito_total     NUMERIC(18, 6) NOT NULL DEFAULT 0,
  ventas_netas            NUMERIC(18, 6) NOT NULL DEFAULT 0,
  pagos_cta_cte_total     NUMERIC(18, 6) NOT NULL DEFAULT 0,
  usuario_cierre_id       UUID REFERENCES public.usuario (id) ON DELETE SET NULL,
  payload_resumen         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_cierre_z_tipo
    CHECK (tipo_cierre IN ('diario', 'parcial')),
  CONSTRAINT chk_cierre_z_rango
    CHECK (rango_hasta >= rango_desde),
  CONSTRAINT uq_cierre_z_diario
    UNIQUE (tenant_id, caja_id, fecha_operativa, tipo_cierre)
);

CREATE INDEX idx_cierre_z_tenant_fecha
  ON public.cierre_z (tenant_id, fecha_operativa DESC, created_at DESC);

CREATE TABLE public.cierre_z_medio_pago (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  cierre_z_id             UUID NOT NULL REFERENCES public.cierre_z (id) ON DELETE CASCADE,
  metodo_pago             TEXT NOT NULL,
  monto_neto              NUMERIC(18, 6) NOT NULL DEFAULT 0,
  cantidad_comprobantes   INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_cierre_z_medio_pago
    UNIQUE (cierre_z_id, metodo_pago)
);

CREATE INDEX idx_cierre_z_medio_tenant
  ON public.cierre_z_medio_pago (tenant_id, cierre_z_id);

COMMENT ON TABLE public.cierre_z IS
  'Snapshot de cierre Z por caja/fecha. Inmutable: no se recalcula sobre el mismo scope.';
COMMENT ON TABLE public.cierre_z_medio_pago IS
  'Desglose del cierre Z por método de pago (monto neto y cantidad de comprobantes).';

ALTER TABLE public.cierre_z ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cierre_z_medio_pago ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_cierre_z
  ON public.cierre_z FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_cierre_z
  ON public.cierre_z FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_cierre_z
  ON public.cierre_z FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_cierre_z
  ON public.cierre_z FOR DELETE
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_select_cierre_z_medio
  ON public.cierre_z_medio_pago FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_cierre_z_medio
  ON public.cierre_z_medio_pago FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_cierre_z_medio
  ON public.cierre_z_medio_pago FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_cierre_z_medio
  ON public.cierre_z_medio_pago FOR DELETE
  USING (tenant_id = public.current_tenant_id());
