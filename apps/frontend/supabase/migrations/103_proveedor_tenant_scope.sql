-- Proveedores a nivel tenant (negocio), alineados con cuenta_corriente única por (tenant_id, proveedor_id).
-- Incluye: sucursal de carga en lista_precios, merge de duplicados por CUIT/nombre, FKs, CC, RPC de clonación/transferencia.

-- ─── lista_precios: trazabilidad sucursal (antes se infería por proveedor.sucursal_id) ───
ALTER TABLE public.lista_precios
  ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES public.sucursal (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lista_precios_tenant_sucursal
  ON public.lista_precios (tenant_id, sucursal_id)
  WHERE sucursal_id IS NOT NULL;

COMMENT ON COLUMN public.lista_precios.sucursal_id IS
  'Sucursal operativa donde se cargó la lista (contexto de aplicación al catálogo). El proveedor es del tenant completo.';

UPDATE public.lista_precios lp
SET sucursal_id = p.sucursal_id
FROM public.proveedor p
WHERE lp.proveedor_id = p.id
  AND lp.sucursal_id IS NULL
  AND p.sucursal_id IS NOT NULL;

UPDATE public.lista_precios lp
SET sucursal_id = sub.id
FROM (
  SELECT DISTINCT ON (s.tenant_id) s.tenant_id, s.id
  FROM public.sucursal s
  ORDER BY s.tenant_id, s.id
) sub
WHERE lp.tenant_id = sub.tenant_id
  AND lp.sucursal_id IS NULL;

-- ─── Mapa de merge: mismo tenant, mismo CUIT normalizado (solo dígitos) o mismo nombre si sin CUIT ───
-- Tabla temporal: no calificar como public.* (no está en el schema public; vive en pg_temp).
-- ON COMMIT PRESERVE ROWS: si el cliente ejecuta varias sentencias en transacciones distintas, la temp sigue en la sesión.
DROP TABLE IF EXISTS proveedor_merge_map;
CREATE TEMP TABLE proveedor_merge_map (
  loser_id    UUID PRIMARY KEY,
  survivor_id UUID NOT NULL
) ON COMMIT PRESERVE ROWS;

WITH norm AS (
  SELECT
    id,
    tenant_id,
    CASE
      WHEN NULLIF(regexp_replace(btrim(coalesce(cuit, '')), '[^0-9]', '', 'g'), '') IS NOT NULL THEN
        'c:' || regexp_replace(btrim(coalesce(cuit, '')), '[^0-9]', '', 'g')
      ELSE
        'n:' || lower(regexp_replace(btrim(nombre), '\s+', ' ', 'g'))
    END AS grp,
    created_at
  FROM public.proveedor
),
ranked AS (
  SELECT
    id,
    tenant_id,
    grp,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, grp
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM norm
)
INSERT INTO proveedor_merge_map (loser_id, survivor_id)
SELECT r.id, s.id
FROM ranked r
INNER JOIN ranked s
  ON s.tenant_id = r.tenant_id
  AND s.grp = r.grp
  AND s.rn = 1
WHERE r.rn > 1;

-- ─── producto_proveedor: quitar duplicados (mismo producto + survivor ya enlazado) ───
-- USING no puede hacer JOIN que referencie el alias del DELETE; lista plana + WHERE.
DELETE FROM public.producto_proveedor pp
USING proveedor_merge_map m, public.producto_proveedor pp2
WHERE pp.proveedor_id = m.loser_id
  AND pp2.tenant_id = pp.tenant_id
  AND pp2.producto_id = pp.producto_id
  AND pp2.proveedor_id = m.survivor_id;

UPDATE public.producto_proveedor pp
SET proveedor_id = m.survivor_id
FROM proveedor_merge_map m
WHERE pp.proveedor_id = m.loser_id;

UPDATE public.producto p
SET proveedor_id = m.survivor_id
FROM proveedor_merge_map m
WHERE p.proveedor_id = m.loser_id;

UPDATE public.lista_precios lp
SET proveedor_id = m.survivor_id
FROM proveedor_merge_map m
WHERE lp.proveedor_id = m.loser_id;

UPDATE public.comprobante c
SET proveedor_id = m.survivor_id
FROM proveedor_merge_map m
WHERE c.proveedor_id = m.loser_id;

UPDATE public.importacion_log il
SET proveedor_id = m.survivor_id
FROM proveedor_merge_map m
WHERE il.proveedor_id = m.loser_id;

UPDATE public.lector_factura_log lfl
SET proveedor_id = m.survivor_id
FROM proveedor_merge_map m
WHERE lfl.proveedor_id = m.loser_id;

UPDATE public.pago pg
SET proveedor_id = m.survivor_id
FROM proveedor_merge_map m
WHERE pg.proveedor_id = m.loser_id;

UPDATE public.pago_proveedor_factura ppf
SET proveedor_id = m.survivor_id
FROM proveedor_merge_map m
WHERE ppf.proveedor_id = m.loser_id;

UPDATE public.whatsapp_branch_rule wbr
SET proveedor_id = m.survivor_id
FROM proveedor_merge_map m
WHERE wbr.proveedor_id = m.loser_id;

-- ─── cuenta_corriente: fusionar saldos y repoint pagos ───
DO $$
DECLARE
  r           RECORD;
  v_tenant    UUID;
  v_loser_cc  UUID;
  v_surv_cc   UUID;
  v_saldo_l   NUMERIC;
BEGIN
  FOR r IN SELECT loser_id, survivor_id FROM proveedor_merge_map
  LOOP
    v_loser_cc := NULL;
    v_surv_cc := NULL;
    v_saldo_l := NULL;

    SELECT tenant_id INTO v_tenant FROM public.proveedor WHERE id = r.survivor_id;

    SELECT id INTO v_surv_cc
    FROM public.cuenta_corriente
    WHERE tenant_id = v_tenant AND proveedor_id = r.survivor_id
    LIMIT 1;

    SELECT id, saldo INTO v_loser_cc, v_saldo_l
    FROM public.cuenta_corriente
    WHERE tenant_id = v_tenant AND proveedor_id = r.loser_id
    LIMIT 1;

    IF v_loser_cc IS NULL THEN
      CONTINUE;
    END IF;

    IF v_surv_cc IS NOT NULL THEN
      UPDATE public.pago
      SET cuenta_id = v_surv_cc
      WHERE cuenta_id = v_loser_cc;

      UPDATE public.cuenta_corriente
      SET saldo = saldo + COALESCE(v_saldo_l, 0),
          updated_at = now()
      WHERE id = v_surv_cc;

      DELETE FROM public.cuenta_corriente WHERE id = v_loser_cc;
    ELSE
      UPDATE public.cuenta_corriente
      SET proveedor_id = r.survivor_id,
          updated_at = now()
      WHERE id = v_loser_cc;
    END IF;
  END LOOP;
END;
$$;

DELETE FROM public.proveedor p
USING proveedor_merge_map m
WHERE p.id = m.loser_id;

DROP TABLE IF EXISTS proveedor_merge_map;

-- ─── proveedor.sucursal_id opcional (ya no define alcance del maestro) ───
DROP TRIGGER IF EXISTS proveedor_set_sucursal_por_defecto ON public.proveedor;

ALTER TABLE public.proveedor
  ALTER COLUMN sucursal_id DROP NOT NULL;

UPDATE public.proveedor
SET sucursal_id = NULL
WHERE sucursal_id IS NOT NULL;

COMMENT ON COLUMN public.proveedor.sucursal_id IS
  'Opcional: sucursal de referencia o alta histórica. El proveedor aplica a todo el tenant; listados y CC no filtran por esta columna.';

COMMENT ON TABLE public.sucursal IS
  'Punto de operación del tenant (stock, comprobantes, caja). Los proveedores son maestros del negocio (tenant), no propiedad exclusiva de una sucursal.';

DROP INDEX IF EXISTS idx_proveedor_tenant_sucursal_lookup;
CREATE INDEX IF NOT EXISTS idx_proveedor_tenant_nombre_lower
  ON public.proveedor (tenant_id, lower(nombre))
  WHERE activo = true;

DROP INDEX IF EXISTS idx_proveedor_sucursal;

-- ─── clonar productos: mismo proveedor_id en destino ───
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

    v_prov := v_o.proveedor_id;

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

-- ─── clonar lista: mismo proveedor; sucursal de origen desde lista_precios.sucursal_id ───
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
  v_new   UUID;
  v_cnt   INT;
  v_nombre TEXT;
BEGIN
  SELECT * INTO STRICT v_l
  FROM public.lista_precios
  WHERE id = p_lista_id
    AND tenant_id = p_tenant_id;

  v_suc := v_l.sucursal_id;

  IF v_suc IS NULL THEN
    SELECT p.sucursal_id INTO v_suc
    FROM public.proveedor p
    WHERE p.id = v_l.proveedor_id;
  END IF;

  IF v_suc IS NULL THEN
    RAISE EXCEPTION 'Lista sin sucursal de origen (sucursal_id nulo); asigná sucursal en la lista o reimportá.';
  END IF;

  IF v_suc = p_sucursal_destino_id THEN
    RAISE EXCEPTION 'La sucursal de destino no puede ser la misma que la de origen de la lista';
  END IF;

  SELECT count(*)::int INTO v_cnt
  FROM public.lista_precios_item
  WHERE lista_id = p_lista_id;

  v_nombre := left(v_l.nombre_archivo, 200) || ' (copia)';

  INSERT INTO public.lista_precios (
    tenant_id,
    proveedor_id,
    usuario_id,
    sucursal_id,
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
    v_l.proveedor_id,
    p_usuario_id,
    p_sucursal_destino_id,
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

-- ─── transferir stock: mismo proveedor_id en producto clonado (maestro tenant-wide) ───
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

      v_proveedor_d := v_o_row.proveedor_id;

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
        NULL,
        v_o_row.iva_porcentaje,
        v_o_row.porcentaje_ganancia,
        v_o_row.rubro,
        v_o_row.subrubro,
        v_o_row.ubicacion,
        true,
        NULL,
        NULL
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

GRANT EXECUTE ON FUNCTION public.clonar_productos_a_sucursal(uuid, uuid, uuid, uuid[]) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.clonar_lista_precios_a_sucursal(uuid, uuid, uuid, uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.transferir_stock_entre_sucursales(
  uuid, uuid, uuid, numeric, text, uuid, uuid
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
