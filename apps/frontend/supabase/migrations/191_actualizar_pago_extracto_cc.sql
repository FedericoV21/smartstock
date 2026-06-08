-- Edición de pagos de cliente desde extracto de cuenta corriente (ajuste de saldo CC y cobranza vinculada).

CREATE OR REPLACE FUNCTION public.actualizar_pago_cliente_extracto(
  p_pago_id UUID,
  p_monto NUMERIC,
  p_fecha DATE,
  p_tipo_pago public.tipo_pago DEFAULT 'efectivo'::public.tipo_pago,
  p_referencia TEXT DEFAULT NULL,
  p_notas TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_tenant       UUID := public.current_tenant_id();
  v_pago         public.pago%ROWTYPE;
  v_delta        NUMERIC(18, 6);
  v_cob          public.cobranza_factura%ROWTYPE;
  v_new_pend     NUMERIC(18, 6);
  v_cob_pago_id  UUID;
  v_tol          NUMERIC := 0.01;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sin tenant en el token';
  END IF;

  IF p_pago_id IS NULL OR p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'pago_id y monto (> 0) son requeridos';
  END IF;

  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'La fecha es requerida';
  END IF;

  SELECT * INTO v_pago
  FROM public.pago
  WHERE id = p_pago_id
    AND tenant_id = v_tenant
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago no encontrado';
  END IF;

  IF v_pago.proveedor_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este pago no es de un cliente';
  END IF;

  v_delta := p_monto - v_pago.monto;

  IF v_pago.comprobante_id IS NOT NULL AND ABS(v_delta) > v_tol THEN
    SELECT * INTO v_cob
    FROM public.cobranza_factura
    WHERE tenant_id = v_tenant
      AND comprobante_id = v_pago.comprobante_id
    FOR UPDATE;

    IF FOUND THEN
      v_new_pend := v_cob.saldo_pendiente - v_delta;
      IF v_new_pend < -v_tol THEN
        RAISE EXCEPTION 'El nuevo monto dejaría saldo pendiente negativo en la factura';
      END IF;
      IF v_new_pend > v_cob.monto_original + v_tol THEN
        RAISE EXCEPTION 'El nuevo monto supera el total de la factura';
      END IF;

      UPDATE public.cobranza_factura
      SET
        saldo_pendiente = GREATEST(0, v_new_pend),
        updated_at = now()
      WHERE id = v_cob.id;

      SELECT cp.id INTO v_cob_pago_id
      FROM public.cobranza_pago cp
      WHERE cp.tenant_id = v_tenant
        AND cp.cobranza_factura_id = v_cob.id
        AND cp.fecha = v_pago.fecha
        AND ABS(cp.monto - v_pago.monto) <= v_tol
      ORDER BY cp.created_at DESC
      LIMIT 1;

      IF v_cob_pago_id IS NOT NULL THEN
        UPDATE public.cobranza_pago
        SET
          monto = p_monto,
          tipo_pago = p_tipo_pago,
          fecha = p_fecha,
          notas = p_notas
        WHERE id = v_cob_pago_id;
      END IF;
    END IF;
  END IF;

  IF ABS(v_delta) > v_tol AND v_pago.cuenta_id IS NOT NULL THEN
    UPDATE public.cuenta_corriente
    SET saldo = saldo - v_delta
    WHERE id = v_pago.cuenta_id
      AND tenant_id = v_tenant;
  END IF;

  UPDATE public.pago
  SET
    monto = p_monto,
    fecha = p_fecha,
    tipo_pago = p_tipo_pago,
    referencia = NULLIF(TRIM(p_referencia), ''),
    notas = NULLIF(TRIM(p_notas), '')
  WHERE id = p_pago_id;

  RETURN jsonb_build_object(
    'ok', true,
    'pago_id', p_pago_id,
    'delta', v_delta
  );
END;
$$;

COMMENT ON FUNCTION public.actualizar_pago_cliente_extracto IS
  'Actualiza un pago de cliente y ajusta saldo de cuenta corriente; si el pago está ligado a una factura con cobranza, sincroniza saldo pendiente y cobranza_pago cuando hay match.';

REVOKE ALL ON FUNCTION public.actualizar_pago_cliente_extracto(UUID, NUMERIC, DATE, public.tipo_pago, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_pago_cliente_extracto(UUID, NUMERIC, DATE, public.tipo_pago, TEXT, TEXT)
  TO authenticated, service_role;
