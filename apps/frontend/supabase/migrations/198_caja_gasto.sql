-- Gastos en efectivo registrados durante la sesión de caja (apertura vigente).

CREATE TABLE public.caja_gasto (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id       UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  caja_id           TEXT NOT NULL,
  caja_apertura_id  UUID NOT NULL REFERENCES public.caja_apertura (id) ON DELETE CASCADE,
  concepto          TEXT NOT NULL,
  monto             NUMERIC(18, 6) NOT NULL,
  usuario_id        UUID REFERENCES public.usuario (id) ON DELETE SET NULL,
  cierre_z_id       UUID REFERENCES public.cierre_z (id) ON DELETE SET NULL,
  anulado_at        TIMESTAMPTZ,
  anulado_por       UUID REFERENCES public.usuario (id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_caja_gasto_monto CHECK (monto > 0)
);

CREATE INDEX idx_caja_gasto_apertura_created
  ON public.caja_gasto (caja_apertura_id, created_at);

CREATE INDEX idx_caja_gasto_tenant_caja_apertura
  ON public.caja_gasto (tenant_id, caja_id, caja_apertura_id)
  WHERE anulado_at IS NULL AND cierre_z_id IS NULL;

COMMENT ON TABLE public.caja_gasto IS
  'Egresos en efectivo anotados durante el turno POS; se incluyen automáticamente en el arqueo del cierre Z diario.';

ALTER TABLE public.caja_gasto ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_caja_gasto
  ON public.caja_gasto FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_caja_gasto
  ON public.caja_gasto FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_caja_gasto
  ON public.caja_gasto FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_caja_gasto
  ON public.caja_gasto FOR DELETE
  USING (tenant_id = public.current_tenant_id());
