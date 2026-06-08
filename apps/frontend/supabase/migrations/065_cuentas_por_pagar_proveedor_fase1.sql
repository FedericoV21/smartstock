-- Fase 1: cuentas por pagar a proveedores (espejo de cobranza) + extensión pago/registrar pago a proveedores.
-- Requiere: 020, 044, 045, 046 (comprobante compra, cuenta_corriente proveedor).

-- ═══ proveedor: condición de pago default ═══

ALTER TABLE public.proveedor
  ADD COLUMN IF NOT EXISTS condicion_pago_default TEXT NOT NULL DEFAULT 'contado',
  ADD COLUMN IF NOT EXISTS plazo_pago_dias INTEGER;

ALTER TABLE public.proveedor
  DROP CONSTRAINT IF EXISTS chk_proveedor_condicion_plazo;

ALTER TABLE public.proveedor
  DROP CONSTRAINT IF EXISTS chk_proveedor_plazo_pago;

ALTER TABLE public.proveedor
  ADD CONSTRAINT chk_proveedor_condicion_plazo
    CHECK (condicion_pago_default IN ('contado', 'dias'));

ALTER TABLE public.proveedor
  ADD CONSTRAINT chk_proveedor_plazo_pago
    CHECK (
      (condicion_pago_default = 'dias' AND plazo_pago_dias IS NOT NULL AND plazo_pago_dias > 0)
      OR
      (condicion_pago_default = 'contado' AND plazo_pago_dias IS NULL)
    );

COMMENT ON COLUMN public.proveedor.condicion_pago_default IS
  'Contado: vencimiento al día de la factura. A días: usar plazo_pago_dias > 0.';
COMMENT ON COLUMN public.proveedor.plazo_pago_dias IS
  'Obligatorio y > 0 si condicion_pago_default = ''dias''.';

-- ═══ pago: soportar proveedor (exclusivo con cliente) ═══

ALTER TABLE public.pago
  ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES public.proveedor (id) ON DELETE RESTRICT;

ALTER TABLE public.pago
  ALTER COLUMN cliente_id DROP NOT NULL;

ALTER TABLE public.pago
  DROP CONSTRAINT IF EXISTS chk_pago_cliente_x_proveedor;

ALTER TABLE public.pago
  ADD CONSTRAINT chk_pago_cliente_x_proveedor
    CHECK (
      (cliente_id IS NOT NULL AND proveedor_id IS NULL)
      OR
      (cliente_id IS NULL AND proveedor_id IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_pago_tenant_proveedor
  ON public.pago (tenant_id, proveedor_id)
  WHERE proveedor_id IS NOT NULL;

-- ═══ Función: registrar pago en CC para proveedor (pago + saldo) ═══

CREATE OR REPLACE FUNCTION public.registrar_pago_cuenta_proveedor(
  p_tenant_id      UUID,
  p_proveedor_id   UUID,
  p_monto          NUMERIC,
  p_tipo_pago      public.tipo_pago DEFAULT 'efectivo',
  p_comprobante_id UUID DEFAULT NULL,
  p_referencia     TEXT DEFAULT NULL,
  p_notas          TEXT DEFAULT NULL,
  p_usuario_id     UUID DEFAULT NULL,
  p_fecha          DATE DEFAULT NULL
)
RETURNS public.pago
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cuenta public.cuenta_corriente;
  v_pago   public.pago;
  v_fecha  DATE := COALESCE(p_fecha, CURRENT_DATE);
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  INSERT INTO public.cuenta_corriente (tenant_id, cliente_id, proveedor_id, saldo, tipo_cuenta)
  VALUES (p_tenant_id, NULL, p_proveedor_id, 0, 'proveedor')
  ON CONFLICT (tenant_id, proveedor_id) WHERE proveedor_id IS NOT NULL
  DO NOTHING;

  SELECT * INTO v_cuenta
  FROM public.cuenta_corriente
  WHERE tenant_id = p_tenant_id AND proveedor_id = p_proveedor_id
  FOR UPDATE;

  IF v_cuenta IS NULL OR v_cuenta.proveedor_id IS NULL THEN
    RAISE EXCEPTION 'Cuenta corriente de proveedor no encontrada';
  END IF;

  UPDATE public.cuenta_corriente
  SET saldo = saldo - p_monto
  WHERE id = v_cuenta.id;

  INSERT INTO public.pago (
    tenant_id,
    cliente_id,
    proveedor_id,
    cuenta_id,
    comprobante_id,
    monto,
    tipo_pago,
    referencia,
    notas,
    usuario_id,
    fecha
  ) VALUES (
    p_tenant_id,
    NULL,
    p_proveedor_id,
    v_cuenta.id,
    p_comprobante_id,
    p_monto,
    p_tipo_pago,
    p_referencia,
    p_notas,
    p_usuario_id,
    v_fecha
  )
  RETURNING * INTO v_pago;

  RETURN v_pago;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_pago_cuenta_proveedor(
  UUID, UUID, NUMERIC, public.tipo_pago, UUID, TEXT, TEXT, UUID, DATE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pago_cuenta_proveedor(
  UUID, UUID, NUMERIC, public.tipo_pago, UUID, TEXT, TEXT, UUID, DATE
) TO authenticated, service_role;

-- ═══ Tablas: pago_proveedor_* ═══

CREATE TABLE public.pago_proveedor_factura (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  comprobante_id            UUID NOT NULL REFERENCES public.comprobante (id) ON DELETE CASCADE,
  proveedor_id              UUID NOT NULL REFERENCES public.proveedor (id) ON DELETE CASCADE,
  monto_original            NUMERIC(18, 6) NOT NULL
    CONSTRAINT chk_ppf_monto_pos CHECK (monto_original > 0),
  saldo_pendiente           NUMERIC(18, 6) NOT NULL
    CONSTRAINT chk_ppf_saldo_no_neg CHECK (saldo_pendiente >= 0),
  vencimiento_at            TIMESTAMPTZ NOT NULL,
  condicion_pago            TEXT NOT NULL
    CONSTRAINT chk_ppf_cond CHECK (condicion_pago IN ('contado', 'dias', 'fecha_fija')),
  estado                    TEXT NOT NULL DEFAULT 'pendiente'
    CONSTRAINT chk_ppf_estado CHECK (estado IN ('pendiente', 'parcial', 'pagada', 'anulada')),
  recordatorio_snooze_until TIMESTAMPTZ NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_pago_proveedor_fact_comprobante UNIQUE (tenant_id, comprobante_id),
  CONSTRAINT chk_ppf_saldo_monto CHECK (saldo_pendiente <= monto_original)
);

CREATE INDEX idx_pago_proveedor_fact_tenant_estado
  ON public.pago_proveedor_factura (tenant_id, estado);

CREATE INDEX idx_pago_proveedor_fact_tenant_proveedor
  ON public.pago_proveedor_factura (tenant_id, proveedor_id);

CREATE INDEX idx_pago_proveedor_fact_tenant_venc
  ON public.pago_proveedor_factura (tenant_id, vencimiento_at);

CREATE TRIGGER set_pago_proveedor_factura_updated_at
  BEFORE UPDATE ON public.pago_proveedor_factura
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

CREATE TABLE public.pago_proveedor_movimiento (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  pago_proveedor_factura_id UUID NOT NULL
    REFERENCES public.pago_proveedor_factura (id) ON DELETE CASCADE,
  monto                     NUMERIC(18, 6) NOT NULL
    CONSTRAINT chk_ppm_monto_pos CHECK (monto > 0),
  tipo_pago                 public.tipo_pago NOT NULL DEFAULT 'efectivo',
  fecha                     DATE NOT NULL DEFAULT CURRENT_DATE,
  usuario_id                UUID REFERENCES public.usuario (id) ON DELETE SET NULL,
  notas                     TEXT,
  recibo_comprobante_id     UUID REFERENCES public.comprobante (id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pago_proveedor_mov_tenant
  ON public.pago_proveedor_movimiento (tenant_id);

CREATE INDEX idx_pago_proveedor_mov_fact
  ON public.pago_proveedor_movimiento (pago_proveedor_factura_id);

-- RLS
ALTER TABLE public.pago_proveedor_factura ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_pago_proveedor_factura
  ON public.pago_proveedor_factura FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_pago_proveedor_factura
  ON public.pago_proveedor_factura FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_pago_proveedor_factura
  ON public.pago_proveedor_factura FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_pago_proveedor_factura
  ON public.pago_proveedor_factura FOR DELETE
  USING (tenant_id = public.current_tenant_id());

ALTER TABLE public.pago_proveedor_movimiento ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_pago_proveedor_mov
  ON public.pago_proveedor_movimiento FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_pago_proveedor_mov
  ON public.pago_proveedor_movimiento FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_pago_proveedor_mov
  ON public.pago_proveedor_movimiento FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_pago_proveedor_mov
  ON public.pago_proveedor_movimiento FOR DELETE
  USING (tenant_id = public.current_tenant_id());

-- ═══ RPC: registrar pago a proveedor (atómico + CC) ═══

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(
  p_pago_proveedor_factura_id UUID,
  p_monto                     NUMERIC,
  p_tipo_pago                 public.tipo_pago DEFAULT 'efectivo',
  p_notas                     TEXT DEFAULT NULL,
  p_usuario_id                UUID DEFAULT NULL,
  p_fecha                     DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant  UUID := public.current_tenant_id();
  v_row     public.pago_proveedor_factura%ROWTYPE;
  v_new     NUMERIC(18, 6);
  v_new_ven TIMESTAMPTZ;
  v_pago_m  UUID;
  v_pago_cc public.pago;
  v_fecha   DATE := COALESCE(p_fecha, CURRENT_DATE);
  v_nuevo   TEXT;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sin tenant en el token';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  SELECT * INTO v_row
  FROM public.pago_proveedor_factura
  WHERE id = p_pago_proveedor_factura_id
    AND tenant_id = v_tenant
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Obligación a proveedor no encontrada';
  END IF;

  IF v_row.estado = 'anulada' THEN
    RAISE EXCEPTION 'Obligación anulada';
  END IF;

  IF p_monto > v_row.saldo_pendiente THEN
    RAISE EXCEPTION 'El monto supera el saldo pendiente';
  END IF;

  v_new := v_row.saldo_pendiente - p_monto;

  IF v_new > 0 THEN
    v_new_ven := now() + interval '7 days';
  ELSE
    v_new_ven := v_row.vencimiento_at;
  END IF;

  IF v_new = 0 THEN
    v_nuevo := 'pagada';
  ELSIF v_new < v_row.monto_original THEN
    v_nuevo := 'parcial';
  ELSE
    v_nuevo := 'pendiente';
  END IF;

  UPDATE public.pago_proveedor_factura
  SET
    saldo_pendiente = v_new,
    vencimiento_at = v_new_ven,
    estado = v_nuevo,
    recordatorio_snooze_until = NULL,
    updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.pago_proveedor_movimiento (
    tenant_id,
    pago_proveedor_factura_id,
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
    v_fecha,
    p_usuario_id,
    p_notas
  )
  RETURNING id INTO v_pago_m;

  v_pago_cc := public.registrar_pago_cuenta_proveedor(
    v_tenant,
    v_row.proveedor_id,
    p_monto,
    p_tipo_pago,
    v_row.comprobante_id,
    NULL,
    p_notas,
    p_usuario_id,
    v_fecha
  );

  RETURN jsonb_build_object(
    'pago_proveedor_movimiento_id', v_pago_m,
    'nuevo_saldo', v_new,
    'pago_cuenta_corriente_id', v_pago_cc.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_pago_proveedor(
  UUID, NUMERIC, public.tipo_pago, TEXT, UUID, DATE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pago_proveedor(
  UUID, NUMERIC, public.tipo_pago, TEXT, UUID, DATE
) TO authenticated, service_role;

COMMENT ON TABLE public.pago_proveedor_factura IS
  'Obligación de pago asociada a comprobante de compra: saldo, vencimiento, estado.';
COMMENT ON FUNCTION public.registrar_pago_proveedor IS
  'Pago a proveedor: movimiento, actualiza pago_proveedor_factura y baja deuda (registrar_pago_cuenta_proveedor).';

-- ═══ Rollback (ejecutar a mano si hace falta) ═══
-- DROP FUNCTION IF EXISTS public.registrar_pago_proveedor(UUID, NUMERIC, public.tipo_pago, TEXT, UUID, DATE);
-- DROP FUNCTION IF EXISTS public.registrar_pago_cuenta_proveedor(UUID, UUID, NUMERIC, public.tipo_pago, UUID, TEXT, TEXT, UUID, DATE);
-- DROP TABLE IF EXISTS public.pago_proveedor_movimiento;
-- DROP TABLE IF EXISTS public.pago_proveedor_factura;
-- ALTER TABLE public.pago DROP CONSTRAINT IF EXISTS chk_pago_cliente_x_proveedor; DROP INDEX IF EXISTS idx_pago_tenant_proveedor; ALTER TABLE public.pago DROP COLUMN IF EXISTS proveedor_id; (recreamos NOT NULL en cliente con cuidado)
-- ALTER TABLE public.proveedor DROP CONSTRAINT chk_proveedor_plazo_pago, DROP CONSTRAINT chk_proveedor_condicion_plazo; ALTER TABLE public.proveedor DROP COLUMN IF EXISTS plazo_pago_dias, DROP COLUMN IF EXISTS condicion_pago_default;
