-- Permite sobrepagos en cuenta corriente:
-- - clientes: excedente como saldo a favor del cliente (saldo negativo)
-- - proveedores: excedente como saldo a favor del tenant (saldo negativo)

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
  v_monto_aplicado NUMERIC(18, 6);
  v_saldo_a_favor NUMERIC(18, 6);
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

  v_monto_aplicado := LEAST(p_monto, GREATEST(v_row.saldo_pendiente, 0));
  v_saldo_a_favor := p_monto - v_monto_aplicado;
  v_new_saldo := GREATEST(v_row.saldo_pendiente - v_monto_aplicado, 0);

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
    'monto_aplicado', v_monto_aplicado,
    'saldo_a_favor_generado', v_saldo_a_favor,
    'pago_cuenta_corriente_id', v_pago_cc.id
  );
END;
$$;

ALTER FUNCTION public.registrar_pago_cobranza(UUID, NUMERIC, public.tipo_pago, TEXT, UUID)
  OWNER TO postgres;

COMMENT ON FUNCTION public.registrar_pago_cobranza(UUID, NUMERIC, public.tipo_pago, TEXT, UUID) IS
  'Registra cobro parcial/total o sobrepago: actualiza saldo, inserta cobranza_pago y el excedente queda como saldo a favor del cliente.';

REVOKE ALL ON FUNCTION public.registrar_pago_cobranza(UUID, NUMERIC, public.tipo_pago, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pago_cobranza(UUID, NUMERIC, public.tipo_pago, TEXT, UUID)
  TO authenticated, service_role;

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
  v_monto_aplicado NUMERIC(18, 6);
  v_saldo_a_favor NUMERIC(18, 6);
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
    RAISE EXCEPTION 'Obligacion a proveedor no encontrada';
  END IF;

  IF v_row.estado = 'anulada' THEN
    RAISE EXCEPTION 'Obligacion anulada';
  END IF;

  v_monto_aplicado := LEAST(p_monto, GREATEST(v_row.saldo_pendiente, 0));
  v_saldo_a_favor := p_monto - v_monto_aplicado;
  v_new := GREATEST(v_row.saldo_pendiente - v_monto_aplicado, 0);

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
    'monto_aplicado', v_monto_aplicado,
    'saldo_a_favor_generado', v_saldo_a_favor,
    'pago_cuenta_corriente_id', v_pago_cc.id
  );
END;
$$;

ALTER FUNCTION public.registrar_pago_proveedor(UUID, NUMERIC, public.tipo_pago, TEXT, UUID, DATE)
  OWNER TO postgres;

COMMENT ON FUNCTION public.registrar_pago_proveedor(UUID, NUMERIC, public.tipo_pago, TEXT, UUID, DATE) IS
  'Pago a proveedor: actualiza obligacion, baja cuenta corriente y permite excedente como saldo a favor del tenant.';

REVOKE ALL ON FUNCTION public.registrar_pago_proveedor(UUID, NUMERIC, public.tipo_pago, TEXT, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pago_proveedor(UUID, NUMERIC, public.tipo_pago, TEXT, UUID, DATE)
  TO authenticated, service_role;
