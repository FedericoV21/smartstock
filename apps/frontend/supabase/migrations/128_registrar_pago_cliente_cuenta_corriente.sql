-- Pagos desde panel de cuenta corriente cliente: si existe cobranza por factura,
-- distribuye FIFO por vencimiento dentro de una misma transacción; el sobrante va
-- a registrar_pago "libre" (comprobante_id NULL).

CREATE OR REPLACE FUNCTION public.registrar_pago_cliente_desde_cuenta_corriente(
  p_cliente_id UUID,
  p_monto NUMERIC,
  p_tipo_pago public.tipo_pago DEFAULT 'efectivo'::public.tipo_pago,
  p_referencia TEXT DEFAULT NULL,
  p_notas TEXT DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_tenant               UUID := public.current_tenant_id();
  v_facturador_simple    BOOLEAN;
  v_remaining            NUMERIC(18, 6) := p_monto;
  r_cob                  RECORD;
  v_chunk                NUMERIC(18, 6);
  v_monto_minimo         NUMERIC(18, 6) := 0;
  v_aplicados            INT := 0;
  v_tail_pago_cob_cc_id  UUID;
  v_rb                   JSONB;
  v_pago_libre           public.pago;
  v_monto_sin_factura    NUMERIC(18, 6) := 0;
  v_pago_id_result       UUID;
  v_tol                  NUMERIC := 0.01;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sin tenant en el token';
  END IF;

  IF p_cliente_id IS NULL OR p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'cliente_id y monto (> 0) son requeridos';
  END IF;

  SELECT COALESCE(
    (
      SELECT mc.facturador_simple
      FROM public.modulo_config mc
      WHERE mc.tenant_id = v_tenant
      LIMIT 1
    ),
    false
  )
  INTO v_facturador_simple;

  IF NOT v_facturador_simple THEN
    v_pago_libre := public.registrar_pago(
      v_tenant,
      p_cliente_id,
      v_remaining,
      p_tipo_pago,
      NULL,
      p_referencia,
      p_notas,
      p_usuario_id
    );

    RETURN jsonb_build_object(
      'modo', 'cuenta_directa',
      'facturador_simple', false,
      'cobranzas_aplicadas', 0,
      'monto_sin_factura', v_remaining,
      'pago_id', v_pago_libre.id
    );
  END IF;

  SELECT COALESCE(cc.cobro_monto_minimo, 0)
  INTO v_monto_minimo
  FROM public.cuenta_corriente cc
  WHERE cc.tenant_id = v_tenant
    AND cc.cliente_id = p_cliente_id
  LIMIT 1;

  IF v_monto_minimo IS NULL THEN
    v_monto_minimo := 0;
  END IF;

  FOR r_cob IN
    SELECT id, saldo_pendiente, vencimiento_at
    FROM public.cobranza_factura
    WHERE tenant_id = v_tenant
      AND cliente_id = p_cliente_id
      AND saldo_pendiente > v_tol
    ORDER BY vencimiento_at ASC NULLS LAST, created_at ASC
  LOOP
    EXIT WHEN v_remaining <= v_tol;

    v_chunk := LEAST(v_remaining, r_cob.saldo_pendiente);

    IF v_monto_minimo > 0 AND v_chunk + v_tol < r_cob.saldo_pendiente AND v_chunk + v_tol < v_monto_minimo THEN
      RAISE EXCEPTION
        USING MESSAGE = format(
          'El monto mínimo acordado en cuenta corriente es %s salvo liquidar el saldo de la obligación.',
          v_monto_minimo
        );
    END IF;

    v_rb := public.registrar_pago_cobranza(
      r_cob.id,
      v_chunk,
      p_tipo_pago,
      CASE WHEN v_aplicados = 0 THEN p_notas ELSE NULL END,
      p_usuario_id
    );

    v_tail_pago_cob_cc_id := (v_rb ->> 'pago_cuenta_corriente_id')::uuid;

    v_aplicados := v_aplicados + 1;
    v_remaining := v_remaining - v_chunk;
  END LOOP;

  IF v_remaining > v_tol THEN
    v_monto_sin_factura := v_remaining;

    v_pago_libre := public.registrar_pago(
      v_tenant,
      p_cliente_id,
      v_remaining,
      p_tipo_pago,
      NULL,
      p_referencia,
      p_notas,
      p_usuario_id
    );

    v_pago_id_result := v_pago_libre.id;
  ELSE
    v_monto_sin_factura := 0;
    v_pago_id_result := v_tail_pago_cob_cc_id;
  END IF;

  RETURN jsonb_build_object(
    'modo', 'distribuido',
    'facturador_simple', true,
    'cobranzas_aplicadas', v_aplicados,
    'monto_sin_factura', v_monto_sin_factura,
    'pago_id', v_pago_id_result
  );
END;
$$;

ALTER FUNCTION public.registrar_pago_cliente_desde_cuenta_corriente(UUID, NUMERIC, public.tipo_pago, TEXT, TEXT, UUID)
  OWNER TO postgres;

COMMENT ON FUNCTION public.registrar_pago_cliente_desde_cuenta_corriente IS
  'Pago cliente desde cuenta corriente UI: si facturador_simple, aplica contra cobranza_factura (FIFO por vencimiento) y registra saldo libre si sobra (comprobante_id NULL en pago).';

REVOKE ALL ON FUNCTION public.registrar_pago_cliente_desde_cuenta_corriente(UUID, NUMERIC, public.tipo_pago, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pago_cliente_desde_cuenta_corriente(UUID, NUMERIC, public.tipo_pago, TEXT, TEXT, UUID)
  TO authenticated, service_role;
