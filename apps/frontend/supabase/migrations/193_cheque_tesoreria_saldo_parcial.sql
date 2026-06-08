-- Cheques en tesorería: saldo consumible en varios pagos a proveedores.

CREATE OR REPLACE FUNCTION public.saldo_disponible_cheque_tesoreria(p_cheque_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    c.monto - COALESCE(
      (
        SELECT SUM(
          CASE WHEN m.es_ingreso THEN -m.monto ELSE m.monto END
        )
        FROM public.caja_tesoreria_movimiento m
        WHERE m.cheque_id = p_cheque_id
          AND m.tipo IN ('egreso_cheque', 'ajuste')
      ),
      0
    ),
    0
  )
  FROM public.caja_tesoreria_cheque c
  WHERE c.id = p_cheque_id;
$$;

COMMENT ON FUNCTION public.saldo_disponible_cheque_tesoreria(UUID) IS
  'Saldo restante de un cheque en cartera (monto nominal menos egresos netos).';

CREATE OR REPLACE FUNCTION public.cambiar_estado_cheque_tesoreria(
  p_tenant_id UUID,
  p_cheque_id UUID,
  p_estado public.caja_tesoreria_cheque_estado,
  p_notas TEXT DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL
)
RETURNS public.caja_tesoreria_cheque
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cheque public.caja_tesoreria_cheque;
  v_saldo NUMERIC;
BEGIN
  IF p_estado NOT IN ('depositado', 'rechazado') THEN
    RAISE EXCEPTION 'Solo se puede cambiar a depositado o rechazado desde este RPC';
  END IF;

  SELECT * INTO v_cheque
  FROM public.caja_tesoreria_cheque
  WHERE id = p_cheque_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_cheque IS NULL THEN
    RAISE EXCEPTION 'Cheque no encontrado';
  END IF;

  IF v_cheque.estado <> 'en_cartera' THEN
    RAISE EXCEPTION 'Solo se puede cambiar el estado de cheques en cartera';
  END IF;

  v_saldo := public.saldo_disponible_cheque_tesoreria(p_cheque_id);
  IF v_saldo + 0.01 < v_cheque.monto THEN
    RAISE EXCEPTION 'No se puede depositar o rechazar un cheque con pagos imputados';
  END IF;

  UPDATE public.caja_tesoreria_cheque
  SET
    estado = p_estado,
    notas = COALESCE(p_notas, notas),
    updated_at = now()
  WHERE id = p_cheque_id
  RETURNING * INTO v_cheque;

  RETURN v_cheque;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor_tesoreria(
  p_tenant_id UUID,
  p_caja_tesoreria_id UUID,
  p_proveedor_id UUID,
  p_monto NUMERIC,
  p_tipo_pago public.tipo_pago DEFAULT 'efectivo',
  p_cheque_id UUID DEFAULT NULL,
  p_pago_proveedor_factura_id UUID DEFAULT NULL,
  p_notas TEXT DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL,
  p_fecha DATE DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja public.caja_tesoreria;
  v_saldo NUMERIC;
  v_cheque public.caja_tesoreria_cheque;
  v_pago_result jsonb;
  v_pago_id UUID;
  v_mov public.caja_tesoreria_movimiento;
  v_fecha DATE := COALESCE(p_fecha, CURRENT_DATE);
  v_tipo_mov public.caja_tesoreria_movimiento_tipo;
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;

  SELECT * INTO v_caja
  FROM public.caja_tesoreria
  WHERE id = p_caja_tesoreria_id AND tenant_id = p_tenant_id AND activa = true;

  IF v_caja IS NULL THEN
    RAISE EXCEPTION 'Caja de tesorería no encontrada o inactiva';
  END IF;

  IF p_tipo_pago = 'efectivo' THEN
    v_saldo := public.saldo_efectivo_caja_tesoreria(p_caja_tesoreria_id);
    IF v_saldo + 0.000001 < p_monto THEN
      RAISE EXCEPTION 'Saldo de efectivo insuficiente en tesorería (disponible: %)', v_saldo;
    END IF;
    v_tipo_mov := 'pago_proveedor';
  ELSIF p_tipo_pago = 'cheque' THEN
    IF p_cheque_id IS NULL THEN
      RAISE EXCEPTION 'Debe indicar el cheque a utilizar';
    END IF;
    SELECT * INTO v_cheque
    FROM public.caja_tesoreria_cheque
    WHERE id = p_cheque_id
      AND tenant_id = p_tenant_id
      AND caja_tesoreria_id = p_caja_tesoreria_id
    FOR UPDATE;

    IF v_cheque IS NULL THEN
      RAISE EXCEPTION 'Cheque no encontrado en esta tesorería';
    END IF;
    IF v_cheque.estado <> 'en_cartera' THEN
      RAISE EXCEPTION 'El cheque no está disponible en cartera';
    END IF;

    v_saldo := public.saldo_disponible_cheque_tesoreria(p_cheque_id);
    IF p_monto > v_saldo + 0.01 THEN
      RAISE EXCEPTION 'Saldo del cheque insuficiente (disponible: %)', v_saldo;
    END IF;
    v_tipo_mov := 'egreso_cheque';
  ELSE
    RAISE EXCEPTION 'Solo se admiten pagos en efectivo o cheque desde tesorería';
  END IF;

  IF p_pago_proveedor_factura_id IS NOT NULL THEN
    v_pago_result := public.registrar_pago_proveedor(
      p_pago_proveedor_factura_id,
      p_monto,
      p_tipo_pago,
      p_notas,
      p_usuario_id,
      v_fecha
    );
    v_pago_id := (v_pago_result->>'pago_cuenta_corriente_id')::UUID;
  ELSE
    v_pago_id := (
      public.registrar_pago_cuenta_proveedor(
        p_tenant_id,
        p_proveedor_id,
        p_monto,
        p_tipo_pago,
        NULL,
        NULL,
        p_notas,
        p_usuario_id,
        v_fecha
      )
    ).id;
  END IF;

  INSERT INTO public.caja_tesoreria_movimiento (
    tenant_id,
    caja_tesoreria_id,
    tipo,
    monto,
    es_ingreso,
    pago_id,
    cheque_id,
    proveedor_id,
    notas,
    usuario_id,
    fecha
  ) VALUES (
    p_tenant_id,
    p_caja_tesoreria_id,
    v_tipo_mov,
    p_monto,
    false,
    v_pago_id,
    p_cheque_id,
    p_proveedor_id,
    p_notas,
    p_usuario_id,
    v_fecha
  )
  RETURNING * INTO v_mov;

  IF p_tipo_pago = 'cheque' AND p_cheque_id IS NOT NULL THEN
    v_saldo := public.saldo_disponible_cheque_tesoreria(p_cheque_id);
    IF v_saldo <= 0.01 THEN
      UPDATE public.caja_tesoreria_cheque
      SET
        estado = 'entregado',
        movimiento_egreso_id = v_mov.id,
        pago_id = v_pago_id,
        updated_at = now()
      WHERE id = p_cheque_id;
    ELSE
      UPDATE public.caja_tesoreria_cheque
      SET updated_at = now()
      WHERE id = p_cheque_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'movimiento_id', v_mov.id,
    'pago_id', v_pago_id,
    'pago_proveedor', v_pago_result,
    'saldo_cheque_restante', CASE WHEN p_cheque_id IS NOT NULL THEN v_saldo ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revertir_movimiento_tesoreria_por_pago(
  p_tenant_id UUID,
  p_pago_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov public.caja_tesoreria_movimiento;
  v_cheque public.caja_tesoreria_cheque;
  v_comp public.caja_tesoreria_movimiento;
  v_comp_id UUID := NULL;
BEGIN
  SELECT * INTO v_mov
  FROM public.caja_tesoreria_movimiento
  WHERE tenant_id = p_tenant_id
    AND pago_id = p_pago_id
    AND es_ingreso = false
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_mov IS NULL THEN
    RETURN jsonb_build_object('revertido', false, 'motivo', 'sin_movimiento_tesoreria');
  END IF;

  IF v_mov.cheque_id IS NOT NULL THEN
    SELECT * INTO v_cheque
    FROM public.caja_tesoreria_cheque
    WHERE id = v_mov.cheque_id AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF v_cheque IS NULL THEN
      RAISE EXCEPTION 'Cheque asociado no encontrado';
    END IF;
    IF v_cheque.estado = 'depositado' THEN
      RAISE EXCEPTION 'No se puede revertir: el cheque ya fue depositado';
    END IF;

    IF v_mov.tipo = 'egreso_cheque' THEN
      INSERT INTO public.caja_tesoreria_movimiento (
        tenant_id,
        caja_tesoreria_id,
        tipo,
        monto,
        es_ingreso,
        pago_id,
        cheque_id,
        proveedor_id,
        notas,
        usuario_id,
        fecha
      ) VALUES (
        p_tenant_id,
        v_mov.caja_tesoreria_id,
        'ajuste',
        v_mov.monto,
        true,
        p_pago_id,
        v_mov.cheque_id,
        v_mov.proveedor_id,
        'Reversión de pago con cheque',
        v_mov.usuario_id,
        CURRENT_DATE
      )
      RETURNING * INTO v_comp;
      v_comp_id := v_comp.id;
    END IF;

    UPDATE public.caja_tesoreria_cheque
    SET
      estado = 'en_cartera',
      movimiento_egreso_id = NULL,
      pago_id = NULL,
      updated_at = now()
    WHERE id = v_cheque.id;
  ELSIF v_mov.tipo IN ('pago_proveedor', 'egreso_efectivo') THEN
    INSERT INTO public.caja_tesoreria_movimiento (
      tenant_id,
      caja_tesoreria_id,
      tipo,
      monto,
      es_ingreso,
      pago_id,
      proveedor_id,
      notas,
      usuario_id,
      fecha
    ) VALUES (
      p_tenant_id,
      v_mov.caja_tesoreria_id,
      'ajuste',
      v_mov.monto,
      true,
      p_pago_id,
      v_mov.proveedor_id,
      'Reversión de pago a proveedor',
      v_mov.usuario_id,
      CURRENT_DATE
    )
    RETURNING * INTO v_comp;
    v_comp_id := v_comp.id;
  END IF;

  RETURN jsonb_build_object(
    'revertido', true,
    'movimiento_id', v_mov.id,
    'compensacion_id', v_comp_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.saldo_disponible_cheque_tesoreria(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.saldo_disponible_cheque_tesoreria(UUID)
  TO authenticated, service_role;
