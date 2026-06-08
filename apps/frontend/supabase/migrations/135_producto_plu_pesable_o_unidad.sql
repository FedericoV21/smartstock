-- PLU admisible si el producto es pesable (balanza por peso) O si la medida de stock es «unidad»
-- (PLU + balanza por piezas / escaneo PLU sin ser pesable por kg).
ALTER TABLE public.producto
  DROP CONSTRAINT IF EXISTS chk_plu_requiere_pesable;

ALTER TABLE public.producto
  ADD CONSTRAINT chk_plu_requiere_pesable
  CHECK (
    plu IS NULL
    OR es_pesable IS TRUE
    OR unidad = 'unidad'::public.unidad_medida
  );

COMMENT ON CONSTRAINT chk_plu_requiere_pesable ON public.producto IS
  'PLU solo con es_pesable o con unidad de inventario «unidad» (no con kg/litro/etc. salvo pesable).';

-- Alinea validación de fusión con el CHECK anterior.
CREATE OR REPLACE FUNCTION public.fusionar_productos(
  p_tenant_id UUID,
  p_survivor_id UUID,
  p_loser_ids UUID[],
  p_campos JSONB DEFAULT '{}'::JSONB,
  p_dry_run BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim UUID;
  v_loser UUID;
  s public.producto%ROWTYPE;
  l public.producto%ROWTYPE;
  v_pref TEXT;
  v_stock_min_pref TEXT;
  v_ps_pref TEXT;
  -- Elecciones finales (vista / update)
  v_codigo VARCHAR(50);
  v_nombre TEXT;
  v_descripcion TEXT;
  v_rubro TEXT;
  v_subrubro TEXT;
  v_ubicacion TEXT;
  v_imagen_url TEXT;
  v_codigo_barras VARCHAR(64);
  v_plu VARCHAR(5);
  v_es_pesable BOOLEAN;
  v_precio_costo NUMERIC(12,2);
  v_precio_venta NUMERIC(12,2);
  v_iva NUMERIC(5,2);
  v_porc_gan NUMERIC(5,2);
  v_uc public.unidad_medida;
  v_cont_uc NUMERIC(18,6);
  v_fecha_venc DATE;
  v_stock_min_prod NUMERIC(12,3);
  v_ss_s RECORD;
  v_ss_l RECORD;
  v_new_stock NUMERIC(12,3);
  v_new_ss_min NUMERIC(12,3);
  v_other_prod UUID;
  k TEXT;
  v_preview JSONB;
  v_problems JSONB[] := ARRAY[]::JSONB[];
BEGIN
  v_claim := public.current_tenant_id();
  IF v_claim IS NULL OR v_claim IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'Operación no autorizada para este tenant';
  END IF;

  IF p_survivor_id IS NULL OR p_loser_ids IS NULL OR coalesce(array_length(p_loser_ids, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'Indicá exactamente un producto a fusionar en el destino';
  END IF;

  v_loser := p_loser_ids[1];
  IF v_loser IS NULL OR v_loser = p_survivor_id THEN
    RAISE EXCEPTION 'El producto a fusionar debe ser distinto del destino';
  END IF;

  SELECT * INTO STRICT s FROM public.producto WHERE id = p_survivor_id AND tenant_id = p_tenant_id;
  SELECT * INTO STRICT l FROM public.producto WHERE id = v_loser AND tenant_id = p_tenant_id;

  IF s.proveedor_id IS NULL OR l.proveedor_id IS NULL OR s.proveedor_id IS DISTINCT FROM l.proveedor_id THEN
    RAISE EXCEPTION 'Ambos productos deben tener el mismo proveedor';
  END IF;

  IF s.sucursal_id IS DISTINCT FROM l.sucursal_id THEN
    RAISE EXCEPTION 'Ambos productos deben ser del mismo depósito (sucursal)';
  END IF;

  IF s.unidad IS DISTINCT FROM l.unidad THEN
    RAISE EXCEPTION 'La unidad de medida debe coincidir para fusionar stock e ítems';
  END IF;

  -- Validar claves desconocidas en p_campos
  IF p_campos IS NOT NULL AND jsonb_typeof(p_campos) = 'object' THEN
    FOR k IN SELECT jsonb_object_keys(p_campos)
    LOOP
      IF k NOT IN (
        'precio_costo', 'precio_venta', 'codigo', 'codigo_barras', 'nombre', 'descripcion',
        'rubro', 'subrubro', 'ubicacion', 'imagen_url', 'plu', 'es_pesable', 'iva_porcentaje',
        'porcentaje_ganancia', 'presentacion_compra', 'stock_minimo', 'precio_sucursal_override',
        'fecha_vencimiento'
      ) THEN
        RAISE EXCEPTION 'Clave no permitida en p_campos: %', k;
      END IF;
    END LOOP;
  END IF;

  v_pref := lower(trim(COALESCE(p_campos->>'precio_costo', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'precio_costo: usar survivor o loser'; END IF;
  v_precio_costo := CASE WHEN v_pref = 'loser' THEN l.precio_costo ELSE s.precio_costo END;

  v_pref := lower(trim(COALESCE(p_campos->>'precio_venta', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'precio_venta: usar survivor o loser'; END IF;
  v_precio_venta := CASE WHEN v_pref = 'loser' THEN l.precio_venta ELSE s.precio_venta END;

  v_pref := lower(trim(COALESCE(p_campos->>'codigo', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'codigo: usar survivor o loser'; END IF;
  v_codigo := CASE WHEN v_pref = 'loser' THEN l.codigo ELSE s.codigo END;

  v_pref := lower(trim(COALESCE(p_campos->>'codigo_barras', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'codigo_barras: usar survivor o loser'; END IF;
  v_codigo_barras := CASE WHEN v_pref = 'loser' THEN l.codigo_barras ELSE s.codigo_barras END;

  v_pref := lower(trim(COALESCE(p_campos->>'nombre', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'nombre: usar survivor o loser'; END IF;
  v_nombre := CASE WHEN v_pref = 'loser' THEN l.nombre ELSE s.nombre END;

  v_pref := lower(trim(COALESCE(p_campos->>'descripcion', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'descripcion: usar survivor o loser'; END IF;
  v_descripcion := CASE WHEN v_pref = 'loser' THEN l.descripcion ELSE s.descripcion END;

  v_pref := lower(trim(COALESCE(p_campos->>'rubro', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'rubro: usar survivor o loser'; END IF;
  v_rubro := CASE WHEN v_pref = 'loser' THEN l.rubro ELSE s.rubro END;

  v_pref := lower(trim(COALESCE(p_campos->>'subrubro', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'subrubro: usar survivor o loser'; END IF;
  v_subrubro := CASE WHEN v_pref = 'loser' THEN l.subrubro ELSE s.subrubro END;

  v_pref := lower(trim(COALESCE(p_campos->>'ubicacion', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'ubicacion: usar survivor o loser'; END IF;
  v_ubicacion := CASE WHEN v_pref = 'loser' THEN l.ubicacion ELSE s.ubicacion END;

  v_pref := lower(trim(COALESCE(p_campos->>'imagen_url', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'imagen_url: usar survivor o loser'; END IF;
  v_imagen_url := CASE WHEN v_pref = 'loser' THEN l.imagen_url ELSE s.imagen_url END;

  v_pref := lower(trim(COALESCE(p_campos->>'plu', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'plu: usar survivor o loser'; END IF;
  v_plu := CASE WHEN v_pref = 'loser' THEN l.plu ELSE s.plu END;

  v_pref := lower(trim(COALESCE(p_campos->>'es_pesable', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'es_pesable: usar survivor o loser'; END IF;
  v_es_pesable := CASE WHEN v_pref = 'loser' THEN l.es_pesable ELSE s.es_pesable END;

  v_pref := lower(trim(COALESCE(p_campos->>'iva_porcentaje', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'iva_porcentaje: usar survivor o loser'; END IF;
  v_iva := CASE WHEN v_pref = 'loser' THEN l.iva_porcentaje ELSE s.iva_porcentaje END;

  v_pref := lower(trim(COALESCE(p_campos->>'porcentaje_ganancia', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'porcentaje_ganancia: usar survivor o loser'; END IF;
  v_porc_gan := CASE WHEN v_pref = 'loser' THEN l.porcentaje_ganancia ELSE s.porcentaje_ganancia END;

  v_pref := lower(trim(COALESCE(p_campos->>'presentacion_compra', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'presentacion_compra: usar survivor o loser'; END IF;
  IF v_pref = 'loser' THEN
    v_uc := l.unidad_compra;
    v_cont_uc := l.contenido_unidad_compra;
  ELSE
    v_uc := s.unidad_compra;
    v_cont_uc := s.contenido_unidad_compra;
  END IF;

  v_pref := lower(trim(COALESCE(p_campos->>'fecha_vencimiento', 'survivor')));
  IF v_pref NOT IN ('survivor', 'loser') THEN RAISE EXCEPTION 'fecha_vencimiento: usar survivor o loser'; END IF;
  v_fecha_venc := CASE WHEN v_pref = 'loser' THEN l.fecha_vencimiento ELSE s.fecha_vencimiento END;

  v_stock_min_pref := lower(trim(COALESCE(p_campos->>'stock_minimo', 'max')));
  IF v_stock_min_pref NOT IN ('survivor', 'loser', 'max') THEN
    RAISE EXCEPTION 'stock_minimo: usar survivor, loser o max';
  END IF;
  v_stock_min_prod := CASE v_stock_min_pref
    WHEN 'loser' THEN l.stock_minimo
    WHEN 'survivor' THEN s.stock_minimo
    ELSE GREATEST(s.stock_minimo, l.stock_minimo)
  END;

  v_ps_pref := lower(trim(COALESCE(p_campos->>'precio_sucursal_override', 'merge')));
  IF v_ps_pref NOT IN ('survivor', 'loser', 'merge') THEN
    RAISE EXCEPTION 'precio_sucursal_override: usar survivor, loser o merge';
  END IF;

  IF v_plu IS NOT NULL AND btrim(v_plu::text) <> '' THEN
    IF NOT COALESCE(v_es_pesable, false) AND s.unidad IS DISTINCT FROM 'unidad'::public.unidad_medida THEN
      RAISE EXCEPTION 'Si hay PLU el producto debe ser pesable (es_pesable) o tener medida de stock «unidad»';
    END IF;
  END IF;

  -- Unicidad PLU (activos, tenant)
  IF v_plu IS NOT NULL AND btrim(v_plu::text) <> '' THEN
    IF EXISTS (
      SELECT 1 FROM public.producto p
      WHERE p.tenant_id = p_tenant_id
        AND p.activo = true
        AND p.plu IS NOT NULL
        AND p.plu = v_plu
        AND p.id NOT IN (p_survivor_id, v_loser)
    ) THEN
      v_problems := array_append(v_problems, jsonb_build_object('tipo', 'plu', 'valor', v_plu));
    END IF;
  END IF;

  -- Unicidad código de barras parcial (mismo depósito y proveedor)
  IF v_codigo_barras IS NOT NULL AND btrim(v_codigo_barras::text) <> '' THEN
    SELECT p.id INTO v_other_prod
    FROM public.producto p
    WHERE p.tenant_id = p_tenant_id
      AND p.activo = true
      AND p.sucursal_id = s.sucursal_id
      AND p.proveedor_id = s.proveedor_id
      AND lower(btrim(p.codigo_barras::text)) = lower(btrim(v_codigo_barras::text))
      AND p.id NOT IN (p_survivor_id, v_loser)
    LIMIT 1;
    IF v_other_prod IS NOT NULL THEN
      v_problems := array_append(
        v_problems,
        jsonb_build_object('tipo', 'codigo_barras', 'valor', v_codigo_barras)
      );
    END IF;
  END IF;

  v_preview := jsonb_build_object(
    'codigo', v_codigo,
    'nombre', v_nombre,
    'precio_costo', v_precio_costo,
    'precio_venta', v_precio_venta,
    'codigo_barras', v_codigo_barras,
    'plu', v_plu,
    'es_pesable', v_es_pesable,
    'stock_minimo', v_stock_min_prod
  );

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'survivor_id', p_survivor_id,
      'loser_id', v_loser,
      'preview_maestro', v_preview,
      'unicidad_problemas', (
        SELECT COALESCE(jsonb_agg(u), '[]'::JSONB) FROM unnest(v_problems) AS u
      ),
      'counts', jsonb_build_object(
        'movimiento', (SELECT count(*)::int FROM public.movimiento WHERE tenant_id = p_tenant_id AND producto_id = v_loser),
        'comprobante_item', (
          SELECT count(*)::int FROM public.comprobante_item ci
          INNER JOIN public.comprobante c ON c.id = ci.comprobante_id AND c.tenant_id = p_tenant_id
          WHERE ci.producto_id = v_loser
        ),
        'pedido_item', (
          SELECT count(*)::int FROM public.pedido_item pi
          INNER JOIN public.pedido p ON p.id = pi.pedido_id AND p.tenant_id = p_tenant_id
          WHERE pi.producto_id = v_loser
        ),
        'lista_precios_item', (
          SELECT count(*)::int FROM public.lista_precios_item li
          INNER JOIN public.lista_precios lp ON lp.id = li.lista_id AND lp.tenant_id = p_tenant_id
          WHERE li.producto_id = v_loser
        ),
        'precio_historial', (SELECT count(*)::int FROM public.precio_historial WHERE tenant_id = p_tenant_id AND producto_id = v_loser),
        'producto_lote_ingreso', (SELECT count(*)::int FROM public.producto_lote_ingreso WHERE tenant_id = p_tenant_id AND producto_id = v_loser),
        'producto_promocion', (SELECT count(*)::int FROM public.producto_promocion WHERE tenant_id = p_tenant_id AND producto_id = v_loser),
        'promocion_combo_item', (SELECT count(*)::int FROM public.promocion_combo_item WHERE tenant_id = p_tenant_id AND producto_id = v_loser),
        'producto_ganancia_tramo', (SELECT count(*)::int FROM public.producto_ganancia_tramo WHERE tenant_id = p_tenant_id AND producto_id = v_loser),
        'producto_proveedor', (SELECT count(*)::int FROM public.producto_proveedor WHERE tenant_id = p_tenant_id AND producto_id = v_loser)
      )
    );
  END IF;

  IF coalesce(array_length(v_problems, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Conflicto de unicidad tras aplicar preferencias: %', to_jsonb(v_problems)::text;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('fusionar_productos:' || p_tenant_id::text || ':' || p_survivor_id::text));

  PERFORM set_config('app.suppress_stock_sync', 'on', true);

  -- Promoción: quitar filas del perdedor que chocan PK con el destino
  DELETE FROM public.producto_promocion pp
  USING public.producto_promocion pp2
  WHERE pp.tenant_id = p_tenant_id
    AND pp.producto_id = v_loser
    AND pp2.tenant_id = pp.tenant_id
    AND pp2.promocion_id = pp.promocion_id
    AND pp2.producto_id = p_survivor_id;

  DELETE FROM public.promocion_combo_item pci
  USING public.promocion_combo_item pci2
  WHERE pci.tenant_id = p_tenant_id
    AND pci.producto_id = v_loser
    AND pci2.tenant_id = pci.tenant_id
    AND pci2.promocion_id = pci.promocion_id
    AND pci2.producto_id = p_survivor_id;

  -- Ganancia por tramo: borrar tramos del perdedor si ya existe el mismo cantidad_desde en el destino
  DELETE FROM public.producto_ganancia_tramo g
  USING public.producto_ganancia_tramo g2
  WHERE g.tenant_id = p_tenant_id
    AND g.producto_id = v_loser
    AND g2.tenant_id = g.tenant_id
    AND g2.producto_id = p_survivor_id
    AND g2.cantidad_desde = g.cantidad_desde;

  -- precio_sucursal (solo fila del depósito común)
  IF v_ps_pref = 'survivor' THEN
    DELETE FROM public.precio_sucursal ps
    WHERE ps.tenant_id = p_tenant_id
      AND ps.producto_id = v_loser
      AND ps.sucursal_id = s.sucursal_id;
  ELSIF v_ps_pref = 'loser' THEN
    DELETE FROM public.precio_sucursal ps
    WHERE ps.tenant_id = p_tenant_id
      AND ps.producto_id = p_survivor_id
      AND ps.sucursal_id = s.sucursal_id;
    UPDATE public.precio_sucursal ps
    SET producto_id = p_survivor_id
    WHERE ps.tenant_id = p_tenant_id
      AND ps.producto_id = v_loser
      AND ps.sucursal_id = s.sucursal_id;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.precio_sucursal
      WHERE tenant_id = p_tenant_id
        AND producto_id = p_survivor_id
        AND sucursal_id = s.sucursal_id
    ) THEN
      UPDATE public.precio_sucursal ps_s
      SET
        precio_costo = COALESCE(ps_s.precio_costo, ps_l.precio_costo),
        precio_venta = COALESCE(ps_s.precio_venta, ps_l.precio_venta),
        updated_at = now()
      FROM public.precio_sucursal ps_l
      WHERE ps_s.tenant_id = p_tenant_id
        AND ps_s.producto_id = p_survivor_id
        AND ps_s.sucursal_id = s.sucursal_id
        AND ps_l.tenant_id = ps_s.tenant_id
        AND ps_l.producto_id = v_loser
        AND ps_l.sucursal_id = s.sucursal_id;
      DELETE FROM public.precio_sucursal ps
      WHERE ps.tenant_id = p_tenant_id
        AND ps.producto_id = v_loser
        AND ps.sucursal_id = s.sucursal_id;
    ELSE
      UPDATE public.precio_sucursal ps
      SET producto_id = p_survivor_id, updated_at = now()
      WHERE ps.tenant_id = p_tenant_id
        AND ps.producto_id = v_loser
        AND ps.sucursal_id = s.sucursal_id;
    END IF;
  END IF;

  DELETE FROM public.producto_proveedor pp
  WHERE pp.tenant_id = p_tenant_id AND pp.producto_id = v_loser;

  UPDATE public.producto_ganancia_tramo SET producto_id = p_survivor_id
  WHERE tenant_id = p_tenant_id AND producto_id = v_loser;

  UPDATE public.movimiento SET producto_id = p_survivor_id
  WHERE tenant_id = p_tenant_id AND producto_id = v_loser;

  UPDATE public.comprobante_item ci SET producto_id = p_survivor_id
  FROM public.comprobante c
  WHERE ci.comprobante_id = c.id AND c.tenant_id = p_tenant_id AND ci.producto_id = v_loser;

  UPDATE public.pedido_item pi SET producto_id = p_survivor_id
  FROM public.pedido p
  WHERE pi.pedido_id = p.id AND p.tenant_id = p_tenant_id AND pi.producto_id = v_loser;

  UPDATE public.lista_precios_item li SET producto_id = p_survivor_id
  FROM public.lista_precios lp
  WHERE li.lista_id = lp.id AND lp.tenant_id = p_tenant_id AND li.producto_id = v_loser;

  UPDATE public.precio_historial SET producto_id = p_survivor_id
  WHERE tenant_id = p_tenant_id AND producto_id = v_loser;

  UPDATE public.producto_lote_ingreso SET producto_id = p_survivor_id
  WHERE tenant_id = p_tenant_id AND producto_id = v_loser;

  UPDATE public.producto_promocion SET producto_id = p_survivor_id
  WHERE tenant_id = p_tenant_id AND producto_id = v_loser;

  UPDATE public.promocion_combo_item SET producto_id = p_survivor_id
  WHERE tenant_id = p_tenant_id AND producto_id = v_loser;

  -- Stock por depósito: sumar
  SELECT * INTO v_ss_s FROM public.stock_sucursal
  WHERE tenant_id = p_tenant_id AND producto_id = p_survivor_id AND sucursal_id = s.sucursal_id;
  SELECT * INTO v_ss_l FROM public.stock_sucursal
  WHERE tenant_id = p_tenant_id AND producto_id = v_loser AND sucursal_id = s.sucursal_id;

  v_new_stock := COALESCE(v_ss_s.stock_actual, s.stock_actual, 0) + COALESCE(v_ss_l.stock_actual, l.stock_actual, 0);

  v_new_ss_min := CASE v_stock_min_pref
    WHEN 'loser' THEN COALESCE(v_ss_l.stock_minimo, l.stock_minimo, 0)
    WHEN 'survivor' THEN COALESCE(v_ss_s.stock_minimo, s.stock_minimo, 0)
    ELSE GREATEST(
      COALESCE(v_ss_s.stock_minimo, s.stock_minimo, 0),
      COALESCE(v_ss_l.stock_minimo, l.stock_minimo, 0)
    )
  END;

  DELETE FROM public.stock_sucursal
  WHERE tenant_id = p_tenant_id AND producto_id = v_loser AND sucursal_id = s.sucursal_id;

  IF v_ss_s.id IS NOT NULL THEN
    UPDATE public.stock_sucursal
    SET stock_actual = v_new_stock,
        stock_minimo = v_new_ss_min,
        ubicacion = CASE WHEN lower(trim(COALESCE(p_campos->>'ubicacion', 'survivor'))) = 'loser' THEN v_ss_l.ubicacion ELSE COALESCE(v_ss_s.ubicacion, v_ss_l.ubicacion) END,
        updated_at = now()
    WHERE id = v_ss_s.id;
  ELSE
    INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
    VALUES (p_tenant_id, p_survivor_id, s.sucursal_id, v_new_stock, v_new_ss_min, v_ubicacion);
  END IF;

  UPDATE public.producto p
  SET
    codigo = v_codigo,
    nombre = v_nombre,
    descripcion = v_descripcion,
    rubro = v_rubro,
    subrubro = v_subrubro,
    ubicacion = v_ubicacion,
    imagen_url = v_imagen_url,
    codigo_barras = v_codigo_barras,
    plu = v_plu,
    es_pesable = v_es_pesable,
    precio_costo = v_precio_costo,
    precio_venta = v_precio_venta,
    iva_porcentaje = v_iva,
    porcentaje_ganancia = v_porc_gan,
    unidad_compra = v_uc,
    contenido_unidad_compra = v_cont_uc,
    fecha_vencimiento = v_fecha_venc,
    stock_actual = v_new_stock,
    stock_minimo = v_stock_min_prod,
    updated_at = now()
  WHERE p.id = p_survivor_id;

  PERFORM set_config('app.suppress_stock_sync', '', true);

  DELETE FROM public.producto WHERE id = v_loser AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'dry_run', false,
    'survivor_id', p_survivor_id,
    'merged_producto_ids', jsonb_build_array(v_loser),
    'preview_maestro', v_preview
  );
END;
$$;

COMMENT ON FUNCTION public.fusionar_productos(uuid, uuid, uuid[], jsonb, boolean) IS
  'Fusiona un producto duplicado en otro (mismo proveedor y sucursal): repunta FKs, suma stock, aplica p_campos. Requiere JWT tenant_id = p_tenant_id.';

REVOKE ALL ON FUNCTION public.fusionar_productos(uuid, uuid, uuid[], jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fusionar_productos(uuid, uuid, uuid[], jsonb, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
