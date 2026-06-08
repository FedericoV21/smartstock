-- V70-COB-001: cobranza por factura (saldo, vencimiento 7d, recordatorios) y pagos parciales.
-- Requiere cliente, comprobante, tenant, usuario, tipo_pago (020_cuenta_corriente), current_tenant_id (017).

-- ─── TABLAS ──────────────────────────────────────────────────────────

CREATE TABLE public.cobranza_factura (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  comprobante_id            UUID NOT NULL REFERENCES public.comprobante (id) ON DELETE CASCADE,
  cliente_id                UUID NOT NULL REFERENCES public.cliente (id) ON DELETE CASCADE,
  monto_original            NUMERIC(18, 6) NOT NULL,
  saldo_pendiente           NUMERIC(18, 6) NOT NULL,
  vencimiento_at            TIMESTAMPTZ NOT NULL,
  recordatorio_snooze_until TIMESTAMPTZ NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_cobranza_factura_comprobante UNIQUE (tenant_id, comprobante_id),
  CONSTRAINT chk_cobranza_saldo_no_neg CHECK (saldo_pendiente >= 0),
  CONSTRAINT chk_cobranza_monto_pos CHECK (monto_original > 0)
);

CREATE INDEX idx_cobranza_factura_tenant_saldo
  ON public.cobranza_factura (tenant_id)
  WHERE saldo_pendiente > 0;

CREATE INDEX idx_cobranza_factura_cliente
  ON public.cobranza_factura (tenant_id, cliente_id);

CREATE TRIGGER set_cobranza_factura_updated_at
  BEFORE UPDATE ON public.cobranza_factura
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

CREATE TABLE public.cobranza_pago (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  cobranza_factura_id UUID NOT NULL REFERENCES public.cobranza_factura (id) ON DELETE CASCADE,
  monto               NUMERIC(18, 6) NOT NULL
    CONSTRAINT chk_cobranza_pago_monto_pos CHECK (monto > 0),
  tipo_pago           public.tipo_pago NOT NULL DEFAULT 'efectivo',
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  usuario_id          UUID REFERENCES public.usuario (id) ON DELETE SET NULL,
  notas               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cobranza_pago_tenant
  ON public.cobranza_pago (tenant_id);

CREATE INDEX idx_cobranza_pago_factura
  ON public.cobranza_pago (cobranza_factura_id);

-- ─── RLS ─────────────────────────────────────────────────────────────

ALTER TABLE public.cobranza_factura ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_cobranza_factura
  ON public.cobranza_factura FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_cobranza_factura
  ON public.cobranza_factura FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_cobranza_factura
  ON public.cobranza_factura FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_cobranza_factura
  ON public.cobranza_factura FOR DELETE
  USING (tenant_id = public.current_tenant_id());

ALTER TABLE public.cobranza_pago ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_cobranza_pago
  ON public.cobranza_pago FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_cobranza_pago
  ON public.cobranza_pago FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_cobranza_pago
  ON public.cobranza_pago FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_cobranza_pago
  ON public.cobranza_pago FOR DELETE
  USING (tenant_id = public.current_tenant_id());

-- ─── RPC: registrar pago contra una cobranza (atómico + cuenta corriente) ─

CREATE OR REPLACE FUNCTION public.registrar_pago_cobranza(
  p_cobranza_factura_id UUID,
  p_monto NUMERIC,
  p_tipo_pago public.tipo_pago DEFAULT 'efectivo',
  p_notas TEXT DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID := public.current_tenant_id();
  v_row public.cobranza_factura%ROWTYPE;
  v_new_saldo NUMERIC(18, 6);
  v_new_venc TIMESTAMPTZ;
  v_pago_id UUID;
  v_pago_cc public.pago;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sin tenant en el token';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  SELECT * INTO v_row
  FROM public.cobranza_factura
  WHERE id = p_cobranza_factura_id
    AND tenant_id = v_tenant
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobranza no encontrada';
  END IF;

  IF p_monto > v_row.saldo_pendiente THEN
    RAISE EXCEPTION 'El monto supera el saldo pendiente';
  END IF;

  v_new_saldo := v_row.saldo_pendiente - p_monto;

  IF v_new_saldo > 0 THEN
    v_new_venc := now() + interval '7 days';
  ELSE
    v_new_venc := v_row.vencimiento_at;
  END IF;

  UPDATE public.cobranza_factura
  SET
    saldo_pendiente = v_new_saldo,
    vencimiento_at = v_new_venc,
    recordatorio_snooze_until = NULL,
    updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.cobranza_pago (
    tenant_id,
    cobranza_factura_id,
    monto,
    tipo_pago,
    fecha,
    usuario_id,
    notas
  )
  VALUES (
    v_tenant,
    v_row.id,
    p_monto,
    p_tipo_pago,
    CURRENT_DATE,
    p_usuario_id,
    p_notas
  )
  RETURNING id INTO v_pago_id;

  v_pago_cc := public.registrar_pago(
    v_tenant,
    v_row.cliente_id,
    p_monto,
    p_tipo_pago,
    v_row.comprobante_id,
    NULL,
    p_notas,
    p_usuario_id
  );

  RETURN jsonb_build_object(
    'cobranza_pago_id', v_pago_id,
    'nuevo_saldo', v_new_saldo,
    'pago_cuenta_corriente_id', v_pago_cc.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_pago_cobranza(UUID, NUMERIC, public.tipo_pago, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pago_cobranza(UUID, NUMERIC, public.tipo_pago, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pago_cobranza(UUID, NUMERIC, public.tipo_pago, TEXT, UUID) TO service_role;

COMMENT ON TABLE public.cobranza_factura IS
  'Seguimiento de cobro por factura: saldo, vencimiento renovable en pagos parciales, snooze de recordatorio.';
COMMENT ON FUNCTION public.registrar_pago_cobranza IS
  'Registra cobro parcial/total: actualiza saldo y vencimiento, inserta cobranza_pago y llama registrar_pago (cuenta corriente).';
