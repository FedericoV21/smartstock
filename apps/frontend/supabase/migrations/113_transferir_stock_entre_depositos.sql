-- Transferencia de stock entre depósitos/sucursales para el modelo de producto único.
-- Registra 2 movimientos (salida + entrada) sobre `stock_sucursal`, creando la fila del depósito destino si falta.

ALTER TYPE public.referencia_tipo ADD VALUE IF NOT EXISTS 'transferencia_sucursal';

CREATE OR REPLACE FUNCTION public.transferir_stock_entre_depositos(
  p_tenant_id            UUID,
  p_producto_id          UUID,
  p_sucursal_origen_id   UUID,
  p_sucursal_destino_id  UUID,
  p_cantidad             NUMERIC(12, 3),
  p_motivo               TEXT DEFAULT NULL,
  p_usuario_id           UUID DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_xfer UUID;
  m_sal public.movimiento;
  m_ent public.movimiento;
  n_o  TEXT;
  n_d  TEXT;
  v_mot_sal TEXT;
  v_mot_ent TEXT;
  v_dest_exists_before BOOLEAN;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a cero';
  END IF;

  IF p_sucursal_origen_id IS NULL OR p_sucursal_destino_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal de origen y destino son obligatorias';
  END IF;

  IF p_sucursal_origen_id = p_sucursal_destino_id THEN
    RAISE EXCEPTION 'Origen y destino deben ser sucursales distintas';
  END IF;

  -- Validar sucursales activas del tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.sucursal s
    WHERE s.id = p_sucursal_origen_id
      AND s.tenant_id = p_tenant_id
      AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal de origen no encontrada o inactiva';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sucursal s
    WHERE s.id = p_sucursal_destino_id
      AND s.tenant_id = p_tenant_id
      AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal de destino no encontrada o inactiva';
  END IF;

  -- Validar producto del tenant (lock para consistencia)
  PERFORM 1
  FROM public.producto p
  WHERE p.id = p_producto_id
    AND p.tenant_id = p_tenant_id
    AND p.activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o inactivo';
  END IF;

  -- Evitar condiciones de carrera si se transfieren simultáneamente los mismos pares
  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_tenant_id::text
      || p_producto_id::text
      || LEAST(p_sucursal_origen_id, p_sucursal_destino_id)::text
      || GREATEST(p_sucursal_origen_id, p_sucursal_destino_id)::text
    )
  );

  SELECT s.nombre INTO n_o FROM public.sucursal s WHERE s.id = p_sucursal_origen_id;
  SELECT s.nombre INTO n_d FROM public.sucursal s WHERE s.id = p_sucursal_destino_id;

  v_xfer := gen_random_uuid();

  v_mot_sal := 'Transferencia a ' || COALESCE(n_d, '(sucursal)')
    || COALESCE(' — ' || NULLIF(btrim(COALESCE(p_motivo, '')), ''), '');
  v_mot_ent := 'Transferencia desde ' || COALESCE(n_o, '(sucursal)')
    || COALESCE(' — ' || NULLIF(btrim(COALESCE(p_motivo, '')), ''), '');

  SELECT EXISTS (
    SELECT 1
    FROM public.stock_sucursal ss
    WHERE ss.tenant_id = p_tenant_id
      AND ss.producto_id = p_producto_id
      AND ss.sucursal_id = p_sucursal_destino_id
  ) INTO v_dest_exists_before;

  -- Salida del origen (si no existe fila de stock, se inicializa en 0 y fallará por insuficiente si corresponde)
  SELECT * INTO m_sal FROM public.registrar_movimiento(
    p_tenant_id,
    p_producto_id,
    p_sucursal_origen_id,
    'salida'::public.tipo_movimiento,
    p_cantidad,
    v_mot_sal,
    'transferencia_sucursal'::public.referencia_tipo,
    v_xfer,
    p_usuario_id,
    false
  );

  -- Entrada en destino (crea automáticamente la fila stock_sucursal si falta)
  SELECT * INTO m_ent FROM public.registrar_movimiento(
    p_tenant_id,
    p_producto_id,
    p_sucursal_destino_id,
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
    'movimiento_entrada', to_jsonb(m_ent),
    'deposito_destino_creado', NOT v_dest_exists_before
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transferir_stock_entre_depositos(
  uuid, uuid, uuid, uuid, numeric, text, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.transferir_stock_entre_depositos(
  uuid, uuid, uuid, uuid, numeric, text, uuid
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

