-- Reemplaza transferir_stock_entre_sucursales: permite operar sin producto de destino (se crea clon del origen en la sucursal de destino).

DROP FUNCTION IF EXISTS public.transferir_stock_entre_sucursales(
  uuid, uuid, uuid, numeric, text, uuid
);

CREATE OR REPLACE FUNCTION public.transferir_stock_entre_sucursales(
  p_tenant_id            UUID,
  p_producto_origen_id   UUID,
  p_sucursal_destino_id  UUID,
  p_cantidad             NUMERIC(12, 3),
  p_motivo               TEXT DEFAULT NULL,
  p_usuario_id           UUID DEFAULT NULL,
  p_producto_destino_id UUID DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_o_row        producto%ROWTYPE;
  v_d_id         UUID;
  v_d_row        producto%ROWTYPE;
  v_lo           UUID;
  v_hi           UUID;
  r_lo           producto%ROWTYPE;
  r_hi           producto%ROWTYPE;
  r_o            producto%ROWTYPE;
  r_d            producto%ROWTYPE;
  v_o_cb         TEXT;
  v_d_cb         TEXT;
  m_sal          movimiento;
  m_ent          movimiento;
  v_xfer         UUID;
  n_o            TEXT;
  n_d            TEXT;
  v_mot_sal      TEXT;
  v_mot_ent      TEXT;
  v_categoria_d  UUID;
  v_proveedor_d  UUID;
  v_count        INT;
  v_creado       BOOLEAN := false;
  v_suc_ok       BOOL;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a cero';
  END IF;

  SELECT * INTO v_o_row
  FROM public.producto
  WHERE id = p_producto_origen_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto de origen no encontrado';
  END IF;

  IF v_o_row.sucursal_id = p_sucursal_destino_id THEN
    RAISE EXCEPTION 'La sucursal de destino debe ser distinta a la de origen';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.sucursal s
    WHERE s.id = p_sucursal_destino_id
      AND s.tenant_id = p_tenant_id
      AND s.activa = true
  ) INTO v_suc_ok;

  IF NOT v_suc_ok THEN
    RAISE EXCEPTION 'Sucursal de destino no encontrada o inactiva';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_tenant_id::text
      || p_sucursal_destino_id::text
      || lower(btrim(v_o_row.codigo))
      || v_o_row.unidad::text
    )
  );

  v_d_id := p_producto_destino_id;

  IF v_d_id IS NOT NULL THEN
    SELECT * INTO v_d_row
    FROM public.producto
    WHERE id = v_d_id
      AND tenant_id = p_tenant_id
      AND sucursal_id = p_sucursal_destino_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto de destino no encontrado o no pertenece a la sucursal de destino';
    END IF;
  ELSE
    SELECT COUNT(*)::int INTO v_count
    FROM public.producto
    WHERE tenant_id = p_tenant_id
      AND sucursal_id = p_sucursal_destino_id
      AND activo = true
      AND lower(btrim(codigo)) = lower(btrim(v_o_row.codigo))
      AND unidad = v_o_row.unidad;

    IF v_count > 1 THEN
      RAISE EXCEPTION
        'Hay más de un producto con el mismo código y unidad en la sucursal de destino; unificá códigos o indicá el producto de destino explícitamente';
    END IF;

    IF v_count = 1 THEN
      SELECT id INTO v_d_id
      FROM public.producto
      WHERE tenant_id = p_tenant_id
        AND sucursal_id = p_sucursal_destino_id
        AND activo = true
        AND lower(btrim(codigo)) = lower(btrim(v_o_row.codigo))
        AND unidad = v_o_row.unidad
      LIMIT 1;
    END IF;

    IF v_d_id IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.producto
        WHERE tenant_id = p_tenant_id
          AND sucursal_id = p_sucursal_destino_id
          AND activo = false
          AND lower(btrim(codigo)) = lower(btrim(v_o_row.codigo))
          AND unidad = v_o_row.unidad
      ) THEN
        RAISE EXCEPTION
          'En destino ya existe un producto inactivo con el mismo código y unidad; reactivá o unificá duplicados antes de transferir';
      END IF;

      v_creado := true;

      v_categoria_d := NULL;
      IF v_o_row.categoria_id IS NOT NULL THEN
        SELECT c_dest.id INTO v_categoria_d
        FROM public.categoria c_o
        INNER JOIN public.categoria c_dest
          ON c_dest.tenant_id = c_o.tenant_id
          AND c_dest.sucursal_id = p_sucursal_destino_id
          AND c_dest.activa = true
          AND lower(c_dest.nombre) = lower(c_o.nombre)
        WHERE c_o.id = v_o_row.categoria_id
        LIMIT 1;
      END IF;

      v_proveedor_d := NULL;
      IF v_o_row.proveedor_id IS NOT NULL THEN
        SELECT p_dest.id INTO v_proveedor_d
        FROM public.proveedor p_o
        INNER JOIN public.proveedor p_dest
          ON p_dest.tenant_id = p_o.tenant_id
          AND p_dest.sucursal_id = p_sucursal_destino_id
          AND p_dest.activo = true
          AND (
            (p_o.cuit IS NOT NULL AND btrim(p_o.cuit) <> '' AND p_dest.cuit = p_o.cuit)
            OR (COALESCE(btrim(p_o.cuit), '') = '' AND lower(btrim(p_dest.nombre)) = lower(btrim(p_o.nombre)))
          )
        WHERE p_o.id = v_o_row.proveedor_id
        LIMIT 1;
      END IF;

      INSERT INTO public.producto (
        tenant_id, sucursal_id, codigo, nombre, descripcion,
        categoria_id, proveedor_id, unidad,
        precio_costo, precio_venta, stock_actual, stock_minimo,
        moneda, codigo_barras, es_pesable, plu,
        iva_porcentaje, porcentaje_ganancia, rubro, subrubro, ubicacion,
        activo, imagen_url, fecha_vencimiento
      ) VALUES (
        p_tenant_id,
        p_sucursal_destino_id,
        v_o_row.codigo,
        v_o_row.nombre,
        v_o_row.descripcion,
        v_categoria_d,
        v_proveedor_d,
        v_o_row.unidad,
        v_o_row.precio_costo,
        v_o_row.precio_venta,
        0,
        v_o_row.stock_minimo,
        v_o_row.moneda,
        v_o_row.codigo_barras,
        v_o_row.es_pesable,
        NULL, -- plu único por tenant (ver idx_producto_plu_tenant); no replicar entre sucursales
        v_o_row.iva_porcentaje,
        v_o_row.porcentaje_ganancia,
        v_o_row.rubro,
        v_o_row.subrubro,
        v_o_row.ubicacion,
        true,
        NULL, -- imagen_url asociada al id de origen; se puede subir luego
        NULL  -- vencimiento por lote: no replicar en otra sucursal
      ) RETURNING id INTO v_d_id;
    END IF;
  END IF;

  v_lo := LEAST(p_producto_origen_id, v_d_id);
  v_hi := GREATEST(p_producto_origen_id, v_d_id);

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

  IF r_lo.id = v_d_id THEN
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
    || CASE WHEN v_creado
      THEN ' (alta en destino)'
      ELSE ''
     END
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
    v_d_id,
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
    'producto_destino_id', v_d_id,
    'producto_destino_creado', v_creado,
    'movimiento_salida', to_jsonb(m_sal),
    'movimiento_entrada', to_jsonb(m_ent)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transferir_stock_entre_sucursales(
  uuid, uuid, uuid, numeric, text, uuid, uuid
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
