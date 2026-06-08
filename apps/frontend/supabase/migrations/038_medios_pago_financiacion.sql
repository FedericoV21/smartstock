-- Medios de pago configurables por tenant (nombre + tabla cuotas/recargo %).
-- Comprobante: snapshot de financiación y total de mercadería antes del ajuste.

CREATE TABLE public.medio_pago (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  tenant_id   UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  orden       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now (),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now ()
);

CREATE INDEX idx_medio_pago_tenant_activo ON public.medio_pago (tenant_id, activo);

CREATE TABLE public.medio_pago_opcion (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  medio_pago_id         UUID NOT NULL REFERENCES public.medio_pago (id) ON DELETE CASCADE,
  cuotas                INTEGER NOT NULL,
  recargo_porcentaje    NUMERIC(12, 4) NOT NULL,
  CONSTRAINT chk_medio_pago_opcion_cuotas CHECK (cuotas >= 1),
  CONSTRAINT uq_medio_pago_opcion_medio_cuotas UNIQUE (medio_pago_id, cuotas)
);

CREATE INDEX idx_medio_pago_opcion_medio ON public.medio_pago_opcion (medio_pago_id);

CREATE TRIGGER set_medio_pago_updated_at
  BEFORE UPDATE ON public.medio_pago
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS total_mercaderia NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS medio_pago_opcion_id UUID REFERENCES public.medio_pago_opcion (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS financiacion_monto NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS financiacion_porcentaje NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS financiacion_descripcion TEXT;

CREATE INDEX IF NOT EXISTS idx_comprobante_medio_pago_opcion
  ON public.comprobante (medio_pago_opcion_id);

COMMENT ON COLUMN public.comprobante.total_mercaderia IS
  'Total de mercadería (antes de recargo/descuento por medio de pago). Si NULL, no hubo financiación explícita.';
COMMENT ON COLUMN public.comprobante.financiacion_monto IS
  'Monto del ajuste: positivo recargo, negativo descuento. ImpTrib ARCA solo si > 0.';

ALTER TABLE public.medio_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medio_pago_opcion ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_medio_pago
  ON public.medio_pago FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_medio_pago
  ON public.medio_pago FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_medio_pago
  ON public.medio_pago FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_medio_pago
  ON public.medio_pago FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_select_medio_pago_opcion
  ON public.medio_pago_opcion FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.medio_pago mp
      WHERE mp.id = medio_pago_opcion.medio_pago_id
        AND mp.tenant_id = public.current_tenant_id ()
    )
  );

CREATE POLICY tenant_insert_medio_pago_opcion
  ON public.medio_pago_opcion FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.medio_pago mp
      WHERE mp.id = medio_pago_opcion.medio_pago_id
        AND mp.tenant_id = public.current_tenant_id ()
    )
  );

CREATE POLICY tenant_update_medio_pago_opcion
  ON public.medio_pago_opcion FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.medio_pago mp
      WHERE mp.id = medio_pago_opcion.medio_pago_id
        AND mp.tenant_id = public.current_tenant_id ()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.medio_pago mp
      WHERE mp.id = medio_pago_opcion.medio_pago_id
        AND mp.tenant_id = public.current_tenant_id ()
    )
  );

CREATE POLICY tenant_delete_medio_pago_opcion
  ON public.medio_pago_opcion FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.medio_pago mp
      WHERE mp.id = medio_pago_opcion.medio_pago_id
        AND mp.tenant_id = public.current_tenant_id ()
    )
  );
