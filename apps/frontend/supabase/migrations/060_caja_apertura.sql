-- V80-CAJA-003: apertura de caja (fondo declarado) para arqueo desde último cierre.

CREATE TABLE public.caja_apertura (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  caja_id           TEXT NOT NULL DEFAULT '__sin_caja__',
  fecha_operativa   DATE NOT NULL,
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  fondo_efectivo    NUMERIC(18, 6) NOT NULL,
  notas             TEXT,
  usuario_id        UUID REFERENCES public.usuario (id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_caja_apertura_fondo CHECK (fondo_efectivo >= 0)
);

CREATE INDEX idx_caja_apertura_tenant_caja_opened
  ON public.caja_apertura (tenant_id, caja_id, opened_at DESC);

COMMENT ON TABLE public.caja_apertura IS
  'Fondo en efectivo declarado al abrir la caja tras el último cierre Z diario; el cierre en modo sesión usa opened_at como inicio del período.';

ALTER TABLE public.caja_apertura ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_caja_apertura
  ON public.caja_apertura FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_caja_apertura
  ON public.caja_apertura FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_caja_apertura
  ON public.caja_apertura FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_caja_apertura
  ON public.caja_apertura FOR DELETE
  USING (tenant_id = public.current_tenant_id());
