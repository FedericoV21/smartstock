-- Transferencia de stock entre sucursales del mismo tenant (un registro de salida + uno de entrada vinculados).

ALTER TYPE public.referencia_tipo ADD VALUE IF NOT EXISTS 'transferencia_sucursal';

CREATE OR REPLACE FUNCTION public.transferir_stock_entre_sucursales(
  p_tenant_id           UUID,
  p_producto_origen_id  UUID,
  p_producto_destino_id UUID,
  p_cantidad            NUMERIC(12, 3),
  p_motivo              TEXT DEFAULT NULL,
  p_usuario_id          UUID DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lo   UUID;
  v_hi   UUID;
  r_lo   producto%ROWTYPE;
  r_hi   producto%ROWTYPE;
  r_o    producto%ROWTYPE;
  r_d    producto%ROWTYPE;
  v_o_cb TEXT;
  v_d_cb TEXT;
  m_sal  movimiento;
  m_ent  movimiento;
  v_xfer UUID;
  n_o    TEXT;
  n_d    TEXT;
  v_mot_sal TEXT;
  v_mot_ent TEXT;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a cero';
  END IF;

  IF p_producto_origen_id = p_producto_destino_id THEN
    RAISE EXCEPTION 'Origen y destino deben ser productos distintos';
  END IF;

  v_lo := LEAST(p_producto_origen_id, p_producto_destino_id);
  v_hi := GREATEST(p_producto_origen_id, p_producto_destino_id);

  SELECT * INTO STRICT r_lo
  FROM public.producto
  WHERE id = v_lo AND tenant_id = p_tenant_id
  FOR UPDATE;

  SELECT * INTO STRICT r_hi
  FROM public.producto
  WHERE id = v_hi AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF r_lo.id = p_producto_origen_id THEN
    r_o := r_lo;
  ELSE
    r_o := r_hi;
  END IF;

  IF r_lo.id = p_producto_destino_id THEN
    r_d := r_lo;
  ELSE
    r_d := r_hi;
  END IF;

  IF r_o.sucursal_id = r_d.sucursal_id THEN
    RAISE EXCEPTION 'El producto de origen y el de destino deben ser de sucursales distintas';
  END IF;

  IF NOT r_o.activo OR NOT r_d.activo THEN
    RAISE EXCEPTION 'Ambos productos deben estar activos para transferir stock';
  END IF;

  IF lower(btrim(r_o.codigo)) IS DISTINCT FROM lower(btrim(r_d.codigo))
     OR r_o.unidad IS DISTINCT FROM r_d.unidad THEN
    RAISE EXCEPTION 'Los productos no coinciden (código y unidad deben ser iguales entre sucursales)';
  END IF;

  v_o_cb := NULLIF(btrim(COALESCE(r_o.codigo_barras, '')), '');
  v_d_cb := NULLIF(btrim(COALESCE(r_d.codigo_barras, '')), '');

  IF (v_o_cb IS NULL AND v_d_cb IS NOT NULL) OR (v_o_cb IS NOT NULL AND v_d_cb IS NULL) THEN
    RAISE EXCEPTION 'Inconsistencia de código de barras entre sucursales (ambos vacíos o el mismo valor)';
  END IF;

  IF v_o_cb IS NOT NULL AND v_d_cb IS NOT NULL AND lower(v_o_cb) IS DISTINCT FROM lower(v_d_cb) THEN
    RAISE EXCEPTION 'El código de barras no coincide entre las sucursales';
  END IF;

  IF r_o.stock_actual < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente en origen. Actual: %, solicitado: %', r_o.stock_actual, p_cantidad;
  END IF;

  SELECT s.nombre INTO n_o FROM public.sucursal s WHERE s.id = r_o.sucursal_id;
  SELECT s.nombre INTO n_d FROM public.sucursal s WHERE s.id = r_d.sucursal_id;

  v_xfer := gen_random_uuid();

  v_mot_sal := 'Transferencia a ' || COALESCE(n_d, '(sucursal)')
    || COALESCE(' — ' || NULLIF(btrim(COALESCE(p_motivo, '')), ''), '');
  v_mot_ent := 'Transferencia desde ' || COALESCE(n_o, '(sucursal)')
    || COALESCE(' — ' || NULLIF(btrim(COALESCE(p_motivo, '')), ''), '');

  SELECT * INTO m_sal FROM public.registrar_movimiento(
    p_tenant_id,
    p_producto_origen_id,
    'salida'::public.tipo_movimiento,
    p_cantidad,
    v_mot_sal,
    'transferencia_sucursal'::public.referencia_tipo,
    v_xfer,
    p_usuario_id,
    false
  );

  SELECT * INTO m_ent FROM public.registrar_movimiento(
    p_tenant_id,
    p_producto_destino_id,
    'entrada'::public.tipo_movimiento,
    p_cantidad,
    v_mot_ent,
    'transferencia_sucursal'::public.referencia_tipo,
    v_xfer,
    p_usuario_id,
    false
  );

  RETURN jsonb_build_object(
    'transfer_id', v_xfer,
    'movimiento_salida', to_jsonb(m_sal),
    'movimiento_entrada', to_jsonb(m_ent)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transferir_stock_entre_sucursales(
  uuid, uuid, uuid, numeric, text, uuid
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
