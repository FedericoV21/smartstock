-- Clonar productos (stock 0) y duplicar listas de precios hacia otra sucursal (ítems sin producto; estado pendiente).

CREATE OR REPLACE FUNCTION public.clonar_productos_a_sucursal(
  p_tenant_id            UUID,
  p_sucursal_origen_id   UUID,
  p_sucursal_destino_id  UUID,
  p_producto_ids         UUID[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid      UUID;
  v_o        producto%ROWTYPE;
  v_cat      UUID;
  v_prov     UUID;
  v_new_id   UUID;
  v_creados  UUID[] := ARRAY[]::UUID[];
  v_omitido_items jsonb[] := ARRAY[]::jsonb[];
  v_err      TEXT;
BEGIN
  IF p_sucursal_origen_id = p_sucursal_destino_id THEN
    RAISE EXCEPTION 'Origen y destino deben ser distintas sucursales';
  END IF;

  IF p_producto_ids IS NULL OR coalesce(array_length(p_producto_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Indicá al menos un producto a clonar';
  END IF;

  FOREACH v_pid IN ARRAY p_producto_ids
  LOOP
    SELECT * INTO v_o
    FROM public.producto
    WHERE id = v_pid
      AND tenant_id = p_tenant_id
      AND sucursal_id = p_sucursal_origen_id;

    IF NOT FOUND THEN
      v_omitido_items := array_append(
        v_omitido_items,
        jsonb_build_object('producto_id', v_pid, 'motivo', 'no encontrado o no pertenece a la sucursal de origen')
      );
      CONTINUE;
    END IF;

    IF NOT v_o.activo THEN
      v_omitido_items := array_append(
        v_omitido_items,
        jsonb_build_object('producto_id', v_pid, 'motivo', 'producto inactivo en origen')
      );
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.producto
      WHERE tenant_id = p_tenant_id
        AND sucursal_id = p_sucursal_destino_id
        AND activo = true
        AND lower(btrim(codigo)) = lower(btrim(v_o.codigo))
        AND unidad = v_o.unidad
    ) THEN
      v_omitido_items := array_append(
        v_omitido_items,
        jsonb_build_object('producto_id', v_pid, 'motivo', 'ya existe en destino (mismo código y unidad)')
      );
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.producto
      WHERE tenant_id = p_tenant_id
        AND sucursal_id = p_sucursal_destino_id
        AND activo = false
        AND lower(btrim(codigo)) = lower(btrim(v_o.codigo))
        AND unidad = v_o.unidad
    ) THEN
      v_omitido_items := array_append(
        v_omitido_items,
        jsonb_build_object('producto_id', v_pid, 'motivo', 'existe producto inactivo en destino; reactivá o unificá')
      );
      CONTINUE;
    END IF;

    v_cat := NULL;
    IF v_o.categoria_id IS NOT NULL THEN
      SELECT c_dest.id INTO v_cat
      FROM public.categoria c_o
      INNER JOIN public.categoria c_dest
        ON c_dest.tenant_id = c_o.tenant_id
        AND c_dest.sucursal_id = p_sucursal_destino_id
        AND c_dest.activa = true
        AND lower(c_dest.nombre) = lower(c_o.nombre)
      WHERE c_o.id = v_o.categoria_id
      LIMIT 1;
    END IF;

    v_prov := NULL;
    IF v_o.proveedor_id IS NOT NULL THEN
      SELECT p_dest.id INTO v_prov
      FROM public.proveedor p_o
      INNER JOIN public.proveedor p_dest
        ON p_dest.tenant_id = p_o.tenant_id
        AND p_dest.sucursal_id = p_sucursal_destino_id
        AND p_dest.activo = true
        AND (
          (p_o.cuit IS NOT NULL AND btrim(p_o.cuit) <> '' AND p_dest.cuit = p_o.cuit)
          OR (COALESCE(btrim(p_o.cuit), '') = '' AND lower(btrim(p_dest.nombre)) = lower(btrim(p_o.nombre)))
        )
      WHERE p_o.id = v_o.proveedor_id
      LIMIT 1;
    END IF;

    BEGIN
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
        v_o.codigo,
        v_o.nombre,
        v_o.descripcion,
        v_cat,
        v_prov,
        v_o.unidad,
        v_o.precio_costo,
        v_o.precio_venta,
        0,
        v_o.stock_minimo,
        v_o.moneda,
        v_o.codigo_barras,
        v_o.es_pesable,
        NULL,
        v_o.iva_porcentaje,
        v_o.porcentaje_ganancia,
        v_o.rubro,
        v_o.subrubro,
        v_o.ubicacion,
        true,
        NULL,
        NULL
      ) RETURNING id INTO v_new_id;

      v_creados := array_append(v_creados, v_new_id);
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        v_omitido_items := array_append(
          v_omitido_items,
          jsonb_build_object('producto_id', v_pid, 'motivo', v_err)
        );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'creados', to_jsonb(v_creados),
    'total_creados', coalesce(array_length(v_creados, 1), 0),
    'omitidos', coalesce(
      (SELECT jsonb_agg(t) FROM unnest(v_omitido_items) AS t),
      '[]'::jsonb
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.clonar_productos_a_sucursal(uuid, uuid, uuid, uuid[]) TO authenticated, service_role;

-- Lista de precios: nuevo documento, mismo proveedor mapeado en otra sucursal; ítems sin vinculación a producto.
CREATE OR REPLACE FUNCTION public.clonar_lista_precios_a_sucursal(
  p_tenant_id            UUID,
  p_lista_id             UUID,
  p_sucursal_destino_id  UUID,
  p_usuario_id           UUID
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_l     lista_precios%ROWTYPE;
  v_suc   UUID;
  v_prov_d UUID;
  v_new   UUID;
  v_cnt   INT;
  v_nombre TEXT;
BEGIN
  SELECT * INTO STRICT v_l
  FROM public.lista_precios
  WHERE id = p_lista_id
    AND tenant_id = p_tenant_id;

  SELECT p.sucursal_id INTO v_suc
  FROM public.proveedor p
  WHERE p.id = v_l.proveedor_id;

  IF v_suc IS NULL THEN
    RAISE EXCEPTION 'Proveedor de la lista sin sucursal';
  END IF;

  IF v_suc = p_sucursal_destino_id THEN
    RAISE EXCEPTION 'La sucursal de destino no puede ser la de la lista actual';
  END IF;

  SELECT p_dest.id INTO v_prov_d
  FROM public.proveedor p_o
  INNER JOIN public.proveedor p_dest
    ON p_dest.tenant_id = p_o.tenant_id
    AND p_dest.sucursal_id = p_sucursal_destino_id
    AND p_dest.activo = true
    AND (
      (p_o.cuit IS NOT NULL AND btrim(p_o.cuit) <> '' AND p_dest.cuit = p_o.cuit)
      OR (COALESCE(btrim(p_o.cuit), '') = '' AND lower(btrim(p_dest.nombre)) = lower(btrim(p_o.nombre)))
    )
  WHERE p_o.id = v_l.proveedor_id
  LIMIT 1;

  IF v_prov_d IS NULL THEN
    RAISE EXCEPTION 'No hay proveedor equivalente en la sucursal de destino (mismo CUIT o nombre). Creá el proveedor y reintentá.';
  END IF;

  SELECT count(*)::int INTO v_cnt
  FROM public.lista_precios_item
  WHERE lista_id = p_lista_id;

  v_nombre := left(v_l.nombre_archivo, 200) || ' (copia)';

  INSERT INTO public.lista_precios (
    tenant_id,
    proveedor_id,
    usuario_id,
    nombre_archivo,
    mime_type,
    storage_path,
    origen_extraccion,
    fecha_recepcion,
    fecha_vigencia_desde,
    fecha_vigencia_hasta,
    estado,
    error_mensaje,
    total_items,
    items_matcheados_seguros,
    items_matcheados_dudosos,
    items_sin_match,
    items_con_aumento,
    items_con_baja,
    items_sin_cambio,
    variacion_promedio_pct,
    margen_global_anterior_pct,
    margen_global_nuevo_pct,
    resumen_ia,
    impacto_por_categoria
  ) VALUES (
    p_tenant_id,
    v_prov_d,
    p_usuario_id,
    v_nombre,
    v_l.mime_type,
    NULL,
    v_l.origen_extraccion,
    now(),
    v_l.fecha_vigencia_desde,
    v_l.fecha_vigencia_hasta,
    'pendiente',
    NULL,
    v_cnt,
    0, 0, 0, 0, 0, 0,
    NULL, NULL, NULL, NULL, NULL
  ) RETURNING id INTO v_new;

  INSERT INTO public.lista_precios_item (
    lista_id,
    orden,
    codigo_proveedor,
    nombre_raw,
    nombre_normalizado,
    unidad,
    precio_lista,
    producto_id,
    match_confidence,
    match_metodo,
    precio_costo_anterior,
    variacion_pct,
    precio_venta_actual,
    margen_anterior_pct,
    margen_nuevo_pct,
    precio_venta_sugerido,
    precio_venta_decidido,
    incluir_en_aplicacion,
    notas
  )
  SELECT
    v_new,
    i.orden,
    i.codigo_proveedor,
    i.nombre_raw,
    i.nombre_normalizado,
    i.unidad,
    i.precio_lista,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    coalesce(i.incluir_en_aplicacion, true),
    NULL
  FROM public.lista_precios_item i
  WHERE i.lista_id = p_lista_id
  ORDER BY i.orden NULLS LAST, i.created_at;

  RETURN jsonb_build_object('lista_id', v_new, 'items', v_cnt);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clonar_lista_precios_a_sucursal(uuid, uuid, uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
