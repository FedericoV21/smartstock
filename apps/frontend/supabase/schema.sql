


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "moddatetime" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."arca_ambiente" AS ENUM (
    'homologacion',
    'produccion'
);


ALTER TYPE "public"."arca_ambiente" OWNER TO "postgres";


CREATE TYPE "public"."cliente_documento_fiscal" AS ENUM (
    'cuit',
    'dni'
);


ALTER TYPE "public"."cliente_documento_fiscal" OWNER TO "postgres";


CREATE TYPE "public"."cobro_modalidad" AS ENUM (
    'por_comprobante',
    'periodico',
    'dia_fijo_mes'
);


ALTER TYPE "public"."cobro_modalidad" OWNER TO "postgres";


CREATE TYPE "public"."cobro_periodicidad" AS ENUM (
    'semanal',
    'quincenal',
    'mensual',
    'diaria'
);


ALTER TYPE "public"."cobro_periodicidad" OWNER TO "postgres";


CREATE TYPE "public"."condicion_iva" AS ENUM (
    'responsable_inscripto',
    'monotributista',
    'exento',
    'consumidor_final'
);


ALTER TYPE "public"."condicion_iva" OWNER TO "postgres";


CREATE TYPE "public"."estado_comprobante" AS ENUM (
    'borrador',
    'emitido',
    'pendiente_arca',
    'error_arca',
    'anulado',
    'pendiente_posnet',
    'importado',
    'pendiente_qr'
);


ALTER TYPE "public"."estado_comprobante" OWNER TO "postgres";


CREATE TYPE "public"."estado_lista_precios" AS ENUM (
    'pendiente',
    'analizada',
    'aplicada_total',
    'aplicada_parcial',
    'archivada',
    'error'
);


ALTER TYPE "public"."estado_lista_precios" OWNER TO "postgres";


CREATE TYPE "public"."estado_pedido" AS ENUM (
    'borrador',
    'confirmado',
    'entregado',
    'cancelado'
);


ALTER TYPE "public"."estado_pedido" OWNER TO "postgres";


CREATE TYPE "public"."origen_precio" AS ENUM (
    'manual',
    'importacion_excel',
    'ia_pdf',
    'lista_precios',
    'factura_recibida',
    'lector_factura'
);


ALTER TYPE "public"."origen_precio" OWNER TO "postgres";


CREATE TYPE "public"."plan_tipo" AS ENUM (
    'base',
    'completo',
    'intermedio'
);


ALTER TYPE "public"."plan_tipo" OWNER TO "postgres";


CREATE TYPE "public"."promocion_tipo" AS ENUM (
    'porcentaje_off',
    'n_x_m',
    'porcentaje_unidad_n',
    'descuento_volumen',
    'combo_precio_fijo'
);


ALTER TYPE "public"."promocion_tipo" OWNER TO "postgres";


CREATE TYPE "public"."referencia_tipo" AS ENUM (
    'factura',
    'pedido',
    'importacion',
    'manual',
    'ajuste_inventario',
    'factura_recibida',
    'factura_importada',
    'transferencia_sucursal'
);


ALTER TYPE "public"."referencia_tipo" OWNER TO "postgres";


CREATE TYPE "public"."rol_usuario" AS ENUM (
    'admin',
    'operador',
    'visor'
);


ALTER TYPE "public"."rol_usuario" OWNER TO "postgres";


CREATE TYPE "public"."tipo_comprobante" AS ENUM (
    'factura_a',
    'factura_b',
    'factura_c',
    'nota_credito_a',
    'nota_credito_b',
    'nota_credito_c',
    'remito',
    'devolucion_remito',
    'presupuesto',
    'ticket',
    'recibo'
);


ALTER TYPE "public"."tipo_comprobante" OWNER TO "postgres";


CREATE TYPE "public"."tipo_cuenta_corriente" AS ENUM (
    'cliente',
    'empleado',
    'proveedor'
);


ALTER TYPE "public"."tipo_cuenta_corriente" OWNER TO "postgres";


CREATE TYPE "public"."tipo_movimiento" AS ENUM (
    'entrada',
    'salida',
    'ajuste'
);


ALTER TYPE "public"."tipo_movimiento" OWNER TO "postgres";


CREATE TYPE "public"."tipo_pago" AS ENUM (
    'efectivo',
    'transferencia',
    'cheque',
    'tarjeta',
    'otro'
);


ALTER TYPE "public"."tipo_pago" OWNER TO "postgres";


CREATE TYPE "public"."unidad_medida" AS ENUM (
    'unidad',
    'kg',
    'litro',
    'metro',
    'caja',
    'pack',
    'gramo',
    'ml'
);


ALTER TYPE "public"."unidad_medida" OWNER TO "postgres";


CREATE TYPE "public"."whatsapp_branch_resolution_status" AS ENUM (
    'resolved_auto',
    'resolved_manual',
    'ambiguous',
    'not_found'
);


ALTER TYPE "public"."whatsapp_branch_resolution_status" OWNER TO "postgres";


CREATE TYPE "public"."whatsapp_job_status" AS ENUM (
    'queued',
    'processing',
    'imported',
    'review_required',
    'error',
    'awaiting_branch_confirmation'
);


ALTER TYPE "public"."whatsapp_job_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."activar_plan"("p_tenant_id" "uuid", "p_plan" "public"."plan_tipo") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.tenant
  SET
    plan = p_plan,
    ia_ilimitada_origen = CASE
      WHEN p_plan = 'intermedio' THEN COALESCE(ia_ilimitada_origen, 'ia_pdf')
      ELSE NULL
    END
  WHERE id = p_tenant_id;

  IF p_plan = 'completo' THEN
    UPDATE public.modulo_config SET
      facturador_simple = true,
      facturador_arca = true,
      facturador_pos = true,
      pedidos = true,
      presupuestos = true,
      ia_precios = true,
      analizador_rentabilidad = true,
      lector_facturas = true
    WHERE tenant_id = p_tenant_id;
  ELSIF p_plan = 'intermedio' THEN
    UPDATE public.modulo_config SET
      facturador_simple = true,
      facturador_arca = true,
      facturador_pos = true,
      pedidos = true,
      presupuestos = true,
      ia_precios = true,
      analizador_rentabilidad = false,
      lector_facturas = true
    WHERE tenant_id = p_tenant_id;
  ELSIF p_plan = 'base' THEN
    UPDATE public.modulo_config SET
      facturador_simple = true,
      facturador_arca = true,
      facturador_pos = true,
      pedidos = true,
      presupuestos = false,
      ia_precios = false,
      analizador_rentabilidad = false,
      lector_facturas = false
    WHERE tenant_id = p_tenant_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."activar_plan"("p_tenant_id" "uuid", "p_plan" "public"."plan_tipo") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bootstrap_security_for_tenant"("p_tenant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_sucursal_principal_id UUID;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant requerido';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenant t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant no encontrado';
  END IF;

  INSERT INTO public.sucursal (tenant_id, codigo, nombre, es_principal, activa)
  SELECT p_tenant_id, 'CASA', 'Sucursal Principal', TRUE, TRUE
  WHERE NOT EXISTS (
      SELECT 1
      FROM public.sucursal x
      WHERE x.tenant_id = p_tenant_id
        AND trim(lower(x.codigo)) = 'casa'
    );

  SELECT s.id
  INTO v_sucursal_principal_id
  FROM public.sucursal s
  WHERE s.tenant_id = p_tenant_id
  ORDER BY s.es_principal DESC, s.created_at ASC
  LIMIT 1;

  INSERT INTO public.rol (tenant_id, slug, nombre, descripcion, es_base, activo)
  VALUES
    (p_tenant_id, 'superadmin', 'Superadministrador', 'Acceso total del tenant', TRUE, TRUE),
    (p_tenant_id, 'admin', 'Administrador', 'Gestión completa del negocio', TRUE, TRUE),
    (p_tenant_id, 'cajero', 'Cajero', 'Operación de caja y emisión de comprobantes', TRUE, TRUE),
    (p_tenant_id, 'operador', 'Operador', 'Operación general sin configuración avanzada', TRUE, TRUE),
    (p_tenant_id, 'visor', 'Visor', 'Acceso de solo lectura', TRUE, TRUE)
  ON CONFLICT (tenant_id, lower(slug)) DO NOTHING;

  WITH role_map AS (
    SELECT id, lower(slug) AS slug
    FROM public.rol
    WHERE tenant_id = p_tenant_id
      AND lower(slug) IN ('superadmin', 'admin', 'cajero', 'operador', 'visor')
  ),
  target(role_slug, permiso_clave) AS (
    VALUES
      ('superadmin', 'dashboard.ver'),
      ('superadmin', 'usuarios.gestionar'),
      ('superadmin', 'roles.gestionar'),
      ('superadmin', 'sucursales.gestionar'),
      ('superadmin', 'sucursales.ver_todas'),
      ('superadmin', 'ventas.ver'),
      ('superadmin', 'ventas.crear'),
      ('superadmin', 'facturacion.emitir'),
      ('superadmin', 'facturacion.anular'),
      ('superadmin', 'caja.operar'),
      ('superadmin', 'stock.ver'),
      ('superadmin', 'stock.ajustar'),
      ('superadmin', 'pedidos.gestionar'),
      ('superadmin', 'reportes.ver'),
      ('superadmin', 'reportes.consolidado'),
      ('admin', 'dashboard.ver'),
      ('admin', 'usuarios.gestionar'),
      ('admin', 'roles.gestionar'),
      ('admin', 'sucursales.gestionar'),
      ('admin', 'sucursales.ver_todas'),
      ('admin', 'ventas.ver'),
      ('admin', 'ventas.crear'),
      ('admin', 'facturacion.emitir'),
      ('admin', 'facturacion.anular'),
      ('admin', 'caja.operar'),
      ('admin', 'stock.ver'),
      ('admin', 'stock.ajustar'),
      ('admin', 'pedidos.gestionar'),
      ('admin', 'reportes.ver'),
      ('admin', 'reportes.consolidado'),
      ('cajero', 'dashboard.ver'),
      ('cajero', 'ventas.ver'),
      ('cajero', 'ventas.crear'),
      ('cajero', 'facturacion.emitir'),
      ('cajero', 'caja.operar'),
      ('cajero', 'stock.ver'),
      ('operador', 'dashboard.ver'),
      ('operador', 'ventas.ver'),
      ('operador', 'ventas.crear'),
      ('operador', 'facturacion.emitir'),
      ('operador', 'stock.ver'),
      ('operador', 'stock.ajustar'),
      ('operador', 'pedidos.gestionar'),
      ('operador', 'reportes.ver'),
      ('visor', 'dashboard.ver'),
      ('visor', 'ventas.ver'),
      ('visor', 'stock.ver'),
      ('visor', 'reportes.ver')
  )
  INSERT INTO public.rol_permiso (rol_id, permiso_id)
  SELECT rm.id, p.id
  FROM target t
  JOIN role_map rm ON rm.slug = t.role_slug
  JOIN public.permiso p ON p.clave = t.permiso_clave
  ON CONFLICT DO NOTHING;

  INSERT INTO public.usuario_rol (usuario_id, rol_id)
  SELECT u.id, r.id
  FROM public.usuario u
  JOIN public.rol r
    ON r.tenant_id = u.tenant_id
   AND lower(r.slug) = lower(u.rol::text)
  WHERE u.tenant_id = p_tenant_id
  ON CONFLICT DO NOTHING;

  UPDATE public.usuario u
  SET sucursal_default_id = v_sucursal_principal_id
  WHERE u.tenant_id = p_tenant_id
    AND u.sucursal_default_id IS NULL
    AND v_sucursal_principal_id IS NOT NULL;

  INSERT INTO public.usuario_sucursal (usuario_id, sucursal_id)
  SELECT u.id, v_sucursal_principal_id
  FROM public.usuario u
  WHERE u.tenant_id = p_tenant_id
    AND v_sucursal_principal_id IS NOT NULL
  ON CONFLICT DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."bootstrap_security_for_tenant"("p_tenant_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bootstrap_security_for_tenant"("p_tenant_id" "uuid") IS 'Inicializa sucursal principal (CASA · Sucursal Principal si falta), roles base, permisos y backfill legacy.';



CREATE OR REPLACE FUNCTION "public"."clonar_lista_precios_a_sucursal"("p_tenant_id" "uuid", "p_lista_id" "uuid", "p_sucursal_destino_id" "uuid", "p_usuario_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."clonar_lista_precios_a_sucursal"("p_tenant_id" "uuid", "p_lista_id" "uuid", "p_sucursal_destino_id" "uuid", "p_usuario_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clonar_productos_a_sucursal"("p_tenant_id" "uuid", "p_sucursal_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_producto_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."clonar_productos_a_sucursal"("p_tenant_id" "uuid", "p_sucursal_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_producto_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."contribuir_radar"("p_rubro" "text", "p_proveedor_nombre" "text", "p_periodo" "text", "p_variacion_pct" numeric, "p_cantidad_items" integer DEFAULT 1) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.radar_inflacion (
    rubro, proveedor_nombre, periodo,
    variacion_promedio_pct, cantidad_listas, cantidad_items
  ) VALUES (
    p_rubro, p_proveedor_nombre, p_periodo,
    p_variacion_pct, 1, p_cantidad_items
  )
  ON CONFLICT (rubro, proveedor_nombre, periodo) DO UPDATE SET
    variacion_promedio_pct = (
      (radar_inflacion.variacion_promedio_pct * radar_inflacion.cantidad_listas + p_variacion_pct)
      / (radar_inflacion.cantidad_listas + 1)
    ),
    cantidad_listas = radar_inflacion.cantidad_listas + 1,
    cantidad_items  = radar_inflacion.cantidad_items + p_cantidad_items;
END;
$$;


ALTER FUNCTION "public"."contribuir_radar"("p_rubro" "text", "p_proveedor_nombre" "text", "p_periodo" "text", "p_variacion_pct" numeric, "p_cantidad_items" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid,
    NULL
  );
$$;


ALTER FUNCTION "public"."current_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_home uuid;
  v_context uuid;
  v_super boolean;
  v_effective uuid;
  v_uid uuid;
BEGIN
  v_uid := (event->>'user_id')::uuid;

  SELECT u.tenant_id, u.tenant_contexto_id, u.es_super_admin
  INTO v_home, v_context, v_super
  FROM public.usuario u
  WHERE u.id = v_uid;

  IF v_home IS NULL THEN
    RETURN event;
  END IF;

  v_effective := v_home;

  IF v_super AND v_context IS NOT NULL AND v_context <> v_home THEN
    IF EXISTS (
      SELECT 1
      FROM public.super_admin_tenant_acceso s
      WHERE s.usuario_id = v_uid AND s.tenant_id = v_context
    ) THEN
      v_effective := v_context;
    END IF;
  END IF;

  event := jsonb_set(
    event,
    '{claims,tenant_id}',
    to_jsonb(v_effective::text)
  );

  RETURN event;
END;
$$;


ALTER FUNCTION "public"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_tenant_access_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_base TEXT;
BEGIN
  IF NEW.codigo_acceso IS NULL OR btrim(NEW.codigo_acceso) = '' THEN
    v_base := public.normalize_tenant_access_code(NEW.nombre);
    IF v_base = '' THEN
      v_base := 'negocio';
    END IF;

    NEW.codigo_acceso := left(v_base, 10) || substring(replace(NEW.id::text, '-', ''), 1, 6);
  ELSE
    NEW.codigo_acceso := public.normalize_tenant_access_code(NEW.codigo_acceso);
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_tenant_access_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fecha_vencimiento_proxima_lote"("p_producto_id" "uuid") RETURNS "date"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT MIN(fecha_vencimiento)
  FROM public.producto_lote_ingreso
  WHERE producto_id = p_producto_id
    AND cantidad > 0
    AND fecha_vencimiento IS NOT NULL;
$$;


ALTER FUNCTION "public"."fecha_vencimiento_proxima_lote"("p_producto_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_permiso"("p_clave" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_allowed BOOLEAN := false;
BEGIN
  IF v_uid IS NULL OR p_clave IS NULL OR btrim(p_clave) = '' THEN
    RETURN false;
  END IF;

  -- Super admin siempre habilitado.
  SELECT u.es_super_admin
  INTO v_allowed
  FROM public.usuario u
  WHERE u.id = v_uid
    AND u.activo = true;

  IF COALESCE(v_allowed, false) THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.usuario_rol ur
    JOIN public.rol r
      ON r.id = ur.rol_id
     AND r.activo = true
    JOIN public.rol_permiso rp
      ON rp.rol_id = r.id
    JOIN public.permiso p
      ON p.id = rp.permiso_id
   WHERE ur.usuario_id = v_uid
     AND r.tenant_id = public.current_tenant_id()
     AND p.clave = p_clave
  )
  INTO v_allowed;

  RETURN COALESCE(v_allowed, false);
END;
$$;


ALTER FUNCTION "public"."has_permiso"("p_clave" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."has_permiso"("p_clave" "text") IS 'Evalúa permisos RBAC del usuario autenticado dentro del tenant efectivo.';



CREATE OR REPLACE FUNCTION "public"."lock_arca_config_for_update"("p_tenant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM 1 FROM public.arca_config WHERE tenant_id = p_tenant_id FOR UPDATE;
END;
$$;


ALTER FUNCTION "public"."lock_arca_config_for_update"("p_tenant_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."lock_arca_config_for_update"("p_tenant_id" "uuid") IS 'Serializa emisiones ARCA por tenant (SELECT FOR UPDATE sobre arca_config).';



CREATE OR REPLACE FUNCTION "public"."materializar_stock_sucursales_faltantes"("p_tenant_id" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_claim uuid;
  n bigint;
BEGIN
  v_claim := public.current_tenant_id();
  IF v_claim IS NOT NULL AND v_claim IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
  SELECT p.tenant_id, p.id, s.id, 0::numeric(12, 3), 0::numeric(12, 3), NULL::text
  FROM public.producto p
  INNER JOIN public.sucursal s
    ON s.tenant_id = p.tenant_id
    AND s.activa = true
  WHERE p.tenant_id = p_tenant_id
    AND p.activo = true
    AND p.sucursal_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.stock_sucursal ss
      WHERE ss.tenant_id = p.tenant_id
        AND ss.producto_id = p.id
        AND ss.sucursal_id = s.id
    )
  ON CONFLICT (producto_id, sucursal_id) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;


ALTER FUNCTION "public"."materializar_stock_sucursales_faltantes"("p_tenant_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."materializar_stock_sucursales_faltantes"("p_tenant_id" "uuid") IS 'Inserta filas faltantes en stock_sucursal (stock 0) para cada producto activo y sucursal activa del tenant.';



CREATE OR REPLACE FUNCTION "public"."normalizar_texto_buscable_db"("input" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT lower(unaccent('unaccent', coalesce(input, '')));
$$;


ALTER FUNCTION "public"."normalizar_texto_buscable_db"("input" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_tenant_access_code"("p_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '', 'g');
$$;


ALTER FUNCTION "public"."normalize_tenant_access_code"("p_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."proveedor_inactivo_desactiva_productos"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.producto p
  SET activo = false,
      updated_at = now()
  WHERE p.proveedor_id = NEW.id
    AND p.tenant_id = NEW.tenant_id
    AND p.activo = true;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."proveedor_inactivo_desactiva_productos"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."proveedor_inactivo_desactiva_productos"() IS 'Trigger: al desactivar proveedor, pone activo=false en productos con ese proveedor_id.';



CREATE OR REPLACE FUNCTION "public"."proveedor_set_sucursal_por_defecto"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_sucursal uuid;
BEGIN
  IF NEW.sucursal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.id INTO v_sucursal
  FROM public.sucursal s
  WHERE s.tenant_id = NEW.tenant_id
  ORDER BY s.id
  LIMIT 1;
  IF v_sucursal IS NULL THEN
    RAISE EXCEPTION 'sucursal: no hay fila para tenant_id=%, imposible asignar proveedor.sucursal_id', NEW.tenant_id
      USING ERRCODE = '23514';
  END IF;
  NEW.sucursal_id := v_sucursal;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."proveedor_set_sucursal_por_defecto"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."proveedor_set_sucursal_por_defecto"() IS 'Si proveedor.sucursal_id es NULL, asigna la primera sucursal del tenant.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."movimiento" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "tipo" "public"."tipo_movimiento" NOT NULL,
    "cantidad" numeric(12,3) NOT NULL,
    "stock_anterior" numeric(12,3) NOT NULL,
    "stock_posterior" numeric(12,3) NOT NULL,
    "motivo" "text",
    "referencia_tipo" "public"."referencia_tipo",
    "referencia_id" "uuid",
    "usuario_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    "proveedor_id" "uuid",
    CONSTRAINT "chk_movimiento_cantidad_segun_tipo" CHECK (((("tipo" = ANY (ARRAY['entrada'::"public"."tipo_movimiento", 'salida'::"public"."tipo_movimiento"])) AND ("cantidad" > (0)::numeric)) OR ("tipo" = 'ajuste'::"public"."tipo_movimiento")))
);


ALTER TABLE "public"."movimiento" OWNER TO "postgres";


COMMENT ON COLUMN "public"."movimiento"."proveedor_id" IS 'Proveedor que originó el movimiento (cuando aplica: entrada por importación / factura recibida / compra). NULL en ventas / ajustes / transferencias.';



CREATE OR REPLACE FUNCTION "public"."registrar_movimiento"("p_tenant_id" "uuid", "p_producto_id" "uuid", "p_sucursal_id" "uuid", "p_tipo" "public"."tipo_movimiento", "p_cantidad" numeric, "p_motivo" "text" DEFAULT NULL::"text", "p_referencia_tipo" "public"."referencia_tipo" DEFAULT NULL::"public"."referencia_tipo", "p_referencia_id" "uuid" DEFAULT NULL::"uuid", "p_usuario_id" "uuid" DEFAULT NULL::"uuid", "p_permitir_stock_negativo" boolean DEFAULT false, "p_proveedor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."movimiento"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_suc_producto    UUID;
  v_stock_anterior  NUMERIC(12, 3);
  v_stock_posterior NUMERIC(12, 3);
  v_movimiento      public.movimiento;
BEGIN
  IF p_cantidad IS NULL THEN
    RAISE EXCEPTION 'La cantidad no puede ser nula';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sucursal s
    WHERE s.id = p_sucursal_id
      AND s.tenant_id = p_tenant_id
      AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal inválida o inactiva para este negocio';
  END IF;

  SELECT p.sucursal_id INTO v_suc_producto
  FROM public.producto p
  WHERE p.id = p_producto_id AND p.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  IF v_suc_producto IS NULL THEN
    RAISE EXCEPTION 'Producto sin sucursal asignada';
  END IF;

  SELECT ss.stock_actual INTO v_stock_anterior
  FROM public.stock_sucursal ss
  WHERE ss.tenant_id = p_tenant_id
    AND ss.producto_id = p_producto_id
    AND ss.sucursal_id = p_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
    VALUES (p_tenant_id, p_producto_id, p_sucursal_id, 0, 0, NULL)
    ON CONFLICT (producto_id, sucursal_id) DO NOTHING;

    SELECT ss.stock_actual INTO v_stock_anterior
    FROM public.stock_sucursal ss
    WHERE ss.tenant_id = p_tenant_id
      AND ss.producto_id = p_producto_id
      AND ss.sucursal_id = p_sucursal_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se pudo inicializar stock_sucursal para el producto % en la sucursal %', p_producto_id, p_sucursal_id;
    END IF;
  END IF;

  CASE p_tipo
    WHEN 'entrada' THEN
      IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad de entrada debe ser mayor a cero';
      END IF;
      v_stock_posterior := v_stock_anterior + p_cantidad;
    WHEN 'salida' THEN
      IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad de salida debe ser mayor a cero';
      END IF;
      v_stock_posterior := v_stock_anterior - p_cantidad;
      IF NOT p_permitir_stock_negativo AND v_stock_posterior < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente. Actual: %, solicitado: %',
          v_stock_anterior, p_cantidad;
      END IF;
    WHEN 'ajuste' THEN
      v_stock_posterior := p_cantidad;
    ELSE
      RAISE EXCEPTION 'Tipo de movimiento no soportado: %', p_tipo;
  END CASE;

  UPDATE public.stock_sucursal ss
  SET stock_actual = v_stock_posterior, updated_at = NOW()
  WHERE ss.tenant_id = p_tenant_id
    AND ss.producto_id = p_producto_id
    AND ss.sucursal_id = p_sucursal_id;

  INSERT INTO public.movimiento (
    tenant_id,
    sucursal_id,
    producto_id,
    tipo,
    cantidad,
    stock_anterior,
    stock_posterior,
    motivo,
    referencia_tipo,
    referencia_id,
    usuario_id,
    proveedor_id
  ) VALUES (
    p_tenant_id,
    p_sucursal_id,
    p_producto_id,
    p_tipo,
    p_cantidad,
    v_stock_anterior,
    v_stock_posterior,
    p_motivo,
    p_referencia_tipo,
    p_referencia_id,
    p_usuario_id,
    p_proveedor_id
  ) RETURNING * INTO v_movimiento;

  RETURN v_movimiento;
END;
$$;


ALTER FUNCTION "public"."registrar_movimiento"("p_tenant_id" "uuid", "p_producto_id" "uuid", "p_sucursal_id" "uuid", "p_tipo" "public"."tipo_movimiento", "p_cantidad" numeric, "p_motivo" "text", "p_referencia_tipo" "public"."referencia_tipo", "p_referencia_id" "uuid", "p_usuario_id" "uuid", "p_permitir_stock_negativo" boolean, "p_proveedor_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pago" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "cliente_id" "uuid",
    "cuenta_id" "uuid" NOT NULL,
    "comprobante_id" "uuid",
    "monto" numeric(18,6) NOT NULL,
    "tipo_pago" "public"."tipo_pago" DEFAULT 'efectivo'::"public"."tipo_pago" NOT NULL,
    "referencia" "text",
    "notas" "text",
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "usuario_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "proveedor_id" "uuid",
    CONSTRAINT "chk_pago_cliente_x_proveedor" CHECK (((("cliente_id" IS NOT NULL) AND ("proveedor_id" IS NULL)) OR (("cliente_id" IS NULL) AND ("proveedor_id" IS NOT NULL)))),
    CONSTRAINT "chk_pago_monto_positivo" CHECK (("monto" > (0)::numeric))
);


ALTER TABLE "public"."pago" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_pago"("p_tenant_id" "uuid", "p_cliente_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago" DEFAULT 'efectivo'::"public"."tipo_pago", "p_comprobante_id" "uuid" DEFAULT NULL::"uuid", "p_referencia" "text" DEFAULT NULL::"text", "p_notas" "text" DEFAULT NULL::"text", "p_usuario_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."pago"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_cuenta  public.cuenta_corriente;
  v_pago    public.pago;
BEGIN
  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  INSERT INTO public.cuenta_corriente (tenant_id, cliente_id)
  VALUES (p_tenant_id, p_cliente_id)
  ON CONFLICT (tenant_id, cliente_id) WHERE cliente_id IS NOT NULL
  DO NOTHING;

  SELECT * INTO v_cuenta
  FROM public.cuenta_corriente
  WHERE tenant_id = p_tenant_id AND cliente_id = p_cliente_id
  FOR UPDATE;

  UPDATE public.cuenta_corriente
  SET saldo = saldo - p_monto
  WHERE id = v_cuenta.id;

  INSERT INTO public.pago (
    tenant_id, cliente_id, cuenta_id,
    comprobante_id, monto, tipo_pago,
    referencia, notas, usuario_id
  ) VALUES (
    p_tenant_id, p_cliente_id, v_cuenta.id,
    p_comprobante_id, p_monto, p_tipo_pago,
    p_referencia, p_notas, p_usuario_id
  ) RETURNING * INTO v_pago;

  RETURN v_pago;
END;
$$;


ALTER FUNCTION "public"."registrar_pago"("p_tenant_id" "uuid", "p_cliente_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_comprobante_id" "uuid", "p_referencia" "text", "p_notas" "text", "p_usuario_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_pago_cobranza"("p_cobranza_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago" DEFAULT 'efectivo'::"public"."tipo_pago", "p_notas" "text" DEFAULT NULL::"text", "p_usuario_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."registrar_pago_cobranza"("p_cobranza_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_notas" "text", "p_usuario_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_pago_cobranza"("p_cobranza_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_notas" "text", "p_usuario_id" "uuid") IS 'Registra cobro parcial/total o sobrepago: actualiza saldo, inserta cobranza_pago y el excedente queda como saldo a favor del cliente.';



CREATE OR REPLACE FUNCTION "public"."registrar_pago_cuenta_proveedor"("p_tenant_id" "uuid", "p_proveedor_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago" DEFAULT 'efectivo'::"public"."tipo_pago", "p_comprobante_id" "uuid" DEFAULT NULL::"uuid", "p_referencia" "text" DEFAULT NULL::"text", "p_notas" "text" DEFAULT NULL::"text", "p_usuario_id" "uuid" DEFAULT NULL::"uuid", "p_fecha" "date" DEFAULT NULL::"date") RETURNS "public"."pago"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cuenta public.cuenta_corriente;
  v_pago   public.pago;
  v_fecha  DATE := COALESCE(p_fecha, CURRENT_DATE);
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  INSERT INTO public.cuenta_corriente (tenant_id, cliente_id, proveedor_id, saldo, tipo_cuenta)
  VALUES (p_tenant_id, NULL, p_proveedor_id, 0, 'proveedor')
  ON CONFLICT (tenant_id, proveedor_id) WHERE proveedor_id IS NOT NULL
  DO NOTHING;

  SELECT * INTO v_cuenta
  FROM public.cuenta_corriente
  WHERE tenant_id = p_tenant_id AND proveedor_id = p_proveedor_id
  FOR UPDATE;

  IF v_cuenta IS NULL OR v_cuenta.proveedor_id IS NULL THEN
    RAISE EXCEPTION 'Cuenta corriente de proveedor no encontrada';
  END IF;

  UPDATE public.cuenta_corriente
  SET saldo = saldo - p_monto
  WHERE id = v_cuenta.id;

  INSERT INTO public.pago (
    tenant_id,
    cliente_id,
    proveedor_id,
    cuenta_id,
    comprobante_id,
    monto,
    tipo_pago,
    referencia,
    notas,
    usuario_id,
    fecha
  ) VALUES (
    p_tenant_id,
    NULL,
    p_proveedor_id,
    v_cuenta.id,
    p_comprobante_id,
    p_monto,
    p_tipo_pago,
    p_referencia,
    p_notas,
    p_usuario_id,
    v_fecha
  )
  RETURNING * INTO v_pago;

  RETURN v_pago;
END;
$$;


ALTER FUNCTION "public"."registrar_pago_cuenta_proveedor"("p_tenant_id" "uuid", "p_proveedor_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_comprobante_id" "uuid", "p_referencia" "text", "p_notas" "text", "p_usuario_id" "uuid", "p_fecha" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_pago_proveedor"("p_pago_proveedor_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago" DEFAULT 'efectivo'::"public"."tipo_pago", "p_notas" "text" DEFAULT NULL::"text", "p_usuario_id" "uuid" DEFAULT NULL::"uuid", "p_fecha" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
    RAISE EXCEPTION 'Obligación a proveedor no encontrada';
  END IF;

  IF v_row.estado = 'anulada' THEN
    RAISE EXCEPTION 'Obligación anulada';
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


ALTER FUNCTION "public"."registrar_pago_proveedor"("p_pago_proveedor_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_notas" "text", "p_usuario_id" "uuid", "p_fecha" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_pago_proveedor"("p_pago_proveedor_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_notas" "text", "p_usuario_id" "uuid", "p_fecha" "date") IS 'Pago a proveedor: actualiza obligacion, baja cuenta corriente y permite excedente como saldo a favor del tenant.';



CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."siguiente_numero_arca"("p_tenant_id" "uuid", "p_tipo" "public"."tipo_comprobante", "p_punto_de_venta" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_max_local integer;
BEGIN
  -- p_punto_de_venta reservado para futuro PdV por sucursal; hoy la numeración local no filtra por PdV en filas.
  SELECT COALESCE(MAX(c.numero), 0) INTO v_max_local
  FROM public.comprobante c
  WHERE c.tenant_id = p_tenant_id
    AND c.tipo = p_tipo
    AND c.numero IS NOT NULL
    AND c.cae IS NOT NULL;

  RETURN v_max_local + 1;
END;
$$;


ALTER FUNCTION "public"."siguiente_numero_arca"("p_tenant_id" "uuid", "p_tipo" "public"."tipo_comprobante", "p_punto_de_venta" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."siguiente_numero_comprobante"("p_tenant_id" "uuid", "p_sucursal_id" "uuid", "p_tipo" "public"."tipo_comprobante") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_siguiente integer;
BEGIN
  SELECT COALESCE(MAX(c.numero), 0) + 1
  INTO v_siguiente
  FROM public.comprobante c
  WHERE c.tenant_id = p_tenant_id
    AND c.sucursal_id = p_sucursal_id
    AND c.tipo = p_tipo
    AND c.numero IS NOT NULL
    AND c.numero > 0;

  RETURN v_siguiente;
END;
$$;


ALTER FUNCTION "public"."siguiente_numero_comprobante"("p_tenant_id" "uuid", "p_sucursal_id" "uuid", "p_tipo" "public"."tipo_comprobante") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."siguiente_numero_comprobante"("p_tenant_id" "uuid", "p_sucursal_id" "uuid", "p_tipo" "public"."tipo_comprobante") IS 'Devuelve el siguiente número de comprobante por tenant+sucursal+tipo (excluye NULL y números archivados negativos).';



CREATE OR REPLACE FUNCTION "public"."siguiente_numero_orden"("p_tenant_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_max_comp INTEGER;
  v_max_ped  INTEGER;
BEGIN
  SELECT COALESCE(MAX(numero_orden), 0) INTO v_max_comp
  FROM public.comprobante
  WHERE tenant_id = p_tenant_id;

  SELECT COALESCE(MAX(numero_orden), 0) INTO v_max_ped
  FROM public.pedido
  WHERE tenant_id = p_tenant_id;

  RETURN GREATEST(v_max_comp, v_max_ped) + 1;
END;
$$;


ALTER FUNCTION "public"."siguiente_numero_orden"("p_tenant_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."siguiente_numero_orden"("p_tenant_id" "uuid") IS 'Siguiente número de orden (scope tenant) considerando comprobante + pedido. Presupuestos, tickets, facturas y pedidos del mismo hecho comparten este valor.';



CREATE OR REPLACE FUNCTION "public"."siguiente_numero_ticket_caja"("p_tenant_id" "uuid", "p_caja_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_siguiente integer;
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      public.caja c
    WHERE
      c.id = p_caja_id
      AND c.tenant_id = p_tenant_id
      AND c.activa = true
  ) THEN
    RAISE EXCEPTION 'Caja % no existe, no pertenece al tenant % o está inactiva', p_caja_id, p_tenant_id;
  END IF;

  SELECT
    COALESCE(MAX(c.numero_caja), 0) + 1 INTO v_siguiente
  FROM
    public.comprobante c
  WHERE
    c.tenant_id = p_tenant_id
    AND c.tipo = 'ticket'::public.tipo_comprobante
    AND c.caja_uuid = p_caja_id;

  RETURN v_siguiente;
END;
$$;


ALTER FUNCTION "public"."siguiente_numero_ticket_caja"("p_tenant_id" "uuid", "p_caja_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."siguiente_numero_ticket_caja"("p_tenant_id" "uuid", "p_caja_id" "uuid") IS 'Siguiente número de ticket para la caja (correlativo por caja_uuid). Idempotencia vía uk_comprobante_ticket_caja_numero al insertar.';



CREATE OR REPLACE FUNCTION "public"."super_admin_set_tenant_contexto"("p_tenant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prev uuid;
  v_home uuid;
  v_super boolean;
  v_target uuid := p_tenant_id;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT u.tenant_contexto_id, u.tenant_id, u.es_super_admin
  INTO v_prev, v_home, v_super
  FROM public.usuario u
  WHERE u.id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  IF NOT v_super THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  IF v_target IS NOT NULL AND v_target <> v_home THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.super_admin_tenant_acceso s
      WHERE s.usuario_id = v_uid AND s.tenant_id = v_target
    ) THEN
      RAISE EXCEPTION 'Sin acceso a este negocio';
    END IF;
  END IF;

  IF v_target IS NOT NULL AND v_target = v_home THEN
    v_target := NULL;
  END IF;

  IF v_prev IS NOT DISTINCT FROM v_target THEN
    RETURN;
  END IF;

  PERFORM set_config('app.allow_tenant_contexto', 'true', true);

  UPDATE public.usuario u
  SET tenant_contexto_id = v_target
  WHERE u.id = v_uid;

  INSERT INTO public.super_admin_contexto_log (usuario_id, tenant_id_prev, tenant_id_next)
  VALUES (v_uid, v_prev, v_target);
END;
$$;


ALTER FUNCTION "public"."super_admin_set_tenant_contexto"("p_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tenant_crea_sucursal_por_defecto"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sucursal s WHERE s.tenant_id = NEW.id) THEN
    INSERT INTO public.sucursal (tenant_id, codigo, nombre, es_principal, activa)
    VALUES (NEW.id, 'CASA', 'Sucursal Principal', TRUE, TRUE);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."tenant_crea_sucursal_por_defecto"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."tenant_crea_sucursal_por_defecto"() IS 'Crea la sucursal CASA · Sucursal Principal al insertar un tenant (alineado con RBAC bootstrap).';



CREATE OR REPLACE FUNCTION "public"."tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::JSONB ->> 'tenant_id')::UUID,
    NULL
  );
$$;


ALTER FUNCTION "public"."tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transferir_stock_entre_depositos"("p_tenant_id" "uuid", "p_producto_id" "uuid", "p_sucursal_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_cantidad" numeric, "p_motivo" "text" DEFAULT NULL::"text", "p_usuario_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."transferir_stock_entre_depositos"("p_tenant_id" "uuid", "p_producto_id" "uuid", "p_sucursal_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_cantidad" numeric, "p_motivo" "text", "p_usuario_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transferir_stock_entre_sucursales"("p_tenant_id" "uuid", "p_producto_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_cantidad" numeric, "p_motivo" "text" DEFAULT NULL::"text", "p_usuario_id" "uuid" DEFAULT NULL::"uuid", "p_producto_destino_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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
    r_o.sucursal_id,
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
    r_d.sucursal_id,
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


ALTER FUNCTION "public"."transferir_stock_entre_sucursales"("p_tenant_id" "uuid", "p_producto_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_cantidad" numeric, "p_motivo" "text", "p_usuario_id" "uuid", "p_producto_destino_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_cliente_ensure_membresia_sucursal"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.cliente_sucursal (tenant_id, cliente_id, sucursal_id)
  VALUES (NEW.tenant_id, NEW.id, NEW.sucursal_id)
  ON CONFLICT ON CONSTRAINT uq_cliente_sucursal_cliente_sucursal DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_cliente_ensure_membresia_sucursal"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."trg_cliente_ensure_membresia_sucursal"() IS 'Crea membresía en cliente_sucursal al insertar cliente (alinea con cliente.sucursal_id).';



CREATE OR REPLACE FUNCTION "public"."trg_producto_after_insert_stock_sucursal"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.sucursal_id IS NOT NULL THEN
    INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
    VALUES (NEW.tenant_id, NEW.id, NEW.sucursal_id, NEW.stock_actual, NEW.stock_minimo, NEW.ubicacion)
    ON CONFLICT (producto_id, sucursal_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_producto_after_insert_stock_sucursal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_producto_after_update_sync_stock_sucursal"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.sucursal_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('app.suppress_stock_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('app.suppress_stock_sync', 'on', true);
  UPDATE public.stock_sucursal ss
  SET
    stock_actual = NEW.stock_actual,
    stock_minimo = NEW.stock_minimo,
    ubicacion = NEW.ubicacion,
    updated_at = NOW()
  WHERE ss.producto_id = NEW.id
    AND ss.sucursal_id = NEW.sucursal_id
    AND ss.tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
    VALUES (NEW.tenant_id, NEW.id, NEW.sucursal_id, NEW.stock_actual, NEW.stock_minimo, NEW.ubicacion)
    ON CONFLICT (producto_id, sucursal_id) DO NOTHING;
  END IF;
  PERFORM set_config('app.suppress_stock_sync', '', true);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_producto_after_update_sync_stock_sucursal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_producto_lote_refresh_vencimiento"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_producto_id UUID;
  v_proxima DATE;
  v_existe BOOLEAN;
BEGIN
  v_producto_id := COALESCE(NEW.producto_id, OLD.producto_id);
  IF v_producto_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.producto_lote_ingreso
    WHERE producto_id = v_producto_id
      AND cantidad > 0
      AND fecha_vencimiento IS NOT NULL
  ) INTO v_existe;

  IF v_existe THEN
    SELECT MIN(fecha_vencimiento) INTO v_proxima
    FROM public.producto_lote_ingreso
    WHERE producto_id = v_producto_id
      AND cantidad > 0
      AND fecha_vencimiento IS NOT NULL;

    UPDATE public.producto
    SET fecha_vencimiento = v_proxima
    WHERE id = v_producto_id
      AND fecha_vencimiento IS DISTINCT FROM v_proxima;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."trg_producto_lote_refresh_vencimiento"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_stock_sucursal_after_update_sync_producto"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF COALESCE(current_setting('app.suppress_stock_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('app.suppress_stock_sync', 'on', true);
  UPDATE public.producto p
  SET
    stock_actual = NEW.stock_actual,
    stock_minimo = NEW.stock_minimo,
    ubicacion = NEW.ubicacion,
    updated_at = NOW()
  WHERE p.id = NEW.producto_id
    AND p.sucursal_id = NEW.sucursal_id
    AND p.tenant_id = NEW.tenant_id;
  PERFORM set_config('app.suppress_stock_sync', '', true);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_stock_sucursal_after_update_sync_producto"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."usuario_guard_tenant_contexto"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.tenant_contexto_id IS DISTINCT FROM OLD.tenant_contexto_id THEN
    IF current_setting('app.allow_tenant_contexto', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'tenant_contexto_id solo puede cambiarse vía super_admin_set_tenant_contexto';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."usuario_guard_tenant_contexto"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."usuario_puede_operar_sucursal"("p_sucursal_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_allowed BOOLEAN := false;
BEGIN
  IF v_uid IS NULL OR p_sucursal_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.usuario u
    JOIN public.sucursal s ON s.id = p_sucursal_id
    WHERE u.id = v_uid
      AND u.es_super_admin = true
      AND s.tenant_id = public.current_tenant_id()
  ) THEN
    RETURN true;
  END IF;

  IF public.has_permiso('sucursales.ver_todas') THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.sucursal s
      WHERE s.id = p_sucursal_id
        AND s.tenant_id = public.current_tenant_id()
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.usuario_sucursal us
    JOIN public.sucursal s ON s.id = us.sucursal_id
    WHERE us.usuario_id = v_uid
      AND us.sucursal_id = p_sucursal_id
      AND s.tenant_id = public.current_tenant_id()
  )
  INTO v_allowed;

  IF COALESCE(v_allowed, false) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.usuario u
    INNER JOIN public.sucursal s ON s.id = u.sucursal_default_id
    WHERE u.id = v_uid
      AND u.sucursal_default_id = p_sucursal_id
      AND s.tenant_id = public.current_tenant_id()
      AND s.activa = true
  );
END;
$$;


ALTER FUNCTION "public"."usuario_puede_operar_sucursal"("p_sucursal_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."usuario_puede_operar_sucursal"("p_sucursal_id" "uuid") IS 'Valida acceso del usuario autenticado a una sucursal del tenant efectivo.';



CREATE TABLE IF NOT EXISTS "public"."arca_config" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "certificado_pem" "text",
    "clave_privada_pem" "text",
    "cuit_emisor" character varying(13),
    "punto_de_venta" integer,
    "ambiente" "public"."arca_ambiente" DEFAULT 'homologacion'::"public"."arca_ambiente" NOT NULL,
    "ticket_acceso" "text",
    "ticket_sign" "text",
    "ticket_expiracion" timestamp with time zone,
    "ultimo_comprobante" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sucursal_id" "uuid" NOT NULL
);


ALTER TABLE "public"."arca_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."arca_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "servicio" character varying(10) NOT NULL,
    "operacion" character varying(50) NOT NULL,
    "request_xml" "text",
    "response_xml" "text",
    "comprobante_id" "uuid",
    "exitoso" boolean DEFAULT false NOT NULL,
    "error_codigo" character varying(20),
    "error_mensaje" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."arca_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."caja" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    "numero" integer NOT NULL,
    "nombre" "text" NOT NULL,
    "usuario_default_id" "uuid",
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mp_point_config_id" "uuid",
    "mp_qr_config_id" "uuid",
    "auto_cierre_horas" integer,
    CONSTRAINT "chk_caja_auto_cierre_horas_rango" CHECK ((("auto_cierre_horas" IS NULL) OR (("auto_cierre_horas" >= 1) AND ("auto_cierre_horas" <= 168)))),
    CONSTRAINT "chk_caja_numero_positivo" CHECK (("numero" > 0))
);


ALTER TABLE "public"."caja" OWNER TO "postgres";


COMMENT ON TABLE "public"."caja" IS 'Punto de venta / caja lógica por sucursal (Plan cajas usuario). Numeración de tickets por caja en fases posteriores.';



COMMENT ON COLUMN "public"."caja"."mp_point_config_id" IS 'Conexión Mercado Pago Point que esta caja usa al cobrar. NULL = no se ofrece Posnet en esta caja.';



COMMENT ON COLUMN "public"."caja"."mp_qr_config_id" IS 'Conexión Mercado Pago QR que esta caja usa al cobrar. NULL = no se ofrece QR en esta caja.';



COMMENT ON COLUMN "public"."caja"."auto_cierre_horas" IS 'Si no es NULL, tras esta cantidad de horas desde el turno abierto el POS puede ejecutar cierre Z automático (efectivo contado = esperado sistema).';



CREATE TABLE IF NOT EXISTS "public"."caja_apertura" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "caja_id" "text" DEFAULT '__sin_caja__'::"text" NOT NULL,
    "fecha_operativa" "date" NOT NULL,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fondo_efectivo" numeric(18,6) NOT NULL,
    "notas" "text",
    "usuario_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    CONSTRAINT "chk_caja_apertura_fondo" CHECK (("fondo_efectivo" >= (0)::numeric))
);


ALTER TABLE "public"."caja_apertura" OWNER TO "postgres";


COMMENT ON TABLE "public"."caja_apertura" IS 'Fondo en efectivo declarado al abrir la caja tras el último cierre Z diario; el cierre en modo sesión usa opened_at como inicio del período.';



CREATE TABLE IF NOT EXISTS "public"."caja_gasto" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    "caja_id" "text" NOT NULL,
    "caja_apertura_id" "uuid" NOT NULL,
    "concepto" "text" NOT NULL,
    "monto" numeric(18,6) NOT NULL,
    "usuario_id" "uuid",
    "cierre_z_id" "uuid",
    "anulado_at" timestamp with time zone,
    "anulado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_caja_gasto_monto" CHECK (("monto" > (0)::numeric))
);


ALTER TABLE "public"."caja_gasto" OWNER TO "postgres";


COMMENT ON TABLE "public"."caja_gasto" IS 'Egresos en efectivo anotados durante el turno POS; se incluyen automáticamente en el arqueo del cierre Z diario.';



CREATE TABLE IF NOT EXISTS "public"."caja_turno" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "caja_id" "uuid" NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "estado" "text" NOT NULL,
    "abierto_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cerrado_at" timestamp with time zone,
    "monto_inicial" numeric(12,2) DEFAULT 0 NOT NULL,
    "cierre_z_id" "uuid",
    "notas" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "caja_turno_estado_check" CHECK (("estado" = ANY (ARRAY['abierto'::"text", 'cerrado'::"text"]))),
    CONSTRAINT "caja_turno_monto_inicial_check" CHECK (("monto_inicial" >= (0)::numeric))
);


ALTER TABLE "public"."caja_turno" OWNER TO "postgres";


COMMENT ON TABLE "public"."caja_turno" IS 'Turno de caja: apertura explícita hasta cierre Z (Plan cajas usuario).';



CREATE TABLE IF NOT EXISTS "public"."caja_usuario" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "caja_id" "uuid" NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."caja_usuario" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categoria" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    "texto_buscable" "text" GENERATED ALWAYS AS ("public"."normalizar_texto_buscable_db"("nombre")) STORED
);


ALTER TABLE "public"."categoria" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cierre_mensual" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "periodo" "text" NOT NULL,
    "ingresos_brutos" numeric(18,6) DEFAULT 0 NOT NULL,
    "costo_mercaderia" numeric(18,6) DEFAULT 0 NOT NULL,
    "margen_bruto" numeric(18,6) DEFAULT 0 NOT NULL,
    "margen_bruto_pct" numeric(12,6),
    "unidades_vendidas" integer DEFAULT 0 NOT NULL,
    "comprobantes_emitidos" integer DEFAULT 0 NOT NULL,
    "ticket_promedio" numeric(18,6),
    "top_productos" "jsonb",
    "por_categoria" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cierre_mensual" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cierre_z" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "caja_id" "text" DEFAULT '__sin_caja__'::"text" NOT NULL,
    "fecha_operativa" "date" NOT NULL,
    "tipo_cierre" "text" DEFAULT 'diario'::"text" NOT NULL,
    "rango_desde" timestamp with time zone NOT NULL,
    "rango_hasta" timestamp with time zone NOT NULL,
    "total_comprobantes" integer DEFAULT 0 NOT NULL,
    "ventas_brutas" numeric(18,6) DEFAULT 0 NOT NULL,
    "notas_credito_total" numeric(18,6) DEFAULT 0 NOT NULL,
    "ventas_netas" numeric(18,6) DEFAULT 0 NOT NULL,
    "pagos_cta_cte_total" numeric(18,6) DEFAULT 0 NOT NULL,
    "usuario_cierre_id" "uuid",
    "payload_resumen" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "caja_apertura_id" "uuid",
    "sucursal_id" "uuid" NOT NULL,
    CONSTRAINT "chk_cierre_z_rango" CHECK (("rango_hasta" >= "rango_desde")),
    CONSTRAINT "chk_cierre_z_tipo" CHECK (("tipo_cierre" = ANY (ARRAY['diario'::"text", 'parcial'::"text"])))
);


ALTER TABLE "public"."cierre_z" OWNER TO "postgres";


COMMENT ON TABLE "public"."cierre_z" IS 'Snapshot de cierre Z por caja/fecha. Inmutable: no se recalcula sobre el mismo scope.';



COMMENT ON COLUMN "public"."cierre_z"."caja_apertura_id" IS 'Sesión de caja: cierre diario vinculado a la apertura; permite múltiples cierres el mismo día operativo.';



CREATE TABLE IF NOT EXISTS "public"."cierre_z_medio_pago" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "cierre_z_id" "uuid" NOT NULL,
    "metodo_pago" "text" NOT NULL,
    "monto_neto" numeric(18,6) DEFAULT 0 NOT NULL,
    "cantidad_comprobantes" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cierre_z_medio_pago" OWNER TO "postgres";


COMMENT ON TABLE "public"."cierre_z_medio_pago" IS 'Desglose del cierre Z por método de pago (monto neto y cantidad de comprobantes).';



CREATE TABLE IF NOT EXISTS "public"."cliente" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "razon_social" "text",
    "cuit_dni" character varying(13),
    "condicion_iva" "public"."condicion_iva" DEFAULT 'consumidor_final'::"public"."condicion_iva" NOT NULL,
    "direccion" "text",
    "telefono" character varying(20),
    "email" character varying(255),
    "notas" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    "documento_fiscal_tipo" "public"."cliente_documento_fiscal"
);


ALTER TABLE "public"."cliente" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cliente"."documento_fiscal_tipo" IS 'Si está definido, AFIP usa este tipo de documento del receptor (80 CUIT / 96 DNI) aunque el número no coincida con la heurística por cantidad de dígitos. NULL = inferir por dígitos (comportamiento previo).';



CREATE TABLE IF NOT EXISTS "public"."cliente_sucursal" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cliente_sucursal" OWNER TO "postgres";


COMMENT ON TABLE "public"."cliente_sucursal" IS 'Membresía cliente–sucursal: donde el cliente está habilitado. cliente.sucursal_id replica una sucursal canónica (p. ej. alta) dentro del conjunto.';



CREATE TABLE IF NOT EXISTS "public"."cobranza_factura" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "comprobante_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "monto_original" numeric(18,6) NOT NULL,
    "saldo_pendiente" numeric(18,6) NOT NULL,
    "vencimiento_at" timestamp with time zone NOT NULL,
    "recordatorio_snooze_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_cobranza_monto_pos" CHECK (("monto_original" > (0)::numeric)),
    CONSTRAINT "chk_cobranza_saldo_no_neg" CHECK (("saldo_pendiente" >= (0)::numeric))
);


ALTER TABLE "public"."cobranza_factura" OWNER TO "postgres";


COMMENT ON TABLE "public"."cobranza_factura" IS 'Seguimiento de cobro por factura: saldo, vencimiento renovable en pagos parciales, snooze de recordatorio.';



CREATE TABLE IF NOT EXISTS "public"."cobranza_pago" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "cobranza_factura_id" "uuid" NOT NULL,
    "monto" numeric(18,6) NOT NULL,
    "tipo_pago" "public"."tipo_pago" DEFAULT 'efectivo'::"public"."tipo_pago" NOT NULL,
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "usuario_id" "uuid",
    "notas" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recibo_comprobante_id" "uuid",
    CONSTRAINT "chk_cobranza_pago_monto_pos" CHECK (("monto" > (0)::numeric))
);


ALTER TABLE "public"."cobranza_pago" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cobranza_pago"."recibo_comprobante_id" IS 'Comprobante tipo recibo emitido por este cobro (PDF interno, sin ARCA).';



CREATE TABLE IF NOT EXISTS "public"."comprobante" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "tipo" "public"."tipo_comprobante" NOT NULL,
    "numero" integer,
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "cliente_id" "uuid",
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "iva_monto" numeric(12,2) DEFAULT 0 NOT NULL,
    "iva_porcentaje" numeric(5,2) DEFAULT 21.00 NOT NULL,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "estado" "public"."estado_comprobante" DEFAULT 'borrador'::"public"."estado_comprobante" NOT NULL,
    "cae" character varying(20),
    "cae_vencimiento" "date",
    "pdf_url" "text",
    "notas" "text",
    "usuario_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metodo_pago" character varying(20),
    "metodo_pago_detalle" "jsonb",
    "caja_id" "text",
    "total_mercaderia" numeric(18,4),
    "medio_pago_opcion_id" "uuid",
    "financiacion_monto" numeric(18,4),
    "financiacion_porcentaje" numeric(12,4),
    "financiacion_descripcion" "text",
    "fiscalizado_por_id" "uuid",
    "numero_orden" integer NOT NULL,
    "mp_point_intent_id" "text",
    "mp_point_payment_id" bigint,
    "tipo_operacion" "text" DEFAULT 'venta'::"text" NOT NULL,
    "proveedor_id" "uuid",
    "fecha_vencimiento_pago" "date",
    "descuento_global_pct" numeric DEFAULT 0 NOT NULL,
    "recargo_global_pct" numeric DEFAULT 0 NOT NULL,
    "descuento_global_monto" numeric DEFAULT 0 NOT NULL,
    "recargo_global_monto" numeric DEFAULT 0 NOT NULL,
    "imp_trib_comercial" numeric DEFAULT 0 NOT NULL,
    "impuesto_interno_monto" numeric(12,2) DEFAULT 0 NOT NULL,
    "percepcion_iibb_monto" numeric(12,2) DEFAULT 0 NOT NULL,
    "percepcion_iva_monto" numeric(12,2) DEFAULT 0 NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    "intentos_arca" integer DEFAULT 0 NOT NULL,
    "ultimo_error_arca_codigo" character varying(20),
    "ultimo_error_arca_mensaje" "text",
    "ultimo_intento_arca_at" timestamp with time zone,
    "documento_asociado_id" "uuid",
    "mp_qr_order_id" "text",
    "mp_qr_payment_id" bigint,
    "mp_qr_pago_huerfano" boolean DEFAULT false NOT NULL,
    "mp_qr_cancelado_at" timestamp with time zone,
    "caja_uuid" "uuid",
    "caja_turno_id" "uuid",
    "numero_caja" integer,
    CONSTRAINT "chk_comprobante_numero_orden_positivo" CHECK (("numero_orden" > 0)),
    CONSTRAINT "chk_comprobante_tipo_operacion" CHECK (("tipo_operacion" = ANY (ARRAY['venta'::"text", 'compra'::"text"]))),
    CONSTRAINT "chk_emitido_fiscal_tiene_numero" CHECK ((NOT (("tipo" = ANY (ARRAY['factura_a'::"public"."tipo_comprobante", 'factura_b'::"public"."tipo_comprobante", 'factura_c'::"public"."tipo_comprobante", 'nota_credito_a'::"public"."tipo_comprobante", 'nota_credito_b'::"public"."tipo_comprobante", 'nota_credito_c'::"public"."tipo_comprobante"])) AND ("estado" = 'emitido'::"public"."estado_comprobante") AND ("numero" IS NULL)))),
    CONSTRAINT "chk_pendiente_arca_sin_numero" CHECK ((("estado" <> ALL (ARRAY['pendiente_arca'::"public"."estado_comprobante", 'error_arca'::"public"."estado_comprobante"])) OR ("numero" IS NULL))),
    CONSTRAINT "chk_comprobante_impuesto_interno_nonneg" CHECK (("impuesto_interno_monto" >= (0)::numeric)),
    CONSTRAINT "chk_comprobante_percepciones_nonneg" CHECK ((("percepcion_iibb_monto" >= (0)::numeric) AND ("percepcion_iva_monto" >= (0)::numeric))),
    CONSTRAINT "chk_ticket_numero_caja" CHECK (((NOT (("tipo" = 'ticket'::"public"."tipo_comprobante") AND ("caja_uuid" IS NOT NULL))) OR ("numero_caja" IS NOT NULL))),
    CONSTRAINT "comprobante_global_desc_rec_check" CHECK ((("descuento_global_pct" >= (0)::numeric) AND ("descuento_global_pct" <= (100)::numeric) AND ("recargo_global_pct" >= (0)::numeric) AND ("recargo_global_pct" <= (100)::numeric) AND ("descuento_global_monto" >= (0)::numeric) AND ("recargo_global_monto" >= (0)::numeric) AND ("imp_trib_comercial" >= (0)::numeric)))
);


ALTER TABLE "public"."comprobante" OWNER TO "postgres";


COMMENT ON COLUMN "public"."comprobante"."caja_id" IS 'Identificador de caja en cierre (p. ej. __sin_caja__) o ID terminal MP / POS; sin límite corto.';



COMMENT ON COLUMN "public"."comprobante"."total_mercaderia" IS 'Total de mercadería (antes de recargo/descuento por medio de pago). Si NULL, no hubo financiación explícita.';



COMMENT ON COLUMN "public"."comprobante"."financiacion_monto" IS 'Monto del ajuste: positivo recargo, negativo descuento. ImpTrib ARCA solo si > 0.';



COMMENT ON COLUMN "public"."comprobante"."fiscalizado_por_id" IS 'Si el comprobante es un ticket, ID del comprobante fiscal (factura) emitido para sustituirlo.';



COMMENT ON COLUMN "public"."comprobante"."numero_orden" IS 'Orden de venta interna por tenant. Mismo valor en ticket y en la factura fiscal emitida desde ese ticket.';



COMMENT ON COLUMN "public"."comprobante"."mp_point_intent_id" IS 'ID del payment intent en API Mercado Pago Point (correlación webhook / cancelar).';



COMMENT ON COLUMN "public"."comprobante"."mp_point_payment_id" IS 'ID del pago aprobado en Mercado Pago cuando el cobro en terminal finaliza OK.';



COMMENT ON COLUMN "public"."comprobante"."tipo_operacion" IS 'venta: flujo de emisión habitual; compra: factura recibida / importada (Plan H).';



COMMENT ON COLUMN "public"."comprobante"."proveedor_id" IS 'Proveedor asociado cuando tipo_operacion = compra (factura recibida).';



COMMENT ON COLUMN "public"."comprobante"."fecha_vencimiento_pago" IS 'Vencimiento de pago explícito de la operación; si está definido, prevalece sobre las reglas de cuenta corriente al generar cobranza_factura.';



COMMENT ON COLUMN "public"."comprobante"."descuento_global_pct" IS 'Descuento % sobre total de mercadería (post ítems), antes de financiación por medio de pago.';



COMMENT ON COLUMN "public"."comprobante"."recargo_global_pct" IS 'Recargo % sobre total de mercadería (post ítems).';



COMMENT ON COLUMN "public"."comprobante"."descuento_global_monto" IS 'Descuento fijo en $ sobre total de mercadería (post %).';



COMMENT ON COLUMN "public"."comprobante"."recargo_global_monto" IS 'Recargo fijo en $ sobre total de mercadería (post %).';



COMMENT ON COLUMN "public"."comprobante"."imp_trib_comercial" IS 'Importe informado como ImpTrib (tributo 99) por recargos comerciales globales.';



COMMENT ON COLUMN "public"."comprobante"."impuesto_interno_monto" IS 'Impuestos internos informados en facturas de compra importadas o cargadas manualmente.';



COMMENT ON COLUMN "public"."comprobante"."percepcion_iibb_monto" IS 'Percepciones de Ingresos Brutos informadas en facturas de compra importadas o cargadas manualmente.';



COMMENT ON COLUMN "public"."comprobante"."percepcion_iva_monto" IS 'Percepciones de IVA informadas en facturas de compra importadas o cargadas manualmente.';



COMMENT ON COLUMN "public"."comprobante"."intentos_arca" IS 'Intentos de solicitud CAE (WSFE); fuente principal para tope de reintentos.';



COMMENT ON COLUMN "public"."comprobante"."ultimo_error_arca_codigo" IS 'Código AFIP u observación del último rechazo o NETWORK.';



COMMENT ON COLUMN "public"."comprobante"."documento_asociado_id" IS 'Comprobante asociado (p. ej. factura A/B/C referenciada por una nota de crédito). Usado en ARCA CbtesAsoc y en reintentos de CAE.';



COMMENT ON COLUMN "public"."comprobante"."mp_qr_order_id" IS 'ID merchant_order de MP (correlación webhook / estado).';



COMMENT ON COLUMN "public"."comprobante"."mp_qr_payment_id" IS 'ID del pago aprobado en MP tras cobro QR.';



COMMENT ON COLUMN "public"."comprobante"."mp_qr_pago_huerfano" IS 'Pago aprobado en MP luego de cancelación local (revisar / devolver).';



COMMENT ON COLUMN "public"."comprobante"."caja_uuid" IS 'FK a caja (UUID). Convive con caja_id TEXT hasta migración de cleanup.';



COMMENT ON COLUMN "public"."comprobante"."caja_turno_id" IS 'Turno de caja activo al emitir el ticket (fase POS).';



COMMENT ON COLUMN "public"."comprobante"."numero_caja" IS 'Correlativo de ticket por caja; comprobantes fiscales siguen usando numero.';



CREATE TABLE IF NOT EXISTS "public"."comprobante_item" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "comprobante_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "cantidad" numeric(12,3) NOT NULL,
    "precio_unitario" numeric(12,2) NOT NULL,
    "subtotal" numeric(12,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "precio_costo" numeric(18,6) DEFAULT 0,
    "promocion_id" "uuid",
    "promocion_descripcion" "text",
    "precio_unitario_original" numeric(12,2),
    "descuento_promo_monto" numeric(12,2),
    "descuento_manual_pct" numeric DEFAULT 0 NOT NULL,
    "recargo_manual_pct" numeric DEFAULT 0 NOT NULL,
    CONSTRAINT "chk_item_positivo" CHECK ((("cantidad" > (0)::numeric) AND ("precio_unitario" >= (0)::numeric) AND ("subtotal" >= (0)::numeric))),
    CONSTRAINT "comprobante_item_desc_rec_pct_check" CHECK ((("descuento_manual_pct" >= (0)::numeric) AND ("descuento_manual_pct" <= (100)::numeric) AND ("recargo_manual_pct" >= (0)::numeric) AND ("recargo_manual_pct" <= (100)::numeric)))
);


ALTER TABLE "public"."comprobante_item" OWNER TO "postgres";


COMMENT ON COLUMN "public"."comprobante_item"."precio_unitario_original" IS 'Precio unitario antes de promo; NULL si no hubo promoción en la línea.';



COMMENT ON COLUMN "public"."comprobante_item"."descuento_promo_monto" IS 'Ahorro total de la línea por promoción al momento de emitir.';



COMMENT ON COLUMN "public"."comprobante_item"."descuento_manual_pct" IS 'Descuento manual sobre precio unitario (post-promo), 0–100.';



COMMENT ON COLUMN "public"."comprobante_item"."recargo_manual_pct" IS 'Recargo manual sobre precio unitario (post-promo), 0–100.';



CREATE TABLE IF NOT EXISTS "public"."cuenta_corriente" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "cliente_id" "uuid",
    "saldo" numeric(18,6) DEFAULT 0 NOT NULL,
    "limite_credito" numeric(18,6),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "proveedor_id" "uuid",
    "tipo_cuenta" "public"."tipo_cuenta_corriente" DEFAULT 'cliente'::"public"."tipo_cuenta_corriente" NOT NULL,
    "cobro_modalidad" "public"."cobro_modalidad" DEFAULT 'por_comprobante'::"public"."cobro_modalidad" NOT NULL,
    "cobro_dias_plazo" integer DEFAULT 7 NOT NULL,
    "cobro_periodicidad" "public"."cobro_periodicidad",
    "cobro_monto_minimo" numeric(18,6) DEFAULT 0 NOT NULL,
    "cobro_dia_vencimiento_mes" smallint,
    CONSTRAINT "chk_cuenta_corriente_cobro_coherente" CHECK (((("cobro_modalidad" = 'por_comprobante'::"public"."cobro_modalidad") AND ("cobro_periodicidad" IS NULL) AND ("cobro_dia_vencimiento_mes" IS NULL)) OR (("cobro_modalidad" = 'periodico'::"public"."cobro_modalidad") AND ("cobro_periodicidad" IS NOT NULL) AND ("cobro_dia_vencimiento_mes" IS NULL)) OR (("cobro_modalidad" = 'dia_fijo_mes'::"public"."cobro_modalidad") AND ("cobro_periodicidad" IS NULL) AND ("cobro_dia_vencimiento_mes" IS NOT NULL)))),
    CONSTRAINT "chk_cuenta_corriente_dia_mes_rango" CHECK ((("cobro_dia_vencimiento_mes" IS NULL) OR (("cobro_dia_vencimiento_mes" >= 1) AND ("cobro_dia_vencimiento_mes" <= 31)))),
    CONSTRAINT "chk_cuenta_corriente_dias_plazo_rango" CHECK ((("cobro_dias_plazo" >= 1) AND ("cobro_dias_plazo" <= 3650))),
    CONSTRAINT "chk_cuenta_corriente_monto_minimo_no_neg" CHECK (("cobro_monto_minimo" >= (0)::numeric)),
    CONSTRAINT "chk_cuenta_corriente_parte" CHECK (((("cliente_id" IS NOT NULL) AND ("proveedor_id" IS NULL)) OR (("cliente_id" IS NULL) AND ("proveedor_id" IS NOT NULL)))),
    CONSTRAINT "chk_cuenta_corriente_tipo_segun_parte" CHECK (((("cliente_id" IS NOT NULL) AND ("proveedor_id" IS NULL) AND ("tipo_cuenta" = ANY (ARRAY['cliente'::"public"."tipo_cuenta_corriente", 'empleado'::"public"."tipo_cuenta_corriente"]))) OR (("proveedor_id" IS NOT NULL) AND ("cliente_id" IS NULL) AND ("tipo_cuenta" = 'proveedor'::"public"."tipo_cuenta_corriente"))))
);


ALTER TABLE "public"."cuenta_corriente" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cuenta_corriente"."proveedor_id" IS 'Cuenta corriente a pagar (proveedor). Mutuamente excluyente con cliente_id.';



COMMENT ON COLUMN "public"."cuenta_corriente"."tipo_cuenta" IS 'Clasificación: cliente o empleado (cuentas a cobrar) o proveedor (cuenta a pagar). Debe alinearse con cliente_id o proveedor_id.';



COMMENT ON COLUMN "public"."cuenta_corriente"."cobro_modalidad" IS 'por_comprobante: plazo en días desde la emisión; periodico: vencimiento según periodicidad.';



COMMENT ON COLUMN "public"."cuenta_corriente"."cobro_dias_plazo" IS 'Días hasta el vencimiento cuando cobro_modalidad = por_comprobante (ignorado en periodico).';



COMMENT ON COLUMN "public"."cuenta_corriente"."cobro_periodicidad" IS 'Solo si cobro_modalidad = periodico: ritmo de vencimiento (mapeado a días en la app).';



COMMENT ON COLUMN "public"."cuenta_corriente"."cobro_monto_minimo" IS 'Monto mínimo por cobro (salvo liquidación total del saldo de la factura).';



COMMENT ON COLUMN "public"."cuenta_corriente"."cobro_dia_vencimiento_mes" IS 'Si cobro_modalidad = dia_fijo_mes: día del mes (1–31) para el próximo vencimiento desde la emisión.';



CREATE TABLE IF NOT EXISTS "public"."importacion_archivo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "carga_id" "uuid" NOT NULL,
    "archivo_nombre" "text" NOT NULL,
    "archivo_mime" "text",
    "archivo_bytes" "bytea" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."importacion_archivo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."importacion_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "proveedor_id" "uuid",
    "archivo_nombre" "text",
    "origen" "public"."origen_precio" DEFAULT 'importacion_excel'::"public"."origen_precio" NOT NULL,
    "total_filas" integer DEFAULT 0 NOT NULL,
    "filas_exitosas" integer DEFAULT 0 NOT NULL,
    "filas_con_error" integer DEFAULT 0 NOT NULL,
    "productos_creados" integer DEFAULT 0 NOT NULL,
    "productos_actualizados" integer DEFAULT 0 NOT NULL,
    "detalle_errores" "jsonb" DEFAULT '[]'::"jsonb",
    "usuario_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sucursal_id" "uuid",
    "carga_id" "uuid",
    "archivo_storage_path" "text",
    "archivo_mime" "text",
    "archivo_tamano" bigint
);


ALTER TABLE "public"."importacion_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lector_factura_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "archivo_url" "text" NOT NULL,
    "archivo_nombre" "text" NOT NULL,
    "archivo_mime" "text" NOT NULL,
    "archivo_tamano" integer NOT NULL,
    "gemini_raw" "jsonb",
    "datos_extraidos" "jsonb",
    "direccion" "text" DEFAULT 'desconocida'::"text" NOT NULL,
    "estado" "text" DEFAULT 'extraido'::"text" NOT NULL,
    "comprobante_id" "uuid",
    "proveedor_id" "uuid",
    "cliente_id" "uuid",
    "error_mensaje" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_lector_factura_log_direccion" CHECK (("direccion" = ANY (ARRAY['recibida'::"text", 'emitida'::"text", 'desconocida'::"text"]))),
    CONSTRAINT "chk_lector_factura_log_estado" CHECK (("estado" = ANY (ARRAY['extraido'::"text", 'confirmado'::"text", 'descartado'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."lector_factura_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lista_precios" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "proveedor_id" "uuid" NOT NULL,
    "usuario_id" "uuid",
    "nombre_archivo" "text" NOT NULL,
    "mime_type" "text",
    "storage_bucket" "text" DEFAULT 'listas-precios'::"text" NOT NULL,
    "storage_path" "text",
    "origen_extraccion" "public"."origen_precio" NOT NULL,
    "fecha_recepcion" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fecha_vigencia_desde" "date",
    "fecha_vigencia_hasta" "date",
    "estado" "public"."estado_lista_precios" DEFAULT 'pendiente'::"public"."estado_lista_precios" NOT NULL,
    "error_mensaje" "text",
    "total_items" integer DEFAULT 0 NOT NULL,
    "items_matcheados_seguros" integer DEFAULT 0 NOT NULL,
    "items_matcheados_dudosos" integer DEFAULT 0 NOT NULL,
    "items_sin_match" integer DEFAULT 0 NOT NULL,
    "items_con_aumento" integer DEFAULT 0 NOT NULL,
    "items_con_baja" integer DEFAULT 0 NOT NULL,
    "items_sin_cambio" integer DEFAULT 0 NOT NULL,
    "variacion_promedio_pct" numeric(12,6),
    "margen_global_anterior_pct" numeric(12,6),
    "margen_global_nuevo_pct" numeric(12,6),
    "impacto_por_categoria" "jsonb",
    "resumen_ia" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "descuento_proveedor_pct_aplicado" numeric(5,2),
    "descuento_proveedor_pct_carga" numeric(5,2),
    "sucursal_id" "uuid",
    CONSTRAINT "chk_lista_precios_descuento_carga" CHECK ((("descuento_proveedor_pct_carga" IS NULL) OR (("descuento_proveedor_pct_carga" >= (0)::numeric) AND ("descuento_proveedor_pct_carga" < (100)::numeric)))),
    CONSTRAINT "chk_lista_precios_descuento_proveedor_pct_aplicado" CHECK ((("descuento_proveedor_pct_aplicado" IS NULL) OR (("descuento_proveedor_pct_aplicado" >= (0)::numeric) AND ("descuento_proveedor_pct_aplicado" < (100)::numeric))))
);


ALTER TABLE "public"."lista_precios" OWNER TO "postgres";


COMMENT ON COLUMN "public"."lista_precios"."descuento_proveedor_pct_aplicado" IS 'Snapshot del descuento de proveedor que se usó al aplicar esta lista. Se setea cuando la lista pasa a estado aplicado/parcialmente_aplicado. Es independiente del proveedor.descuento_pct actual: si el descuento del proveedor cambia después, esta lista mantiene su valor histórico.';



COMMENT ON COLUMN "public"."lista_precios"."descuento_proveedor_pct_carga" IS 'Snapshot del descuento % usado al confirmar el preview de importación. Se aplica una sola vez sobre el precio extraído; lista_precios_item.precio_lista queda neto.';



COMMENT ON COLUMN "public"."lista_precios"."sucursal_id" IS 'Sucursal operativa donde se cargó la lista (contexto de aplicación al catálogo). El proveedor es del tenant completo.';



CREATE TABLE IF NOT EXISTS "public"."lista_precios_item" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "lista_id" "uuid" NOT NULL,
    "orden" integer,
    "codigo_proveedor" "text",
    "nombre_raw" "text" NOT NULL,
    "nombre_normalizado" "text",
    "unidad" "public"."unidad_medida",
    "precio_lista" numeric(18,6) NOT NULL,
    "producto_id" "uuid",
    "match_confidence" numeric(6,5),
    "match_metodo" "text",
    "precio_costo_anterior" numeric(18,6),
    "variacion_pct" numeric(12,6),
    "precio_venta_actual" numeric(18,6),
    "margen_anterior_pct" numeric(12,6),
    "margen_nuevo_pct" numeric(12,6),
    "precio_venta_sugerido" numeric(18,6),
    "precio_venta_decidido" numeric(18,6),
    "incluir_en_aplicacion" boolean DEFAULT true NOT NULL,
    "notas" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_lista_precios_item_confidence" CHECK ((("match_confidence" IS NULL) OR (("match_confidence" >= (0)::numeric) AND ("match_confidence" <= (1)::numeric))))
);


ALTER TABLE "public"."lista_precios_item" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."medio_pago" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."medio_pago" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."medio_pago_opcion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "medio_pago_id" "uuid" NOT NULL,
    "cuotas" integer NOT NULL,
    "recargo_porcentaje" numeric(12,4) NOT NULL,
    CONSTRAINT "chk_medio_pago_opcion_cuotas" CHECK (("cuotas" >= 1))
);


ALTER TABLE "public"."medio_pago_opcion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."medio_pago_rapido" (
    "tenant_id" "uuid" NOT NULL,
    "codigo" character varying(20) NOT NULL,
    "recargo_porcentaje" numeric(12,4) DEFAULT 0 NOT NULL,
    CONSTRAINT "chk_medio_pago_rapido_codigo" CHECK ((("codigo")::"text" = ANY ((ARRAY['efectivo'::character varying, 'debito'::character varying, 'credito'::character varying, 'transferencia'::character varying, 'mixto'::character varying])::"text"[])))
);


ALTER TABLE "public"."medio_pago_rapido" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."modulo_config" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "stock" boolean DEFAULT true NOT NULL,
    "importador_excel" boolean DEFAULT true NOT NULL,
    "facturador_simple" boolean DEFAULT false NOT NULL,
    "facturador_arca" boolean DEFAULT false NOT NULL,
    "pedidos" boolean DEFAULT false NOT NULL,
    "presupuestos" boolean DEFAULT false NOT NULL,
    "ia_precios" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "analizador_rentabilidad" boolean DEFAULT false NOT NULL,
    "facturador_pos" boolean DEFAULT false NOT NULL,
    "lector_facturas" boolean DEFAULT false NOT NULL,
    CONSTRAINT "chk_arca_requiere_facturador" CHECK ((("facturador_arca" = false) OR ("facturador_simple" = true))),
    CONSTRAINT "chk_pos_requiere_facturador" CHECK ((("facturador_pos" = false) OR ("facturador_simple" = true)))
);


ALTER TABLE "public"."modulo_config" OWNER TO "postgres";


COMMENT ON COLUMN "public"."modulo_config"."lector_facturas" IS 'Plan H: módulo lector de facturas con IA (Gemini).';



CREATE TABLE IF NOT EXISTS "public"."mp_point_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "access_token" "text",
    "device_id" "text",
    "webhook_secret" "text",
    "habilitado" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_payment_intent_id" "text",
    "sucursal_id" "uuid" NOT NULL
);


ALTER TABLE "public"."mp_point_config" OWNER TO "postgres";


COMMENT ON TABLE "public"."mp_point_config" IS 'Credenciales y preferencias Mercado Pago Point por tenant. access_token cifrado en aplicación.';



COMMENT ON COLUMN "public"."mp_point_config"."last_payment_intent_id" IS 'ID del último payment intent enviado a la terminal; se usa para cancelar intents huérfanos si ya no hay comprobante asociado.';



CREATE TABLE IF NOT EXISTS "public"."mp_qr_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "access_token" "text",
    "user_id" "text",
    "external_pos_id" "text",
    "webhook_secret" "text",
    "habilitado" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sucursal_id" "uuid" NOT NULL
);


ALTER TABLE "public"."mp_qr_config" OWNER TO "postgres";


COMMENT ON TABLE "public"."mp_qr_config" IS 'Credenciales MP QR estático por tenant. access_token cifrado en aplicación (AES como mp_point_config).';



CREATE TABLE IF NOT EXISTS "public"."mp_qr_webhook_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "comprobante_id" "uuid",
    "topic" "text",
    "merchant_order_id" "text",
    "resultado" "text",
    "payload_snippet" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mp_qr_webhook_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pago_proveedor_factura" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "comprobante_id" "uuid",
    "proveedor_id" "uuid" NOT NULL,
    "monto_original" numeric(18,6) NOT NULL,
    "saldo_pendiente" numeric(18,6) NOT NULL,
    "vencimiento_at" timestamp with time zone NOT NULL,
    "condicion_pago" "text" NOT NULL,
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "recordatorio_snooze_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "origen" "text" DEFAULT 'comprobante'::"text" NOT NULL,
    "referencia" "text",
    CONSTRAINT "chk_ppf_comprobante_o_import_066" CHECK (((("origen" = 'comprobante'::"text") AND ("comprobante_id" IS NOT NULL)) OR (("origen" = 'import_lista'::"text") AND ("comprobante_id" IS NULL)))),
    CONSTRAINT "chk_ppf_cond" CHECK (("condicion_pago" = ANY (ARRAY['contado'::"text", 'dias'::"text", 'fecha_fija'::"text"]))),
    CONSTRAINT "chk_ppf_estado" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'parcial'::"text", 'pagada'::"text", 'anulada'::"text"]))),
    CONSTRAINT "chk_ppf_monto_pos" CHECK (("monto_original" > (0)::numeric)),
    CONSTRAINT "chk_ppf_origen_066" CHECK (("origen" = ANY (ARRAY['comprobante'::"text", 'import_lista'::"text"]))),
    CONSTRAINT "chk_ppf_saldo_monto" CHECK (("saldo_pendiente" <= "monto_original")),
    CONSTRAINT "chk_ppf_saldo_no_neg" CHECK (("saldo_pendiente" >= (0)::numeric))
);


ALTER TABLE "public"."pago_proveedor_factura" OWNER TO "postgres";


COMMENT ON TABLE "public"."pago_proveedor_factura" IS 'Obligación de pago asociada a comprobante de compra: saldo, vencimiento, estado.';



COMMENT ON COLUMN "public"."pago_proveedor_factura"."origen" IS 'comprobante: deuda vinculada a un comprobante. import_lista: obligación creada al importar lista (CC ya impactada con el mismo monto).';



COMMENT ON COLUMN "public"."pago_proveedor_factura"."referencia" IS 'Texto descriptivo (p. ej. nombre de archivo) cuando origen = import_lista.';



CREATE TABLE IF NOT EXISTS "public"."pago_proveedor_movimiento" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "pago_proveedor_factura_id" "uuid" NOT NULL,
    "monto" numeric(18,6) NOT NULL,
    "tipo_pago" "public"."tipo_pago" DEFAULT 'efectivo'::"public"."tipo_pago" NOT NULL,
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "usuario_id" "uuid",
    "notas" "text",
    "recibo_comprobante_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_ppm_monto_pos" CHECK (("monto" > (0)::numeric))
);


ALTER TABLE "public"."pago_proveedor_movimiento" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pedido" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "cliente_id" "uuid",
    "estado" "public"."estado_pedido" DEFAULT 'borrador'::"public"."estado_pedido" NOT NULL,
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "notas" "text",
    "comprobante_id" "uuid",
    "usuario_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "numero_orden" integer,
    "sucursal_id" "uuid" NOT NULL,
    "workflow_estado_id" "uuid"
);


ALTER TABLE "public"."pedido" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pedido"."numero_orden" IS 'Orden de venta interna por tenant (misma que comprobante.numero_orden). Propaga desde el presupuesto si existe; se asigna al facturar.';



CREATE TABLE IF NOT EXISTS "public"."pedido_estado_workflow" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "color" "text",
    "fase" "public"."estado_pedido" NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_pedido_estado_workflow_nombre_not_blank" CHECK (("btrim"("nombre") <> ''::"text")),
    CONSTRAINT "chk_pedido_estado_workflow_slug_not_blank" CHECK (("btrim"("slug") <> ''::"text"))
);


ALTER TABLE "public"."pedido_estado_workflow" OWNER TO "postgres";


COMMENT ON TABLE "public"."pedido_estado_workflow" IS 'Catálogo de estados/etiquetas de pedidos configurable por tenant. Cada estado mapea a una fase (`estado_pedido`).';



CREATE TABLE IF NOT EXISTS "public"."pedido_estado_workflow_transicion" (
    "tenant_id" "uuid" NOT NULL,
    "desde_id" "uuid" NOT NULL,
    "hacia_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_pedido_estado_workflow_transicion_not_self" CHECK (("desde_id" <> "hacia_id"))
);


ALTER TABLE "public"."pedido_estado_workflow_transicion" OWNER TO "postgres";


COMMENT ON TABLE "public"."pedido_estado_workflow_transicion" IS 'Aristas de transiciones permitidas entre estados de workflow (por tenant).';



CREATE TABLE IF NOT EXISTS "public"."pedido_item" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "pedido_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "cantidad" numeric(12,3) NOT NULL,
    "precio_unitario" numeric(12,2) NOT NULL,
    "subtotal" numeric(12,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "promocion_id" "uuid",
    "promocion_descripcion" "text",
    "precio_unitario_original" numeric(12,2),
    "descuento_promo_monto" numeric(12,2),
    CONSTRAINT "chk_pedido_item_positivo" CHECK ((("cantidad" > (0)::numeric) AND ("precio_unitario" >= (0)::numeric) AND ("subtotal" >= (0)::numeric)))
);


ALTER TABLE "public"."pedido_item" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permiso" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clave" "text" NOT NULL,
    "modulo" "text" NOT NULL,
    "descripcion" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_permiso_clave_not_blank" CHECK (("btrim"("clave") <> ''::"text")),
    CONSTRAINT "chk_permiso_modulo_not_blank" CHECK (("btrim"("modulo") <> ''::"text"))
);


ALTER TABLE "public"."permiso" OWNER TO "postgres";


COMMENT ON TABLE "public"."permiso" IS 'Catálogo global de permisos (acciones).';



CREATE TABLE IF NOT EXISTS "public"."precio_historial" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "precio_costo_anterior" numeric(12,2),
    "precio_costo_nuevo" numeric(12,2),
    "precio_venta_anterior" numeric(12,2),
    "precio_venta_nuevo" numeric(12,2),
    "margen_anterior" numeric(5,2),
    "margen_nuevo" numeric(5,2),
    "origen" "public"."origen_precio" DEFAULT 'manual'::"public"."origen_precio" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."precio_historial" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."precio_sucursal" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    "precio_costo" numeric(12,2),
    "precio_venta" numeric(12,2),
    "porcentaje_ganancia" numeric(5,2),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_precio_sucursal_ganancia_nonneg" CHECK ((("porcentaje_ganancia" IS NULL) OR ("porcentaje_ganancia" >= (0)::numeric))),
    CONSTRAINT "chk_precio_sucursal_positivo" CHECK (((("precio_costo" IS NULL) OR ("precio_costo" >= (0)::numeric)) AND (("precio_venta" IS NULL) OR ("precio_venta" >= (0)::numeric))))
);


ALTER TABLE "public"."precio_sucursal" OWNER TO "postgres";


COMMENT ON TABLE "public"."precio_sucursal" IS 'Override de precios por sucursal (opcional). Si no hay fila, rigen producto.precio_costo / precio_venta.';


COMMENT ON COLUMN "public"."precio_sucursal"."porcentaje_ganancia" IS 'Ganancia porcentual propia de la sucursal. Si tiene valor, precio_venta es derivado desde costo + ganancia + IVA.';



CREATE TABLE IF NOT EXISTS "public"."producto" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "codigo" character varying(50),
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "categoria_id" "uuid",
    "proveedor_id" "uuid",
    "unidad" "public"."unidad_medida" DEFAULT 'unidad'::"public"."unidad_medida" NOT NULL,
    "precio_costo" numeric(12,2) DEFAULT 0 NOT NULL,
    "precio_venta" numeric(12,2) DEFAULT 0 NOT NULL,
    "stock_actual" numeric(12,3) DEFAULT 0 NOT NULL,
    "stock_minimo" numeric(12,3) DEFAULT 0 NOT NULL,
    "fecha_vencimiento" "date",
    "imagen_url" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "codigo_barras" character varying(64),
    "plu" character varying(5),
    "es_pesable" boolean DEFAULT false NOT NULL,
    "rubro" "text",
    "subrubro" "text",
    "iva_porcentaje" numeric(5,2),
    "porcentaje_ganancia" numeric(5,2),
    "descuento_costo_pct" numeric(5,2),
    "ubicacion" "text",
    "moneda" "text" DEFAULT '$'::"text" NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    "texto_buscable" "text" GENERATED ALWAYS AS ("public"."normalizar_texto_buscable_db"(((((((((((((COALESCE("nombre", ''::"text") || ' '::"text") || (COALESCE("codigo", ''::character varying))::"text") || ' '::"text") || (COALESCE("codigo_barras", ''::character varying))::"text") || ' '::"text") || (COALESCE("plu", ''::character varying))::"text") || ' '::"text") || COALESCE("descripcion", ''::"text")) || ' '::"text") || COALESCE("rubro", ''::"text")) || ' '::"text") || COALESCE("subrubro", ''::"text")))) STORED,
    "unidad_compra" "public"."unidad_medida",
    "contenido_unidad_compra" numeric(18,6),
    CONSTRAINT "chk_producto_descuento_costo_pct_rango" CHECK ((("descuento_costo_pct" IS NULL) OR (("descuento_costo_pct" >= (0)::numeric) AND ("descuento_costo_pct" <= (100)::numeric)))),
    CONSTRAINT "chk_pesable_unidad" CHECK ((("es_pesable" = false) OR ("unidad" = ANY (ARRAY['kg'::"public"."unidad_medida", 'gramo'::"public"."unidad_medida"])))),
    CONSTRAINT "chk_plu_requiere_pesable" CHECK ((("plu" IS NULL) OR ("es_pesable" = true) OR ("unidad" = 'unidad'::"public"."unidad_medida"))),
    CONSTRAINT "chk_precios_positivos" CHECK ((("precio_costo" >= (0)::numeric) AND ("precio_venta" >= (0)::numeric))),
    CONSTRAINT "chk_producto_presentacion_compra" CHECK (((("unidad_compra" IS NULL) AND ("contenido_unidad_compra" IS NULL)) OR (("unidad_compra" IS NOT NULL) AND ("contenido_unidad_compra" IS NOT NULL) AND ("contenido_unidad_compra" > (0)::numeric))))
);


ALTER TABLE "public"."producto" OWNER TO "postgres";


COMMENT ON COLUMN "public"."producto"."unidad_compra" IS 'Presentación típica de compra (caja, pack, etc.); null si no hay conversión declarada.';



COMMENT ON COLUMN "public"."producto"."contenido_unidad_compra" IS 'Unidades de stock (producto.unidad) que representa 1 unidad_compra; p. ej. 500 clavos por caja.';


COMMENT ON COLUMN "public"."producto"."descuento_costo_pct" IS 'Descuento porcentual opcional sobre el costo bruto, usado solo como base para calcular precio_venta. No modifica precio_costo.';



CREATE TABLE IF NOT EXISTS "public"."producto_ganancia_tramo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "cantidad_desde" numeric(12,3) NOT NULL,
    "ganancia_pct" numeric(6,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "chk_producto_ganancia_tramo_cantidad_desde_pos" CHECK (("cantidad_desde" >= (1)::numeric)),
    CONSTRAINT "chk_producto_ganancia_tramo_ganancia_pct_nonneg" CHECK (("ganancia_pct" >= (0)::numeric))
);


ALTER TABLE "public"."producto_ganancia_tramo" OWNER TO "postgres";


COMMENT ON COLUMN "public"."producto_ganancia_tramo"."orden" IS '0-based: posición en el array al guardar; GET devuelve ordenado por esta columna.';



CREATE TABLE IF NOT EXISTS "public"."producto_lote_ingreso" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    "proveedor_id" "uuid",
    "cantidad" numeric(12,3) NOT NULL,
    "fecha_vencimiento" "date",
    "precio_costo" numeric(18,6),
    "origen" "text" NOT NULL,
    "importacion_log_id" "uuid",
    "lector_factura_log_id" "uuid",
    "movimiento_id" "uuid",
    "creado_por" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_producto_lote_origen" CHECK (("origen" = ANY (ARRAY['importacion'::"text", 'lector_facturas'::"text", 'manual'::"text", 'pos'::"text", 'comprobante_compra'::"text"])))
);


ALTER TABLE "public"."producto_lote_ingreso" OWNER TO "postgres";


COMMENT ON TABLE "public"."producto_lote_ingreso" IS 'Lotes de ingreso por proveedor: cada entrada queda registrada con cantidad, vencimiento y costo. La pref "unificar_productos_entre_proveedores" usa esta tabla para conservar todos los vencimientos cuando se fusiona el catálogo.';



CREATE TABLE IF NOT EXISTS "public"."producto_promocion" (
    "promocion_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."producto_promocion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."producto_proveedor" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "proveedor_id" "uuid" NOT NULL,
    "precio_costo" numeric(18,6) DEFAULT 0 NOT NULL,
    "codigo_proveedor" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."producto_proveedor" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promocion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "tipo" "public"."promocion_tipo" NOT NULL,
    "cantidad_lleva" integer,
    "cantidad_paga" integer,
    "unidad_descuento" integer,
    "porcentaje" numeric(5,2),
    "cantidad_minima" integer,
    "vigente_desde" "date",
    "vigente_hasta" "date",
    "dias_semana" integer[],
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rangos_volumen" "jsonb",
    "precio_combo" numeric(14,2),
    "sucursal_id" "uuid" NOT NULL,
    CONSTRAINT "chk_promo_nxm_valido" CHECK ((("tipo" <> 'n_x_m'::"public"."promocion_tipo") OR (("cantidad_lleva" IS NOT NULL) AND ("cantidad_paga" IS NOT NULL) AND ("cantidad_lleva" > "cantidad_paga") AND ("cantidad_paga" > 0)))),
    CONSTRAINT "chk_promo_porcentaje_valido" CHECK (((("tipo" <> ALL (ARRAY['porcentaje_off'::"public"."promocion_tipo", 'porcentaje_unidad_n'::"public"."promocion_tipo"])) OR (("porcentaje" IS NOT NULL) AND ("porcentaje" > (0)::numeric) AND ("porcentaje" <= (100)::numeric))) AND (("tipo" <> 'descuento_volumen'::"public"."promocion_tipo") OR ((("rangos_volumen" IS NOT NULL) AND ("jsonb_array_length"("rangos_volumen") > 0)) OR (("cantidad_minima" IS NOT NULL) AND ("cantidad_minima" >= 2) AND ("porcentaje" IS NOT NULL) AND ("porcentaje" > (0)::numeric) AND ("porcentaje" <= (100)::numeric)))) AND (("tipo" <> 'combo_precio_fijo'::"public"."promocion_tipo") OR (("precio_combo" IS NOT NULL) AND ("precio_combo" > (0)::numeric))))),
    CONSTRAINT "chk_promo_unidad_n" CHECK ((("tipo" <> 'porcentaje_unidad_n'::"public"."promocion_tipo") OR (("unidad_descuento" IS NOT NULL) AND ("unidad_descuento" >= 2)))),
    CONSTRAINT "chk_promo_vigencia" CHECK ((("vigente_hasta" IS NULL) OR ("vigente_desde" IS NULL) OR ("vigente_hasta" >= "vigente_desde")))
);


ALTER TABLE "public"."promocion" OWNER TO "postgres";


COMMENT ON TABLE "public"."promocion" IS 'Promociones por tenant. Parámetros según tipo en columnas nullable; validación adicional en aplicación.';



COMMENT ON COLUMN "public"."promocion"."rangos_volumen" IS 'Opcional para descuento_volumen: tramos [{cantidad_desde, cantidad_hasta|null, porcentaje}]. Si NULL, se usan cantidad_minima y porcentaje.';



COMMENT ON COLUMN "public"."promocion"."precio_combo" IS 'Para combo_precio_fijo: precio total del paquete definido en promocion_combo_item.';



CREATE TABLE IF NOT EXISTS "public"."promocion_combo_item" (
    "promocion_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "cantidad" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "promocion_combo_item_cantidad_check" CHECK (("cantidad" >= 1))
);


ALTER TABLE "public"."promocion_combo_item" OWNER TO "postgres";


COMMENT ON TABLE "public"."promocion_combo_item" IS 'Cantidades por producto que forman un combo (precio_combo por cada paquete completo).';



CREATE TABLE IF NOT EXISTS "public"."proveedor" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "cuit" character varying(13),
    "telefono" character varying(20),
    "email" character varying(255),
    "direccion" "text",
    "notas" "text",
    "mapeo_excel" "jsonb",
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "condicion_pago_default" "text" DEFAULT 'contado'::"text" NOT NULL,
    "plazo_pago_dias" integer,
    "sucursal_id" "uuid",
    "descuento_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "chk_proveedor_condicion_plazo" CHECK (("condicion_pago_default" = ANY (ARRAY['contado'::"text", 'dias'::"text"]))),
    CONSTRAINT "chk_proveedor_descuento_pct" CHECK ((("descuento_pct" >= (0)::numeric) AND ("descuento_pct" < (100)::numeric))),
    CONSTRAINT "chk_proveedor_plazo_pago" CHECK (((("condicion_pago_default" = 'dias'::"text") AND ("plazo_pago_dias" IS NOT NULL) AND ("plazo_pago_dias" > 0)) OR (("condicion_pago_default" = 'contado'::"text") AND ("plazo_pago_dias" IS NULL))))
);


ALTER TABLE "public"."proveedor" OWNER TO "postgres";


COMMENT ON COLUMN "public"."proveedor"."condicion_pago_default" IS 'Contado: vencimiento al día de la factura. A días: usar plazo_pago_dias > 0.';



COMMENT ON COLUMN "public"."proveedor"."plazo_pago_dias" IS 'Obligatorio y > 0 si condicion_pago_default = ''dias''.';



COMMENT ON COLUMN "public"."proveedor"."sucursal_id" IS 'Opcional: sucursal de referencia o alta histórica. El proveedor aplica a todo el tenant; listados y CC no filtran por esta columna.';



COMMENT ON COLUMN "public"."proveedor"."descuento_pct" IS 'Descuento porcentual estándar acordado con este proveedor. Se aplica automáticamente sobre los costos al procesar una lista de precios vinculada a este proveedor (módulo analizador). NO se aplica en lector-facturas, NO se aplica automáticamente en carga manual de productos.';



CREATE TABLE IF NOT EXISTS "public"."radar_inflacion" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "rubro" "text" NOT NULL,
    "proveedor_nombre" "text" NOT NULL,
    "periodo" "text" NOT NULL,
    "variacion_promedio_pct" numeric(12,6) DEFAULT 0 NOT NULL,
    "cantidad_listas" integer DEFAULT 1 NOT NULL,
    "cantidad_items" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."radar_inflacion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rol" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "es_base" boolean DEFAULT false NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_rol_nombre_not_blank" CHECK (("btrim"("nombre") <> ''::"text")),
    CONSTRAINT "chk_rol_slug_not_blank" CHECK (("btrim"("slug") <> ''::"text"))
);


ALTER TABLE "public"."rol" OWNER TO "postgres";


COMMENT ON TABLE "public"."rol" IS 'Roles por tenant. Incluye roles base y personalizados.';



CREATE TABLE IF NOT EXISTS "public"."rol_permiso" (
    "rol_id" "uuid" NOT NULL,
    "permiso_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rol_permiso" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_sucursal" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    "stock_actual" numeric(12,3) DEFAULT 0 NOT NULL,
    "stock_minimo" numeric(12,3) DEFAULT 0 NOT NULL,
    "ubicacion" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."stock_sucursal" OWNER TO "postgres";


COMMENT ON TABLE "public"."stock_sucursal" IS 'Stock por depósito/sucursal (fase producto único). Convive con producto.stock_actual vía triggers hasta migración completa.';



CREATE TABLE IF NOT EXISTS "public"."sucursal" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "codigo" "text" DEFAULT '1'::"text" NOT NULL,
    "nombre" "text" NOT NULL,
    "direccion" "text",
    "activa" boolean DEFAULT true NOT NULL,
    "es_principal" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pos_prefs" "jsonb",
    "hereda_datos_ticket" boolean DEFAULT true NOT NULL,
    "razon_social" "text",
    "cuit" "text",
    "telefono" "text",
    "horarios_atencion" "text",
    "email" "text",
    "business_prefs" "jsonb",
    CONSTRAINT "chk_sucursal_codigo_not_blank" CHECK (("btrim"("codigo") <> ''::"text")),
    CONSTRAINT "chk_sucursal_nombre_not_blank" CHECK (("btrim"("nombre") <> ''::"text"))
);


ALTER TABLE "public"."sucursal" OWNER TO "postgres";


COMMENT ON TABLE "public"."sucursal" IS 'Punto de operación del tenant (stock, comprobantes, caja). Los proveedores son maestros del negocio (tenant), no propiedad exclusiva de una sucursal.';



COMMENT ON COLUMN "public"."sucursal"."es_principal" IS 'Marca la sucursal principal del tenant (seed inicial).';



COMMENT ON COLUMN "public"."sucursal"."pos_prefs" IS 'Preferencias POS de la sucursal; NULL = usar solo tenant.pos_prefs.';



COMMENT ON COLUMN "public"."sucursal"."hereda_datos_ticket" IS 'Si true, el ticket usa razón social, CUIT y domicilio del tenant; si false, usa datos de la sucursal con fallback al tenant.';



COMMENT ON COLUMN "public"."sucursal"."razon_social" IS 'Razón social en ticket cuando hereda_datos_ticket es false; null = usar tenant.';



COMMENT ON COLUMN "public"."sucursal"."cuit" IS 'CUIT en ticket cuando hereda_datos_ticket es false; null = usar tenant.';



COMMENT ON COLUMN "public"."sucursal"."business_prefs" IS 'Override por sucursal de business_prefs; NULL = heredar tenant.';



CREATE TABLE IF NOT EXISTS "public"."super_admin_contexto_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "tenant_id_prev" "uuid",
    "tenant_id_next" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."super_admin_contexto_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."super_admin_tenant_acceso" (
    "usuario_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."super_admin_tenant_acceso" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "nombre" "text" NOT NULL,
    "razon_social" "text",
    "cuit" character varying(13),
    "domicilio" "text",
    "telefono" character varying(20),
    "email" character varying(255),
    "logo_url" "text",
    "punto_de_venta" integer DEFAULT 1 NOT NULL,
    "condicion_iva" "public"."condicion_iva" DEFAULT 'monotributista'::"public"."condicion_iva" NOT NULL,
    "plan" "public"."plan_tipo" DEFAULT 'base'::"public"."plan_tipo" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "iva_porcentaje_default" numeric(5,2) DEFAULT 21 NOT NULL,
    "horarios_atencion" "text",
    "codigo_acceso" "text" NOT NULL,
    "pos_prefs" "jsonb" DEFAULT '{"pvpRedondeoCentenasArriba": false, "pvpRedondeoMenores100ADecenas": false}'::"jsonb" NOT NULL,
    "mensualidad_corte_dia" smallint,
    "ginkgo_monto_abonado" numeric(12,2),
    "ginkgo_porcentaje" numeric(5,2),
    "ginkgo_facturacion_actualizada_en" timestamp with time zone,
    "ia_ilimitada_origen" "text",
    "business_prefs" "jsonb" DEFAULT '{"precioCostoSoloSube": false}'::"jsonb" NOT NULL,
    CONSTRAINT "chk_tenant_ia_ilimitada_origen" CHECK ((("ia_ilimitada_origen" IS NULL) OR ("ia_ilimitada_origen" = ANY (ARRAY['lector_factura'::"text", 'ia_pdf'::"text"])))),
    CONSTRAINT "tenant_mensualidad_corte_dia_check" CHECK ((("mensualidad_corte_dia" IS NULL) OR (("mensualidad_corte_dia" >= 1) AND ("mensualidad_corte_dia" <= 28)))),
    CONSTRAINT "tenant_ginkgo_monto_abonado_check" CHECK ((("ginkgo_monto_abonado" IS NULL) OR ("ginkgo_monto_abonado" >= (0)::numeric))),
    CONSTRAINT "tenant_ginkgo_porcentaje_check" CHECK ((("ginkgo_porcentaje" IS NULL) OR (("ginkgo_porcentaje" >= (0)::numeric) AND ("ginkgo_porcentaje" <= (100)::numeric))))
);


ALTER TABLE "public"."tenant" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tenant"."logo_url" IS 'URL pública del logo del negocio (Storage u otro origen)';



COMMENT ON COLUMN "public"."tenant"."horarios_atencion" IS 'Texto libre, ej. Lun–Vie 9–18 hs';



COMMENT ON COLUMN "public"."tenant"."codigo_acceso" IS 'Código corto único del negocio para login local (usuario + PIN).';



COMMENT ON COLUMN "public"."tenant"."pos_prefs" IS 'Preferencias POS por defecto del negocio (JSON parcial o completo; normaliza la app).';



COMMENT ON COLUMN "public"."tenant"."mensualidad_corte_dia" IS 'Día de calendario (1-28) del corte mensual; NULL si aún no está definido.';



COMMENT ON COLUMN "public"."tenant"."ginkgo_monto_abonado" IS 'Monto abonado por el cliente de Nexus para calcular la facturacion que corresponde a Ginkgo Devs.';



COMMENT ON COLUMN "public"."tenant"."ginkgo_porcentaje" IS 'Porcentaje del monto abonado que corresponde facturar a Ginkgo Devs.';



COMMENT ON COLUMN "public"."tenant"."ginkgo_facturacion_actualizada_en" IS 'Fecha de ultima actualizacion de los datos de facturacion Ginkgo del tenant.';



COMMENT ON COLUMN "public"."tenant"."ia_ilimitada_origen" IS 'En plan intermedio: define qué IA es ilimitada (lector_factura o ia_pdf).';



COMMENT ON COLUMN "public"."tenant"."business_prefs" IS 'Preferencias de negocio (catálogo, importación, etc.); JSON parcial o completo. Normaliza la app.';



CREATE TABLE IF NOT EXISTS "public"."usuario" (
    "id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "apellido" "text" NOT NULL,
    "email" character varying(255) NOT NULL,
    "rol" "public"."rol_usuario" DEFAULT 'operador'::"public"."rol_usuario" NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "es_super_admin" boolean DEFAULT false NOT NULL,
    "tenant_contexto_id" "uuid",
    "sucursal_default_id" "uuid",
    "es_prueba" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "pedidos_puede_crear" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."usuario" OWNER TO "postgres";


COMMENT ON COLUMN "public"."usuario"."es_super_admin" IS 'Staff de plataforma: puede actuar en tenants de super_admin_tenant_acceso.';



COMMENT ON COLUMN "public"."usuario"."tenant_contexto_id" IS 'Tenant efectivo si es super admin; NULL = usar tenant_id (casa).';



COMMENT ON COLUMN "public"."usuario"."es_prueba" IS 'Si true, usuario pensado para pruebas internas. Filtrar en paneles (ej. Nexus); no es un control de autorización por sí solo.';



COMMENT ON COLUMN "public"."usuario"."deleted_at" IS 'Marca de soft delete. NULL = vigente; NOT NULL = eliminado.';



COMMENT ON COLUMN "public"."usuario"."deleted_by" IS 'Usuario que ejecutó el soft delete (auth.uid), si aplica.';



COMMENT ON COLUMN "public"."usuario"."pedidos_puede_crear" IS 'Si es verdadero, el usuario puede crear pedidos (POST /api/pedidos y pantalla Nuevo pedido) aunque su rol sea visor. Operadores y administradores no dependen de esta marca.';



CREATE TABLE IF NOT EXISTS "public"."usuario_credencial_local" (
    "usuario_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "username_local" "text" NOT NULL,
    "pin_hash" "text" NOT NULL,
    "pin_temporal" boolean DEFAULT true NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "intentos_fallidos" smallint DEFAULT 0 NOT NULL,
    "bloqueado_hasta" timestamp with time zone,
    "ultimo_login_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_intentos_fallidos_nonnegative" CHECK (("intentos_fallidos" >= 0)),
    CONSTRAINT "chk_username_local_not_blank" CHECK (("btrim"("username_local") <> ''::"text"))
);


ALTER TABLE "public"."usuario_credencial_local" OWNER TO "postgres";


COMMENT ON TABLE "public"."usuario_credencial_local" IS 'Credenciales locales para login por usuario+PIN (hash), scope por tenant.';



COMMENT ON COLUMN "public"."usuario_credencial_local"."pin_hash" IS 'Hash del PIN (argon2/bcrypt). Nunca almacenar PIN plano.';



CREATE TABLE IF NOT EXISTS "public"."usuario_pedido_workflow_estado" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "workflow_estado_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."usuario_pedido_workflow_estado" OWNER TO "postgres";


COMMENT ON TABLE "public"."usuario_pedido_workflow_estado" IS 'Estados de workflow de pedidos asignados a un usuario operador o visor. Si no hay filas, el usuario sigue viendo todos los pedidos como antes (excepto admins que siempre ven todo sin filtrar desde esta tabla).';



CREATE TABLE IF NOT EXISTS "public"."usuario_rol" (
    "usuario_id" "uuid" NOT NULL,
    "rol_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."usuario_rol" OWNER TO "postgres";


COMMENT ON TABLE "public"."usuario_rol" IS 'Asignación de roles a usuarios (permite 1..N roles por usuario).';



CREATE TABLE IF NOT EXISTS "public"."usuario_sucursal" (
    "usuario_id" "uuid" NOT NULL,
    "sucursal_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."usuario_sucursal" OWNER TO "postgres";


COMMENT ON TABLE "public"."usuario_sucursal" IS 'Asignaciones de sucursales permitidas por usuario.';



CREATE OR REPLACE VIEW "public"."v_clientes_morosos" AS
 SELECT "cc"."tenant_id",
    "cc"."cliente_id",
    "c"."nombre" AS "cliente_nombre",
    "c"."email" AS "cliente_email",
    "c"."telefono" AS "cliente_telefono",
    "cc"."saldo",
    "cc"."limite_credito",
        CASE
            WHEN (("cc"."limite_credito" IS NOT NULL) AND ("cc"."saldo" > "cc"."limite_credito")) THEN true
            ELSE false
        END AS "excede_limite"
   FROM ("public"."cuenta_corriente" "cc"
     JOIN "public"."cliente" "c" ON (("c"."id" = "cc"."cliente_id")))
  WHERE ("cc"."saldo" > (0)::numeric);


ALTER VIEW "public"."v_clientes_morosos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_branch_rule" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "from_wa_id" "text",
    "phone_number_id" "text",
    "proveedor_id" "uuid",
    "sucursal_id" "uuid" NOT NULL,
    "prioridad" integer DEFAULT 0 NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."whatsapp_branch_rule" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_channel" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "phone_number_id" "text" NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."whatsapp_channel" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_inbound_attachment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "inbound_message_id" "uuid" NOT NULL,
    "wa_media_id" "text",
    "mime_type" "text",
    "filename" "text",
    "sha256" "text" NOT NULL,
    "raw_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "storage_bucket" "text",
    "storage_path" "text",
    "archivo_tamano" bigint,
    "download_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "downloaded_at" timestamp with time zone,
    "download_error" "text"
);


ALTER TABLE "public"."whatsapp_inbound_attachment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_inbound_message" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "wamid" "text" NOT NULL,
    "from_wa_id" "text" NOT NULL,
    "to_phone_number_id" "text",
    "message_type" "text" NOT NULL,
    "text_body" "text",
    "metadata" "jsonb",
    "raw_payload" "jsonb" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."whatsapp_inbound_message" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_job_event" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "job_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "event_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."whatsapp_job_event" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_outbound_message" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "to_wa_id" "text" NOT NULL,
    "phone_number_id" "text",
    "body" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "related_job_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    "external_message_id" "text",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "last_error_at" timestamp with time zone
);


ALTER TABLE "public"."whatsapp_outbound_message" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."whatsapp_processing_job" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "inbound_message_id" "uuid" NOT NULL,
    "inbound_attachment_id" "uuid",
    "status" "public"."whatsapp_job_status" DEFAULT 'queued'::"public"."whatsapp_job_status" NOT NULL,
    "document_type" "text",
    "error_code" "text",
    "error_detail" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "from_wa_id" "text",
    "to_phone_number_id" "text",
    "branch_id" "uuid",
    "branch_resolution_status" "public"."whatsapp_branch_resolution_status",
    "branch_resolution_reason" "text",
    "branch_prompt_requested_at" timestamp with time zone,
    "branch_prompt_deadline_at" timestamp with time zone,
    "target_entity_type" "text",
    "target_entity_id" "uuid",
    "retry_count" integer DEFAULT 0 NOT NULL,
    "last_error_at" timestamp with time zone
);


ALTER TABLE "public"."whatsapp_processing_job" OWNER TO "postgres";


ALTER TABLE ONLY "public"."arca_config"
    ADD CONSTRAINT "arca_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."arca_log"
    ADD CONSTRAINT "arca_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."caja_apertura"
    ADD CONSTRAINT "caja_apertura_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."caja_gasto"
    ADD CONSTRAINT "caja_gasto_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."caja"
    ADD CONSTRAINT "caja_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."caja_turno"
    ADD CONSTRAINT "caja_turno_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."caja_usuario"
    ADD CONSTRAINT "caja_usuario_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categoria"
    ADD CONSTRAINT "categoria_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cierre_mensual"
    ADD CONSTRAINT "cierre_mensual_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cierre_z_medio_pago"
    ADD CONSTRAINT "cierre_z_medio_pago_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cierre_z"
    ADD CONSTRAINT "cierre_z_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cliente"
    ADD CONSTRAINT "cliente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cliente_sucursal"
    ADD CONSTRAINT "cliente_sucursal_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cobranza_factura"
    ADD CONSTRAINT "cobranza_factura_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cobranza_pago"
    ADD CONSTRAINT "cobranza_pago_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comprobante_item"
    ADD CONSTRAINT "comprobante_item_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comprobante"
    ADD CONSTRAINT "comprobante_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cuenta_corriente"
    ADD CONSTRAINT "cuenta_corriente_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."importacion_archivo"
    ADD CONSTRAINT "importacion_archivo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."importacion_log"
    ADD CONSTRAINT "importacion_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lector_factura_log"
    ADD CONSTRAINT "lector_factura_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lista_precios_item"
    ADD CONSTRAINT "lista_precios_item_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lista_precios"
    ADD CONSTRAINT "lista_precios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."medio_pago_opcion"
    ADD CONSTRAINT "medio_pago_opcion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."medio_pago"
    ADD CONSTRAINT "medio_pago_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."medio_pago_rapido"
    ADD CONSTRAINT "medio_pago_rapido_pkey" PRIMARY KEY ("tenant_id", "codigo");



ALTER TABLE ONLY "public"."modulo_config"
    ADD CONSTRAINT "modulo_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."modulo_config"
    ADD CONSTRAINT "modulo_config_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."movimiento"
    ADD CONSTRAINT "movimiento_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mp_point_config"
    ADD CONSTRAINT "mp_point_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mp_qr_config"
    ADD CONSTRAINT "mp_qr_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mp_qr_webhook_log"
    ADD CONSTRAINT "mp_qr_webhook_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pago"
    ADD CONSTRAINT "pago_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pago_proveedor_factura"
    ADD CONSTRAINT "pago_proveedor_factura_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pago_proveedor_movimiento"
    ADD CONSTRAINT "pago_proveedor_movimiento_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pedido_estado_workflow"
    ADD CONSTRAINT "pedido_estado_workflow_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pedido_estado_workflow_transicion"
    ADD CONSTRAINT "pedido_estado_workflow_transicion_pkey" PRIMARY KEY ("tenant_id", "desde_id", "hacia_id");



ALTER TABLE ONLY "public"."pedido_item"
    ADD CONSTRAINT "pedido_item_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pedido"
    ADD CONSTRAINT "pedido_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permiso"
    ADD CONSTRAINT "permiso_clave_key" UNIQUE ("clave");



ALTER TABLE ONLY "public"."permiso"
    ADD CONSTRAINT "permiso_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."precio_historial"
    ADD CONSTRAINT "precio_historial_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."precio_sucursal"
    ADD CONSTRAINT "precio_sucursal_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producto_ganancia_tramo"
    ADD CONSTRAINT "producto_ganancia_tramo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producto_lote_ingreso"
    ADD CONSTRAINT "producto_lote_ingreso_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producto"
    ADD CONSTRAINT "producto_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producto_promocion"
    ADD CONSTRAINT "producto_promocion_pkey" PRIMARY KEY ("promocion_id", "producto_id");



ALTER TABLE ONLY "public"."producto_proveedor"
    ADD CONSTRAINT "producto_proveedor_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promocion_combo_item"
    ADD CONSTRAINT "promocion_combo_item_pkey" PRIMARY KEY ("promocion_id", "producto_id");



ALTER TABLE ONLY "public"."promocion"
    ADD CONSTRAINT "promocion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proveedor"
    ADD CONSTRAINT "proveedor_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."radar_inflacion"
    ADD CONSTRAINT "radar_inflacion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rol_permiso"
    ADD CONSTRAINT "rol_permiso_pkey" PRIMARY KEY ("rol_id", "permiso_id");



ALTER TABLE ONLY "public"."rol"
    ADD CONSTRAINT "rol_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_sucursal"
    ADD CONSTRAINT "stock_sucursal_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sucursal"
    ADD CONSTRAINT "sucursal_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."super_admin_contexto_log"
    ADD CONSTRAINT "super_admin_contexto_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."super_admin_tenant_acceso"
    ADD CONSTRAINT "super_admin_tenant_acceso_pkey" PRIMARY KEY ("usuario_id", "tenant_id");



ALTER TABLE ONLY "public"."tenant"
    ADD CONSTRAINT "tenant_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."caja"
    ADD CONSTRAINT "uk_caja_numero_sucursal" UNIQUE ("sucursal_id", "numero");



ALTER TABLE ONLY "public"."caja_usuario"
    ADD CONSTRAINT "uk_caja_usuario" UNIQUE ("caja_id", "usuario_id");



ALTER TABLE ONLY "public"."precio_sucursal"
    ADD CONSTRAINT "uk_precio_sucursal_producto_sucursal" UNIQUE ("producto_id", "sucursal_id");



ALTER TABLE ONLY "public"."stock_sucursal"
    ADD CONSTRAINT "uk_stock_sucursal_producto_sucursal" UNIQUE ("producto_id", "sucursal_id");



ALTER TABLE ONLY "public"."usuario_pedido_workflow_estado"
    ADD CONSTRAINT "uk_usuario_pedido_wf_estado" UNIQUE ("tenant_id", "usuario_id", "workflow_estado_id");



ALTER TABLE ONLY "public"."cierre_mensual"
    ADD CONSTRAINT "uq_cierre_mensual_tenant_periodo" UNIQUE ("tenant_id", "periodo");



ALTER TABLE ONLY "public"."cierre_z_medio_pago"
    ADD CONSTRAINT "uq_cierre_z_medio_pago" UNIQUE ("cierre_z_id", "metodo_pago");



ALTER TABLE ONLY "public"."cliente_sucursal"
    ADD CONSTRAINT "uq_cliente_sucursal_cliente_sucursal" UNIQUE ("cliente_id", "sucursal_id");



ALTER TABLE ONLY "public"."cobranza_factura"
    ADD CONSTRAINT "uq_cobranza_factura_comprobante" UNIQUE ("tenant_id", "comprobante_id");



ALTER TABLE ONLY "public"."importacion_archivo"
    ADD CONSTRAINT "uq_importacion_archivo_tenant_carga" UNIQUE ("tenant_id", "carga_id");



ALTER TABLE ONLY "public"."medio_pago_opcion"
    ADD CONSTRAINT "uq_medio_pago_opcion_medio_cuotas" UNIQUE ("medio_pago_id", "cuotas");



ALTER TABLE ONLY "public"."producto_proveedor"
    ADD CONSTRAINT "uq_producto_proveedor_tenant_producto_proveedor" UNIQUE ("tenant_id", "producto_id", "proveedor_id");



ALTER TABLE ONLY "public"."radar_inflacion"
    ADD CONSTRAINT "uq_radar_rubro_proveedor_periodo" UNIQUE ("rubro", "proveedor_nombre", "periodo");



ALTER TABLE ONLY "public"."sucursal"
    ADD CONSTRAINT "uq_sucursal_tenant_codigo" UNIQUE ("tenant_id", "codigo");



ALTER TABLE ONLY "public"."usuario_credencial_local"
    ADD CONSTRAINT "usuario_credencial_local_pkey" PRIMARY KEY ("usuario_id");



ALTER TABLE ONLY "public"."usuario_pedido_workflow_estado"
    ADD CONSTRAINT "usuario_pedido_workflow_estado_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usuario"
    ADD CONSTRAINT "usuario_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usuario_rol"
    ADD CONSTRAINT "usuario_rol_pkey" PRIMARY KEY ("usuario_id", "rol_id");



ALTER TABLE ONLY "public"."usuario_sucursal"
    ADD CONSTRAINT "usuario_sucursal_pkey" PRIMARY KEY ("usuario_id", "sucursal_id");



ALTER TABLE ONLY "public"."whatsapp_branch_rule"
    ADD CONSTRAINT "whatsapp_branch_rule_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_channel"
    ADD CONSTRAINT "whatsapp_channel_phone_number_id_key" UNIQUE ("phone_number_id");



ALTER TABLE ONLY "public"."whatsapp_channel"
    ADD CONSTRAINT "whatsapp_channel_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_inbound_attachment"
    ADD CONSTRAINT "whatsapp_inbound_attachment_inbound_message_id_sha256_key" UNIQUE ("inbound_message_id", "sha256");



ALTER TABLE ONLY "public"."whatsapp_inbound_attachment"
    ADD CONSTRAINT "whatsapp_inbound_attachment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_inbound_message"
    ADD CONSTRAINT "whatsapp_inbound_message_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_inbound_message"
    ADD CONSTRAINT "whatsapp_inbound_message_wamid_key" UNIQUE ("wamid");



ALTER TABLE ONLY "public"."whatsapp_job_event"
    ADD CONSTRAINT "whatsapp_job_event_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_outbound_message"
    ADD CONSTRAINT "whatsapp_outbound_message_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."whatsapp_processing_job"
    ADD CONSTRAINT "whatsapp_processing_job_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "idx_arca_config_sucursal_id" ON "public"."arca_config" USING "btree" ("sucursal_id");



CREATE UNIQUE INDEX "idx_arca_config_tenant_sucursal" ON "public"."arca_config" USING "btree" ("tenant_id", "sucursal_id");



CREATE INDEX "idx_arca_log_comprobante" ON "public"."arca_log" USING "btree" ("comprobante_id") WHERE ("comprobante_id" IS NOT NULL);



CREATE INDEX "idx_arca_log_tenant" ON "public"."arca_log" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_caja_apertura_tenant_caja_opened" ON "public"."caja_apertura" USING "btree" ("tenant_id", "caja_id", "opened_at" DESC);



CREATE INDEX "idx_caja_gasto_apertura_created" ON "public"."caja_gasto" USING "btree" ("caja_apertura_id", "created_at");



CREATE INDEX "idx_caja_gasto_tenant_caja_apertura" ON "public"."caja_gasto" USING "btree" ("tenant_id", "caja_id", "caja_apertura_id") WHERE (("anulado_at" IS NULL) AND ("cierre_z_id" IS NULL));



CREATE INDEX "idx_caja_apertura_tenant_sucursal_fecha" ON "public"."caja_apertura" USING "btree" ("tenant_id", "sucursal_id", "fecha_operativa" DESC, "opened_at" DESC);



CREATE INDEX "idx_caja_mp_point_config" ON "public"."caja" USING "btree" ("mp_point_config_id") WHERE ("mp_point_config_id" IS NOT NULL);



CREATE INDEX "idx_caja_mp_qr_config" ON "public"."caja" USING "btree" ("mp_qr_config_id") WHERE ("mp_qr_config_id" IS NOT NULL);



CREATE INDEX "idx_caja_sucursal" ON "public"."caja" USING "btree" ("sucursal_id");



CREATE INDEX "idx_caja_tenant" ON "public"."caja" USING "btree" ("tenant_id");



CREATE INDEX "idx_caja_turno_abierto_at" ON "public"."caja_turno" USING "btree" ("abierto_at" DESC);



CREATE INDEX "idx_caja_turno_caja" ON "public"."caja_turno" USING "btree" ("caja_id");



CREATE INDEX "idx_caja_turno_tenant" ON "public"."caja_turno" USING "btree" ("tenant_id");



CREATE INDEX "idx_caja_turno_usuario" ON "public"."caja_turno" USING "btree" ("usuario_id");



CREATE INDEX "idx_caja_usuario_default" ON "public"."caja" USING "btree" ("usuario_default_id") WHERE ("usuario_default_id" IS NOT NULL);



CREATE INDEX "idx_caja_usuario_tenant" ON "public"."caja_usuario" USING "btree" ("tenant_id");



CREATE INDEX "idx_caja_usuario_usuario" ON "public"."caja_usuario" USING "btree" ("usuario_id");



CREATE UNIQUE INDEX "idx_categoria_nombre_tenant_sucursal" ON "public"."categoria" USING "btree" ("tenant_id", "sucursal_id", "lower"(TRIM(BOTH FROM "nombre"))) WHERE ("activa" = true);



CREATE INDEX "idx_categoria_tenant" ON "public"."categoria" USING "btree" ("tenant_id");



CREATE INDEX "idx_categoria_tenant_sucursal_lookup" ON "public"."categoria" USING "btree" ("tenant_id", "sucursal_id", "lower"("nombre"));



CREATE INDEX "idx_categoria_texto_buscable_trgm" ON "public"."categoria" USING "gin" ("texto_buscable" "public"."gin_trgm_ops");



CREATE INDEX "idx_cierre_mensual_tenant" ON "public"."cierre_mensual" USING "btree" ("tenant_id", "periodo" DESC);



CREATE INDEX "idx_cierre_z_medio_tenant" ON "public"."cierre_z_medio_pago" USING "btree" ("tenant_id", "cierre_z_id");



CREATE INDEX "idx_cierre_z_tenant_fecha" ON "public"."cierre_z" USING "btree" ("tenant_id", "fecha_operativa" DESC, "created_at" DESC);



CREATE INDEX "idx_cierre_z_tenant_sucursal_fecha" ON "public"."cierre_z" USING "btree" ("tenant_id", "sucursal_id", "fecha_operativa" DESC, "created_at" DESC);



CREATE INDEX "idx_cliente_cuit" ON "public"."cliente" USING "btree" ("cuit_dni") WHERE ("cuit_dni" IS NOT NULL);



CREATE INDEX "idx_cliente_sucursal_cliente_tenant" ON "public"."cliente_sucursal" USING "btree" ("tenant_id", "cliente_id");



CREATE INDEX "idx_cliente_sucursal_lookup" ON "public"."cliente_sucursal" USING "btree" ("tenant_id", "sucursal_id");



CREATE INDEX "idx_cliente_tenant" ON "public"."cliente" USING "btree" ("tenant_id");



CREATE INDEX "idx_cliente_tenant_sucursal_lookup" ON "public"."cliente" USING "btree" ("tenant_id", "sucursal_id", "lower"("nombre"));



CREATE INDEX "idx_cobranza_factura_cliente" ON "public"."cobranza_factura" USING "btree" ("tenant_id", "cliente_id");



CREATE INDEX "idx_cobranza_factura_tenant_saldo" ON "public"."cobranza_factura" USING "btree" ("tenant_id") WHERE ("saldo_pendiente" > (0)::numeric);



CREATE INDEX "idx_cobranza_pago_factura" ON "public"."cobranza_pago" USING "btree" ("cobranza_factura_id");



CREATE INDEX "idx_cobranza_pago_recibo" ON "public"."cobranza_pago" USING "btree" ("recibo_comprobante_id") WHERE ("recibo_comprobante_id" IS NOT NULL);



CREATE INDEX "idx_cobranza_pago_tenant" ON "public"."cobranza_pago" USING "btree" ("tenant_id");



CREATE INDEX "idx_comprobante_caja_turno" ON "public"."comprobante" USING "btree" ("caja_turno_id") WHERE ("caja_turno_id" IS NOT NULL);



CREATE INDEX "idx_comprobante_caja_uuid" ON "public"."comprobante" USING "btree" ("caja_uuid") WHERE ("caja_uuid" IS NOT NULL);



CREATE INDEX "idx_comprobante_cliente" ON "public"."comprobante" USING "btree" ("cliente_id");



CREATE INDEX "idx_comprobante_documento_asociado" ON "public"."comprobante" USING "btree" ("documento_asociado_id") WHERE ("documento_asociado_id" IS NOT NULL);



CREATE INDEX "idx_comprobante_estado" ON "public"."comprobante" USING "btree" ("estado");



CREATE INDEX "idx_comprobante_fecha" ON "public"."comprobante" USING "btree" ("fecha" DESC);



CREATE INDEX "idx_comprobante_fiscalizado_por" ON "public"."comprobante" USING "btree" ("fiscalizado_por_id") WHERE ("fiscalizado_por_id" IS NOT NULL);



CREATE INDEX "idx_comprobante_item_comprobante" ON "public"."comprobante_item" USING "btree" ("comprobante_id");



CREATE INDEX "idx_comprobante_medio_pago_opcion" ON "public"."comprobante" USING "btree" ("medio_pago_opcion_id");



CREATE INDEX "idx_comprobante_mp_intent" ON "public"."comprobante" USING "btree" ("tenant_id", "mp_point_intent_id") WHERE ("mp_point_intent_id" IS NOT NULL);



CREATE INDEX "idx_comprobante_mp_qr_order" ON "public"."comprobante" USING "btree" ("tenant_id", "mp_qr_order_id") WHERE ("mp_qr_order_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_comprobante_numero" ON "public"."comprobante" USING "btree" ("tenant_id", "sucursal_id", "tipo", "numero") WHERE (("numero" IS NOT NULL) AND ("numero" > 0));



CREATE INDEX "idx_comprobante_proveedor" ON "public"."comprobante" USING "btree" ("tenant_id", "proveedor_id") WHERE ("proveedor_id" IS NOT NULL);



CREATE INDEX "idx_comprobante_tenant" ON "public"."comprobante" USING "btree" ("tenant_id");



CREATE INDEX "idx_comprobante_tenant_numero_orden" ON "public"."comprobante" USING "btree" ("tenant_id", "numero_orden");



CREATE INDEX "idx_comprobante_tenant_sucursal_fecha" ON "public"."comprobante" USING "btree" ("tenant_id", "sucursal_id", "fecha" DESC, "created_at" DESC);



CREATE INDEX "idx_comprobante_ticket_caja_numero_caja_lookup" ON "public"."comprobante" USING "btree" ("tenant_id", "caja_uuid") WHERE (("tipo" = 'ticket'::"public"."tipo_comprobante") AND ("caja_uuid" IS NOT NULL));



CREATE INDEX "idx_credencial_local_tenant_activo" ON "public"."usuario_credencial_local" USING "btree" ("tenant_id", "activo");



CREATE UNIQUE INDEX "idx_credencial_local_tenant_username_unique" ON "public"."usuario_credencial_local" USING "btree" ("tenant_id", "lower"("username_local"));



CREATE INDEX "idx_cuenta_corriente_proveedor" ON "public"."cuenta_corriente" USING "btree" ("tenant_id", "proveedor_id") WHERE ("proveedor_id" IS NOT NULL);



CREATE INDEX "idx_cuenta_corriente_tenant" ON "public"."cuenta_corriente" USING "btree" ("tenant_id");



CREATE INDEX "idx_importacion_archivo_tenant_creado" ON "public"."importacion_archivo" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_importacion_fecha" ON "public"."importacion_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_importacion_log_tenant_carga" ON "public"."importacion_log" USING "btree" ("tenant_id", "carga_id") WHERE ("carga_id" IS NOT NULL);



CREATE INDEX "idx_importacion_log_tenant_sucursal_fecha" ON "public"."importacion_log" USING "btree" ("tenant_id", "sucursal_id", "created_at" DESC);



CREATE INDEX "idx_importacion_tenant" ON "public"."importacion_log" USING "btree" ("tenant_id");



CREATE INDEX "idx_lector_factura_log_comprobante" ON "public"."lector_factura_log" USING "btree" ("comprobante_id") WHERE ("comprobante_id" IS NOT NULL);



CREATE INDEX "idx_lector_factura_log_estado" ON "public"."lector_factura_log" USING "btree" ("tenant_id", "estado");



CREATE INDEX "idx_lector_factura_log_tenant" ON "public"."lector_factura_log" USING "btree" ("tenant_id");



CREATE INDEX "idx_lista_precios_item_lista" ON "public"."lista_precios_item" USING "btree" ("lista_id");



CREATE INDEX "idx_lista_precios_item_producto" ON "public"."lista_precios_item" USING "btree" ("producto_id");



CREATE INDEX "idx_lista_precios_tenant_fecha_recepcion" ON "public"."lista_precios" USING "btree" ("tenant_id", "fecha_recepcion" DESC);



CREATE INDEX "idx_lista_precios_tenant_proveedor" ON "public"."lista_precios" USING "btree" ("tenant_id", "proveedor_id");



CREATE INDEX "idx_lista_precios_tenant_sucursal" ON "public"."lista_precios" USING "btree" ("tenant_id", "sucursal_id") WHERE ("sucursal_id" IS NOT NULL);



CREATE INDEX "idx_medio_pago_opcion_medio" ON "public"."medio_pago_opcion" USING "btree" ("medio_pago_id");



CREATE INDEX "idx_medio_pago_tenant_activo" ON "public"."medio_pago" USING "btree" ("tenant_id", "activo");



CREATE INDEX "idx_movimiento_fecha" ON "public"."movimiento" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_movimiento_producto" ON "public"."movimiento" USING "btree" ("producto_id");



CREATE INDEX "idx_movimiento_proveedor" ON "public"."movimiento" USING "btree" ("tenant_id", "proveedor_id") WHERE ("proveedor_id" IS NOT NULL);



CREATE INDEX "idx_movimiento_referencia" ON "public"."movimiento" USING "btree" ("referencia_tipo", "referencia_id") WHERE ("referencia_id" IS NOT NULL);



CREATE INDEX "idx_movimiento_sucursal" ON "public"."movimiento" USING "btree" ("sucursal_id");



CREATE INDEX "idx_movimiento_tenant" ON "public"."movimiento" USING "btree" ("tenant_id");



CREATE INDEX "idx_mp_point_config_tenant_sucursal" ON "public"."mp_point_config" USING "btree" ("tenant_id", "sucursal_id");



CREATE INDEX "idx_mp_qr_config_tenant_sucursal" ON "public"."mp_qr_config" USING "btree" ("tenant_id", "sucursal_id");



CREATE INDEX "idx_mp_qr_webhook_log_created" ON "public"."mp_qr_webhook_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_pago_cliente" ON "public"."pago" USING "btree" ("cliente_id");



CREATE INDEX "idx_pago_cuenta" ON "public"."pago" USING "btree" ("cuenta_id");



CREATE INDEX "idx_pago_proveedor_fact_tenant_estado" ON "public"."pago_proveedor_factura" USING "btree" ("tenant_id", "estado");



CREATE INDEX "idx_pago_proveedor_fact_tenant_proveedor" ON "public"."pago_proveedor_factura" USING "btree" ("tenant_id", "proveedor_id");



CREATE INDEX "idx_pago_proveedor_fact_tenant_venc" ON "public"."pago_proveedor_factura" USING "btree" ("tenant_id", "vencimiento_at");



CREATE INDEX "idx_pago_proveedor_mov_fact" ON "public"."pago_proveedor_movimiento" USING "btree" ("pago_proveedor_factura_id");



CREATE INDEX "idx_pago_proveedor_mov_tenant" ON "public"."pago_proveedor_movimiento" USING "btree" ("tenant_id");



CREATE INDEX "idx_pago_tenant" ON "public"."pago" USING "btree" ("tenant_id");



CREATE INDEX "idx_pago_tenant_proveedor" ON "public"."pago" USING "btree" ("tenant_id", "proveedor_id") WHERE ("proveedor_id" IS NOT NULL);



CREATE INDEX "idx_pedido_cliente" ON "public"."pedido" USING "btree" ("cliente_id");



CREATE INDEX "idx_pedido_estado" ON "public"."pedido" USING "btree" ("estado");



CREATE INDEX "idx_pedido_estado_workflow_tenant_fase" ON "public"."pedido_estado_workflow" USING "btree" ("tenant_id", "fase");



CREATE INDEX "idx_pedido_estado_workflow_tenant_orden" ON "public"."pedido_estado_workflow" USING "btree" ("tenant_id", "orden", "created_at");



CREATE UNIQUE INDEX "idx_pedido_estado_workflow_tenant_slug_unique" ON "public"."pedido_estado_workflow" USING "btree" ("tenant_id", "lower"("slug"));



CREATE INDEX "idx_pedido_estado_workflow_transicion_tenant_desde" ON "public"."pedido_estado_workflow_transicion" USING "btree" ("tenant_id", "desde_id");



CREATE INDEX "idx_pedido_estado_workflow_transicion_tenant_hacia" ON "public"."pedido_estado_workflow_transicion" USING "btree" ("tenant_id", "hacia_id");



CREATE INDEX "idx_pedido_fecha" ON "public"."pedido" USING "btree" ("fecha" DESC);



CREATE INDEX "idx_pedido_item_pedido" ON "public"."pedido_item" USING "btree" ("pedido_id");



CREATE INDEX "idx_pedido_tenant" ON "public"."pedido" USING "btree" ("tenant_id");



CREATE INDEX "idx_pedido_tenant_numero_orden" ON "public"."pedido" USING "btree" ("tenant_id", "numero_orden");



CREATE INDEX "idx_pedido_tenant_sucursal_fecha" ON "public"."pedido" USING "btree" ("tenant_id", "sucursal_id", "fecha" DESC, "created_at" DESC);



CREATE INDEX "idx_pedido_tenant_sucursal_workflow_estado" ON "public"."pedido" USING "btree" ("tenant_id", "sucursal_id", "workflow_estado_id");



CREATE INDEX "idx_precio_historial_producto" ON "public"."precio_historial" USING "btree" ("producto_id", "created_at" DESC);



CREATE INDEX "idx_precio_historial_tenant" ON "public"."precio_historial" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_precio_sucursal_tenant" ON "public"."precio_sucursal" USING "btree" ("tenant_id");



CREATE INDEX "idx_producto_activo_codigo_trgm" ON "public"."producto" USING "gin" ("codigo" "public"."gin_trgm_ops") WHERE ("activo" = true);



CREATE INDEX "idx_producto_activo_nombre_trgm" ON "public"."producto" USING "gin" ("nombre" "public"."gin_trgm_ops") WHERE ("activo" = true);



CREATE INDEX "idx_producto_activo_texto_buscable_trgm" ON "public"."producto" USING "gin" ("texto_buscable" "public"."gin_trgm_ops") WHERE ("activo" = true);



CREATE INDEX "idx_producto_barcode_tenant_sucursal_lookup" ON "public"."producto" USING "btree" ("tenant_id", "sucursal_id", "codigo_barras") WHERE (("codigo_barras" IS NOT NULL) AND ("activo" = true));



CREATE INDEX "idx_producto_categoria" ON "public"."producto" USING "btree" ("categoria_id");



CREATE INDEX "idx_producto_codigo_tenant_lookup" ON "public"."producto" USING "btree" ("tenant_id", "lower"(("codigo")::"text")) WHERE ("activo" = true);



CREATE INDEX "idx_producto_ganancia_tramo_tenant_producto" ON "public"."producto_ganancia_tramo" USING "btree" ("tenant_id", "producto_id", "cantidad_desde" DESC);



CREATE INDEX "idx_producto_ganancia_tramo_tenant_producto_orden" ON "public"."producto_ganancia_tramo" USING "btree" ("tenant_id", "producto_id", "orden");



CREATE UNIQUE INDEX "idx_producto_ganancia_tramo_unique" ON "public"."producto_ganancia_tramo" USING "btree" ("tenant_id", "producto_id", "cantidad_desde");



CREATE INDEX "idx_producto_lote_movimiento" ON "public"."producto_lote_ingreso" USING "btree" ("movimiento_id") WHERE ("movimiento_id" IS NOT NULL);



CREATE INDEX "idx_producto_lote_tenant_producto" ON "public"."producto_lote_ingreso" USING "btree" ("tenant_id", "producto_id");



CREATE INDEX "idx_producto_lote_tenant_producto_vencimiento" ON "public"."producto_lote_ingreso" USING "btree" ("tenant_id", "producto_id", "fecha_vencimiento") WHERE ("fecha_vencimiento" IS NOT NULL);



CREATE INDEX "idx_producto_lote_tenant_proveedor" ON "public"."producto_lote_ingreso" USING "btree" ("tenant_id", "proveedor_id") WHERE ("proveedor_id" IS NOT NULL);



CREATE INDEX "idx_producto_nombre" ON "public"."producto" USING "gin" ("to_tsvector"('"spanish"'::"regconfig", "nombre"));



CREATE UNIQUE INDEX "idx_producto_plu_tenant" ON "public"."producto" USING "btree" ("tenant_id", "plu") WHERE (("plu" IS NOT NULL) AND ("activo" = true));



CREATE INDEX "idx_producto_promocion_producto" ON "public"."producto_promocion" USING "btree" ("producto_id");



CREATE INDEX "idx_producto_promocion_tenant" ON "public"."producto_promocion" USING "btree" ("tenant_id");



CREATE INDEX "idx_producto_proveedor" ON "public"."producto" USING "btree" ("proveedor_id");



CREATE INDEX "idx_producto_proveedor_tenant_producto" ON "public"."producto_proveedor" USING "btree" ("tenant_id", "producto_id");



CREATE INDEX "idx_producto_proveedor_tenant_proveedor" ON "public"."producto_proveedor" USING "btree" ("tenant_id", "proveedor_id");



CREATE INDEX "idx_producto_stock_bajo" ON "public"."producto" USING "btree" ("tenant_id", "stock_actual") WHERE (("activo" = true) AND ("stock_minimo" > (0)::numeric));



CREATE INDEX "idx_producto_tenant" ON "public"."producto" USING "btree" ("tenant_id");



CREATE INDEX "idx_producto_tenant_sucursal_lookup" ON "public"."producto" USING "btree" ("tenant_id", "sucursal_id", "lower"("nombre")) WHERE ("activo" = true);



CREATE INDEX "idx_producto_vencimiento" ON "public"."producto" USING "btree" ("tenant_id", "fecha_vencimiento") WHERE (("activo" = true) AND ("fecha_vencimiento" IS NOT NULL));



CREATE INDEX "idx_promocion_activa_vigente" ON "public"."promocion" USING "btree" ("tenant_id") WHERE ("activa" = true);



CREATE INDEX "idx_promocion_combo_item_producto" ON "public"."promocion_combo_item" USING "btree" ("producto_id");



CREATE INDEX "idx_promocion_combo_item_tenant" ON "public"."promocion_combo_item" USING "btree" ("tenant_id");



CREATE INDEX "idx_promocion_tenant" ON "public"."promocion" USING "btree" ("tenant_id");



CREATE INDEX "idx_promocion_tenant_sucursal_lookup" ON "public"."promocion" USING "btree" ("tenant_id", "sucursal_id", "updated_at" DESC);



CREATE INDEX "idx_proveedor_tenant" ON "public"."proveedor" USING "btree" ("tenant_id");



CREATE INDEX "idx_proveedor_tenant_nombre_lower" ON "public"."proveedor" USING "btree" ("tenant_id", "lower"("nombre")) WHERE ("activo" = true);



CREATE INDEX "idx_radar_inflacion_periodo" ON "public"."radar_inflacion" USING "btree" ("periodo" DESC);



CREATE INDEX "idx_rol_permiso_permiso" ON "public"."rol_permiso" USING "btree" ("permiso_id");



CREATE INDEX "idx_rol_tenant_activo" ON "public"."rol" USING "btree" ("tenant_id", "activo");



CREATE UNIQUE INDEX "idx_rol_tenant_nombre_unique" ON "public"."rol" USING "btree" ("tenant_id", "lower"("nombre"));



CREATE UNIQUE INDEX "idx_rol_tenant_slug_unique" ON "public"."rol" USING "btree" ("tenant_id", "lower"("slug"));



CREATE INDEX "idx_stock_sucursal_bajo" ON "public"."stock_sucursal" USING "btree" ("tenant_id", "sucursal_id") WHERE ("stock_actual" <= "stock_minimo");



CREATE INDEX "idx_stock_sucursal_sucursal" ON "public"."stock_sucursal" USING "btree" ("sucursal_id");



CREATE INDEX "idx_stock_sucursal_tenant" ON "public"."stock_sucursal" USING "btree" ("tenant_id");



CREATE INDEX "idx_sucursal_tenant" ON "public"."sucursal" USING "btree" ("tenant_id");



CREATE INDEX "idx_sucursal_tenant_activa" ON "public"."sucursal" USING "btree" ("tenant_id", "activa");



CREATE UNIQUE INDEX "idx_sucursal_tenant_codigo_unique" ON "public"."sucursal" USING "btree" ("tenant_id", "lower"("codigo"));



CREATE UNIQUE INDEX "idx_sucursal_tenant_nombre_unique" ON "public"."sucursal" USING "btree" ("tenant_id", "lower"("nombre"));



CREATE INDEX "idx_super_admin_contexto_log_usuario" ON "public"."super_admin_contexto_log" USING "btree" ("usuario_id", "created_at" DESC);



CREATE INDEX "idx_super_admin_tenant_acceso_tenant" ON "public"."super_admin_tenant_acceso" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_tenant_codigo_acceso_unique" ON "public"."tenant" USING "btree" ("codigo_acceso");



CREATE INDEX "idx_tenant_cuit" ON "public"."tenant" USING "btree" ("cuit") WHERE ("cuit" IS NOT NULL);



CREATE INDEX "idx_usuario_email" ON "public"."usuario" USING "btree" ("email");



CREATE INDEX "idx_usuario_pedido_wf_estado_lookup" ON "public"."usuario_pedido_workflow_estado" USING "btree" ("tenant_id", "usuario_id");



CREATE INDEX "idx_usuario_rol_rol" ON "public"."usuario_rol" USING "btree" ("rol_id");



CREATE INDEX "idx_usuario_sucursal_default" ON "public"."usuario" USING "btree" ("sucursal_default_id");



CREATE INDEX "idx_usuario_sucursal_sucursal" ON "public"."usuario_sucursal" USING "btree" ("sucursal_id");



CREATE INDEX "idx_usuario_tenant" ON "public"."usuario" USING "btree" ("tenant_id");



CREATE INDEX "idx_usuario_tenant_deleted_at" ON "public"."usuario" USING "btree" ("tenant_id", "deleted_at");



CREATE INDEX "idx_whatsapp_attachment_download_status" ON "public"."whatsapp_inbound_attachment" USING "btree" ("tenant_id", "download_status", "created_at");



CREATE INDEX "idx_whatsapp_attachment_tenant" ON "public"."whatsapp_inbound_attachment" USING "btree" ("tenant_id");



CREATE INDEX "idx_whatsapp_branch_rule_lookup" ON "public"."whatsapp_branch_rule" USING "btree" ("tenant_id", "activa", "from_wa_id", "phone_number_id", "prioridad" DESC);



CREATE INDEX "idx_whatsapp_channel_tenant" ON "public"."whatsapp_channel" USING "btree" ("tenant_id");



CREATE INDEX "idx_whatsapp_inbound_tenant_received" ON "public"."whatsapp_inbound_message" USING "btree" ("tenant_id", "received_at" DESC);



CREATE INDEX "idx_whatsapp_job_branch_pending" ON "public"."whatsapp_processing_job" USING "btree" ("tenant_id", "status", "branch_prompt_deadline_at");



CREATE INDEX "idx_whatsapp_job_event_job_created" ON "public"."whatsapp_job_event" USING "btree" ("job_id", "created_at" DESC);



CREATE INDEX "idx_whatsapp_job_target" ON "public"."whatsapp_processing_job" USING "btree" ("tenant_id", "target_entity_type", "target_entity_id");



CREATE INDEX "idx_whatsapp_job_tenant_status_created" ON "public"."whatsapp_processing_job" USING "btree" ("tenant_id", "status", "created_at" DESC);



CREATE INDEX "idx_whatsapp_outbound_retry" ON "public"."whatsapp_outbound_message" USING "btree" ("tenant_id", "status", "retry_count", "created_at");



CREATE INDEX "idx_whatsapp_outbound_status" ON "public"."whatsapp_outbound_message" USING "btree" ("tenant_id", "status", "created_at");



CREATE UNIQUE INDEX "uk_caja_turno_caja_abierto" ON "public"."caja_turno" USING "btree" ("caja_id") WHERE ("estado" = 'abierto'::"text");



CREATE UNIQUE INDEX "uk_caja_turno_usuario_abierto" ON "public"."caja_turno" USING "btree" ("usuario_id") WHERE ("estado" = 'abierto'::"text");



CREATE UNIQUE INDEX "uk_comprobante_ticket_caja_numero" ON "public"."comprobante" USING "btree" ("caja_uuid", "numero_caja") WHERE (("tipo" = 'ticket'::"public"."tipo_comprobante") AND ("caja_uuid" IS NOT NULL) AND ("numero_caja" IS NOT NULL));



CREATE UNIQUE INDEX "uq_cierre_z_diario_por_apertura" ON "public"."cierre_z" USING "btree" ("caja_apertura_id") WHERE (("tipo_cierre" = 'diario'::"text") AND ("caja_apertura_id" IS NOT NULL));



CREATE UNIQUE INDEX "uq_cierre_z_parcial_rango" ON "public"."cierre_z" USING "btree" ("tenant_id", "caja_id", "tipo_cierre", "rango_desde", "rango_hasta") WHERE ("tipo_cierre" = 'parcial'::"text");



CREATE UNIQUE INDEX "uq_cuenta_corriente_tenant_cliente" ON "public"."cuenta_corriente" USING "btree" ("tenant_id", "cliente_id") WHERE ("cliente_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_cuenta_corriente_tenant_proveedor" ON "public"."cuenta_corriente" USING "btree" ("tenant_id", "proveedor_id") WHERE ("proveedor_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_pago_proveedor_fact_tenant_comprobante" ON "public"."pago_proveedor_factura" USING "btree" ("tenant_id", "comprobante_id") WHERE ("comprobante_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "proveedor_inactivo_desactiva_productos" AFTER UPDATE OF "activo" ON "public"."proveedor" FOR EACH ROW WHEN ((("new"."activo" = false) AND ("old"."activo" IS DISTINCT FROM false))) EXECUTE FUNCTION "public"."proveedor_inactivo_desactiva_productos"();



CREATE OR REPLACE TRIGGER "set_arca_config_updated_at" BEFORE UPDATE ON "public"."arca_config" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_caja_turno_updated_at" BEFORE UPDATE ON "public"."caja_turno" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_caja_updated_at" BEFORE UPDATE ON "public"."caja" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_cierre_mensual_updated_at" BEFORE UPDATE ON "public"."cierre_mensual" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_cliente_updated_at" BEFORE UPDATE ON "public"."cliente" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_cobranza_factura_updated_at" BEFORE UPDATE ON "public"."cobranza_factura" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_comprobante_updated_at" BEFORE UPDATE ON "public"."comprobante" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_cuenta_corriente_updated_at" BEFORE UPDATE ON "public"."cuenta_corriente" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_lector_factura_log_updated_at" BEFORE UPDATE ON "public"."lector_factura_log" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_lista_precios_updated_at" BEFORE UPDATE ON "public"."lista_precios" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_medio_pago_updated_at" BEFORE UPDATE ON "public"."medio_pago" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_modulo_config_updated_at" BEFORE UPDATE ON "public"."modulo_config" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_mp_point_config_updated_at" BEFORE UPDATE ON "public"."mp_point_config" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_mp_qr_config_updated_at" BEFORE UPDATE ON "public"."mp_qr_config" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_pago_proveedor_factura_updated_at" BEFORE UPDATE ON "public"."pago_proveedor_factura" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_pedido_estado_workflow_updated_at" BEFORE UPDATE ON "public"."pedido_estado_workflow" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_pedido_updated_at" BEFORE UPDATE ON "public"."pedido" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_precio_sucursal_updated_at" BEFORE UPDATE ON "public"."precio_sucursal" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_producto_ganancia_tramo_updated_at" BEFORE UPDATE ON "public"."producto_ganancia_tramo" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_producto_lote_ingreso_updated_at" BEFORE UPDATE ON "public"."producto_lote_ingreso" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_producto_proveedor_updated_at" BEFORE UPDATE ON "public"."producto_proveedor" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_producto_updated_at" BEFORE UPDATE ON "public"."producto" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_promocion_updated_at" BEFORE UPDATE ON "public"."promocion" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_proveedor_updated_at" BEFORE UPDATE ON "public"."proveedor" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_radar_inflacion_updated_at" BEFORE UPDATE ON "public"."radar_inflacion" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_rol_updated_at" BEFORE UPDATE ON "public"."rol" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_stock_sucursal_updated_at" BEFORE UPDATE ON "public"."stock_sucursal" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_sucursal_updated_at" BEFORE UPDATE ON "public"."sucursal" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_tenant_updated_at" BEFORE UPDATE ON "public"."tenant" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "set_usuario_credencial_local_updated_at" BEFORE UPDATE ON "public"."usuario_credencial_local" FOR EACH ROW EXECUTE FUNCTION "public"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "tenant_codigo_acceso_before_ins_upd" BEFORE INSERT OR UPDATE OF "codigo_acceso", "nombre" ON "public"."tenant" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_tenant_access_code"();



CREATE OR REPLACE TRIGGER "tenant_crea_sucursal_por_defecto" AFTER INSERT ON "public"."tenant" FOR EACH ROW EXECUTE FUNCTION "public"."tenant_crea_sucursal_por_defecto"();



CREATE OR REPLACE TRIGGER "trg_cliente_ensure_membresia_sucursal" AFTER INSERT ON "public"."cliente" FOR EACH ROW EXECUTE FUNCTION "public"."trg_cliente_ensure_membresia_sucursal"();



CREATE OR REPLACE TRIGGER "trg_producto_after_insert_stock_sucursal" AFTER INSERT ON "public"."producto" FOR EACH ROW EXECUTE FUNCTION "public"."trg_producto_after_insert_stock_sucursal"();



CREATE OR REPLACE TRIGGER "trg_producto_after_update_sync_stock_sucursal" AFTER UPDATE OF "stock_actual", "stock_minimo", "ubicacion" ON "public"."producto" FOR EACH ROW EXECUTE FUNCTION "public"."trg_producto_after_update_sync_stock_sucursal"();



CREATE OR REPLACE TRIGGER "trg_producto_lote_refresh_vencimiento_aiu" AFTER INSERT OR DELETE OR UPDATE ON "public"."producto_lote_ingreso" FOR EACH ROW EXECUTE FUNCTION "public"."trg_producto_lote_refresh_vencimiento"();



CREATE OR REPLACE TRIGGER "trg_stock_sucursal_after_update_sync_producto" AFTER UPDATE OF "stock_actual", "stock_minimo", "ubicacion" ON "public"."stock_sucursal" FOR EACH ROW EXECUTE FUNCTION "public"."trg_stock_sucursal_after_update_sync_producto"();



CREATE OR REPLACE TRIGGER "usuario_tenant_contexto_guard" BEFORE UPDATE OF "tenant_contexto_id" ON "public"."usuario" FOR EACH ROW EXECUTE FUNCTION "public"."usuario_guard_tenant_contexto"();



ALTER TABLE ONLY "public"."arca_config"
    ADD CONSTRAINT "arca_config_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."arca_config"
    ADD CONSTRAINT "arca_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."arca_log"
    ADD CONSTRAINT "arca_log_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobante"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."arca_log"
    ADD CONSTRAINT "arca_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."caja_apertura"
    ADD CONSTRAINT "caja_apertura_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."caja_apertura"
    ADD CONSTRAINT "caja_apertura_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."caja_apertura"
    ADD CONSTRAINT "caja_apertura_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."caja_gasto"
    ADD CONSTRAINT "caja_gasto_caja_apertura_id_fkey" FOREIGN KEY ("caja_apertura_id") REFERENCES "public"."caja_apertura"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."caja_gasto"
    ADD CONSTRAINT "caja_gasto_cierre_z_id_fkey" FOREIGN KEY ("cierre_z_id") REFERENCES "public"."cierre_z"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."caja_gasto"
    ADD CONSTRAINT "caja_gasto_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."caja_gasto"
    ADD CONSTRAINT "caja_gasto_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."caja_gasto"
    ADD CONSTRAINT "caja_gasto_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."caja_gasto"
    ADD CONSTRAINT "caja_gasto_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."caja"
    ADD CONSTRAINT "caja_mp_point_config_id_fkey" FOREIGN KEY ("mp_point_config_id") REFERENCES "public"."mp_point_config"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."caja"
    ADD CONSTRAINT "caja_mp_qr_config_id_fkey" FOREIGN KEY ("mp_qr_config_id") REFERENCES "public"."mp_qr_config"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."caja"
    ADD CONSTRAINT "caja_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."caja"
    ADD CONSTRAINT "caja_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."caja_turno"
    ADD CONSTRAINT "caja_turno_caja_id_fkey" FOREIGN KEY ("caja_id") REFERENCES "public"."caja"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."caja_turno"
    ADD CONSTRAINT "caja_turno_cierre_z_id_fkey" FOREIGN KEY ("cierre_z_id") REFERENCES "public"."cierre_z"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."caja_turno"
    ADD CONSTRAINT "caja_turno_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."caja_turno"
    ADD CONSTRAINT "caja_turno_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."caja_usuario"
    ADD CONSTRAINT "caja_usuario_caja_id_fkey" FOREIGN KEY ("caja_id") REFERENCES "public"."caja"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."caja"
    ADD CONSTRAINT "caja_usuario_default_id_fkey" FOREIGN KEY ("usuario_default_id") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."caja_usuario"
    ADD CONSTRAINT "caja_usuario_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."caja_usuario"
    ADD CONSTRAINT "caja_usuario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categoria"
    ADD CONSTRAINT "categoria_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."categoria"
    ADD CONSTRAINT "categoria_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cierre_mensual"
    ADD CONSTRAINT "cierre_mensual_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cierre_z"
    ADD CONSTRAINT "cierre_z_caja_apertura_id_fkey" FOREIGN KEY ("caja_apertura_id") REFERENCES "public"."caja_apertura"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cierre_z_medio_pago"
    ADD CONSTRAINT "cierre_z_medio_pago_cierre_z_id_fkey" FOREIGN KEY ("cierre_z_id") REFERENCES "public"."cierre_z"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cierre_z_medio_pago"
    ADD CONSTRAINT "cierre_z_medio_pago_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cierre_z"
    ADD CONSTRAINT "cierre_z_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cierre_z"
    ADD CONSTRAINT "cierre_z_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cierre_z"
    ADD CONSTRAINT "cierre_z_usuario_cierre_id_fkey" FOREIGN KEY ("usuario_cierre_id") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cliente_sucursal"
    ADD CONSTRAINT "cliente_sucursal_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cliente"
    ADD CONSTRAINT "cliente_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cliente_sucursal"
    ADD CONSTRAINT "cliente_sucursal_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cliente_sucursal"
    ADD CONSTRAINT "cliente_sucursal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cliente"
    ADD CONSTRAINT "cliente_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cobranza_factura"
    ADD CONSTRAINT "cobranza_factura_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cobranza_factura"
    ADD CONSTRAINT "cobranza_factura_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobante"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cobranza_factura"
    ADD CONSTRAINT "cobranza_factura_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cobranza_pago"
    ADD CONSTRAINT "cobranza_pago_cobranza_factura_id_fkey" FOREIGN KEY ("cobranza_factura_id") REFERENCES "public"."cobranza_factura"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cobranza_pago"
    ADD CONSTRAINT "cobranza_pago_recibo_comprobante_id_fkey" FOREIGN KEY ("recibo_comprobante_id") REFERENCES "public"."comprobante"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cobranza_pago"
    ADD CONSTRAINT "cobranza_pago_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cobranza_pago"
    ADD CONSTRAINT "cobranza_pago_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."comprobante"
    ADD CONSTRAINT "comprobante_caja_turno_id_fkey" FOREIGN KEY ("caja_turno_id") REFERENCES "public"."caja_turno"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."comprobante"
    ADD CONSTRAINT "comprobante_caja_uuid_fkey" FOREIGN KEY ("caja_uuid") REFERENCES "public"."caja"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."comprobante"
    ADD CONSTRAINT "comprobante_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."comprobante"
    ADD CONSTRAINT "comprobante_documento_asociado_id_fkey" FOREIGN KEY ("documento_asociado_id") REFERENCES "public"."comprobante"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."comprobante"
    ADD CONSTRAINT "comprobante_fiscalizado_por_id_fkey" FOREIGN KEY ("fiscalizado_por_id") REFERENCES "public"."comprobante"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."comprobante_item"
    ADD CONSTRAINT "comprobante_item_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobante"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comprobante_item"
    ADD CONSTRAINT "comprobante_item_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comprobante_item"
    ADD CONSTRAINT "comprobante_item_promocion_id_fkey" FOREIGN KEY ("promocion_id") REFERENCES "public"."promocion"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."comprobante"
    ADD CONSTRAINT "comprobante_medio_pago_opcion_id_fkey" FOREIGN KEY ("medio_pago_opcion_id") REFERENCES "public"."medio_pago_opcion"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."comprobante"
    ADD CONSTRAINT "comprobante_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."comprobante"
    ADD CONSTRAINT "comprobante_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."comprobante"
    ADD CONSTRAINT "comprobante_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comprobante"
    ADD CONSTRAINT "comprobante_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cuenta_corriente"
    ADD CONSTRAINT "cuenta_corriente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cuenta_corriente"
    ADD CONSTRAINT "cuenta_corriente_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cuenta_corriente"
    ADD CONSTRAINT "cuenta_corriente_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."importacion_archivo"
    ADD CONSTRAINT "importacion_archivo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."importacion_log"
    ADD CONSTRAINT "importacion_log_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."importacion_log"
    ADD CONSTRAINT "importacion_log_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."importacion_log"
    ADD CONSTRAINT "importacion_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."importacion_log"
    ADD CONSTRAINT "importacion_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lector_factura_log"
    ADD CONSTRAINT "lector_factura_log_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lector_factura_log"
    ADD CONSTRAINT "lector_factura_log_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobante"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lector_factura_log"
    ADD CONSTRAINT "lector_factura_log_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lector_factura_log"
    ADD CONSTRAINT "lector_factura_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lector_factura_log"
    ADD CONSTRAINT "lector_factura_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lista_precios_item"
    ADD CONSTRAINT "lista_precios_item_lista_id_fkey" FOREIGN KEY ("lista_id") REFERENCES "public"."lista_precios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lista_precios_item"
    ADD CONSTRAINT "lista_precios_item_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lista_precios"
    ADD CONSTRAINT "lista_precios_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."lista_precios"
    ADD CONSTRAINT "lista_precios_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lista_precios"
    ADD CONSTRAINT "lista_precios_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lista_precios"
    ADD CONSTRAINT "lista_precios_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."medio_pago_opcion"
    ADD CONSTRAINT "medio_pago_opcion_medio_pago_id_fkey" FOREIGN KEY ("medio_pago_id") REFERENCES "public"."medio_pago"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."medio_pago_rapido"
    ADD CONSTRAINT "medio_pago_rapido_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."medio_pago"
    ADD CONSTRAINT "medio_pago_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."modulo_config"
    ADD CONSTRAINT "modulo_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."movimiento"
    ADD CONSTRAINT "movimiento_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."movimiento"
    ADD CONSTRAINT "movimiento_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."movimiento"
    ADD CONSTRAINT "movimiento_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id");



ALTER TABLE ONLY "public"."movimiento"
    ADD CONSTRAINT "movimiento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."movimiento"
    ADD CONSTRAINT "movimiento_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mp_point_config"
    ADD CONSTRAINT "mp_point_config_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mp_point_config"
    ADD CONSTRAINT "mp_point_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mp_qr_config"
    ADD CONSTRAINT "mp_qr_config_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mp_qr_config"
    ADD CONSTRAINT "mp_qr_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mp_qr_webhook_log"
    ADD CONSTRAINT "mp_qr_webhook_log_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobante"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mp_qr_webhook_log"
    ADD CONSTRAINT "mp_qr_webhook_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pago"
    ADD CONSTRAINT "pago_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pago"
    ADD CONSTRAINT "pago_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobante"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pago"
    ADD CONSTRAINT "pago_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "public"."cuenta_corriente"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pago_proveedor_factura"
    ADD CONSTRAINT "pago_proveedor_factura_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobante"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pago_proveedor_factura"
    ADD CONSTRAINT "pago_proveedor_factura_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pago_proveedor_factura"
    ADD CONSTRAINT "pago_proveedor_factura_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pago"
    ADD CONSTRAINT "pago_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pago_proveedor_movimiento"
    ADD CONSTRAINT "pago_proveedor_movimiento_pago_proveedor_factura_id_fkey" FOREIGN KEY ("pago_proveedor_factura_id") REFERENCES "public"."pago_proveedor_factura"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pago_proveedor_movimiento"
    ADD CONSTRAINT "pago_proveedor_movimiento_recibo_comprobante_id_fkey" FOREIGN KEY ("recibo_comprobante_id") REFERENCES "public"."comprobante"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pago_proveedor_movimiento"
    ADD CONSTRAINT "pago_proveedor_movimiento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pago_proveedor_movimiento"
    ADD CONSTRAINT "pago_proveedor_movimiento_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pago"
    ADD CONSTRAINT "pago_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pago"
    ADD CONSTRAINT "pago_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pedido"
    ADD CONSTRAINT "pedido_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pedido"
    ADD CONSTRAINT "pedido_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobante"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pedido_estado_workflow"
    ADD CONSTRAINT "pedido_estado_workflow_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pedido_estado_workflow_transicion"
    ADD CONSTRAINT "pedido_estado_workflow_transicion_desde_id_fkey" FOREIGN KEY ("desde_id") REFERENCES "public"."pedido_estado_workflow"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pedido_estado_workflow_transicion"
    ADD CONSTRAINT "pedido_estado_workflow_transicion_hacia_id_fkey" FOREIGN KEY ("hacia_id") REFERENCES "public"."pedido_estado_workflow"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pedido_estado_workflow_transicion"
    ADD CONSTRAINT "pedido_estado_workflow_transicion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pedido_item"
    ADD CONSTRAINT "pedido_item_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pedido_item"
    ADD CONSTRAINT "pedido_item_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pedido_item"
    ADD CONSTRAINT "pedido_item_promocion_id_fkey" FOREIGN KEY ("promocion_id") REFERENCES "public"."promocion"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pedido"
    ADD CONSTRAINT "pedido_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pedido"
    ADD CONSTRAINT "pedido_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pedido"
    ADD CONSTRAINT "pedido_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pedido"
    ADD CONSTRAINT "pedido_workflow_estado_id_fkey" FOREIGN KEY ("workflow_estado_id") REFERENCES "public"."pedido_estado_workflow"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."precio_historial"
    ADD CONSTRAINT "precio_historial_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."precio_historial"
    ADD CONSTRAINT "precio_historial_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."precio_sucursal"
    ADD CONSTRAINT "precio_sucursal_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."precio_sucursal"
    ADD CONSTRAINT "precio_sucursal_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."precio_sucursal"
    ADD CONSTRAINT "precio_sucursal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto"
    ADD CONSTRAINT "producto_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."producto_ganancia_tramo"
    ADD CONSTRAINT "producto_ganancia_tramo_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_ganancia_tramo"
    ADD CONSTRAINT "producto_ganancia_tramo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_lote_ingreso"
    ADD CONSTRAINT "producto_lote_ingreso_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."usuario"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."producto_lote_ingreso"
    ADD CONSTRAINT "producto_lote_ingreso_importacion_log_id_fkey" FOREIGN KEY ("importacion_log_id") REFERENCES "public"."importacion_log"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."producto_lote_ingreso"
    ADD CONSTRAINT "producto_lote_ingreso_lector_factura_log_id_fkey" FOREIGN KEY ("lector_factura_log_id") REFERENCES "public"."lector_factura_log"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."producto_lote_ingreso"
    ADD CONSTRAINT "producto_lote_ingreso_movimiento_id_fkey" FOREIGN KEY ("movimiento_id") REFERENCES "public"."movimiento"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."producto_lote_ingreso"
    ADD CONSTRAINT "producto_lote_ingreso_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_lote_ingreso"
    ADD CONSTRAINT "producto_lote_ingreso_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."producto_lote_ingreso"
    ADD CONSTRAINT "producto_lote_ingreso_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."producto_lote_ingreso"
    ADD CONSTRAINT "producto_lote_ingreso_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_promocion"
    ADD CONSTRAINT "producto_promocion_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_promocion"
    ADD CONSTRAINT "producto_promocion_promocion_id_fkey" FOREIGN KEY ("promocion_id") REFERENCES "public"."promocion"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_promocion"
    ADD CONSTRAINT "producto_promocion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto"
    ADD CONSTRAINT "producto_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."producto_proveedor"
    ADD CONSTRAINT "producto_proveedor_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_proveedor"
    ADD CONSTRAINT "producto_proveedor_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_proveedor"
    ADD CONSTRAINT "producto_proveedor_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto"
    ADD CONSTRAINT "producto_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."producto"
    ADD CONSTRAINT "producto_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promocion_combo_item"
    ADD CONSTRAINT "promocion_combo_item_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promocion_combo_item"
    ADD CONSTRAINT "promocion_combo_item_promocion_id_fkey" FOREIGN KEY ("promocion_id") REFERENCES "public"."promocion"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promocion_combo_item"
    ADD CONSTRAINT "promocion_combo_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promocion"
    ADD CONSTRAINT "promocion_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."promocion"
    ADD CONSTRAINT "promocion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proveedor"
    ADD CONSTRAINT "proveedor_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."proveedor"
    ADD CONSTRAINT "proveedor_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rol_permiso"
    ADD CONSTRAINT "rol_permiso_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "public"."permiso"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rol_permiso"
    ADD CONSTRAINT "rol_permiso_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "public"."rol"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rol"
    ADD CONSTRAINT "rol_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_sucursal"
    ADD CONSTRAINT "stock_sucursal_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_sucursal"
    ADD CONSTRAINT "stock_sucursal_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stock_sucursal"
    ADD CONSTRAINT "stock_sucursal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sucursal"
    ADD CONSTRAINT "sucursal_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."super_admin_contexto_log"
    ADD CONSTRAINT "super_admin_contexto_log_tenant_id_next_fkey" FOREIGN KEY ("tenant_id_next") REFERENCES "public"."tenant"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."super_admin_contexto_log"
    ADD CONSTRAINT "super_admin_contexto_log_tenant_id_prev_fkey" FOREIGN KEY ("tenant_id_prev") REFERENCES "public"."tenant"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."super_admin_contexto_log"
    ADD CONSTRAINT "super_admin_contexto_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."super_admin_tenant_acceso"
    ADD CONSTRAINT "super_admin_tenant_acceso_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."super_admin_tenant_acceso"
    ADD CONSTRAINT "super_admin_tenant_acceso_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario_credencial_local"
    ADD CONSTRAINT "usuario_credencial_local_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario_credencial_local"
    ADD CONSTRAINT "usuario_credencial_local_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario"
    ADD CONSTRAINT "usuario_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario_pedido_workflow_estado"
    ADD CONSTRAINT "usuario_pedido_workflow_estado_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario_pedido_workflow_estado"
    ADD CONSTRAINT "usuario_pedido_workflow_estado_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario_pedido_workflow_estado"
    ADD CONSTRAINT "usuario_pedido_workflow_estado_workflow_estado_id_fkey" FOREIGN KEY ("workflow_estado_id") REFERENCES "public"."pedido_estado_workflow"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario_rol"
    ADD CONSTRAINT "usuario_rol_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "public"."rol"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario_rol"
    ADD CONSTRAINT "usuario_rol_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario"
    ADD CONSTRAINT "usuario_sucursal_default_id_fkey" FOREIGN KEY ("sucursal_default_id") REFERENCES "public"."sucursal"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."usuario_sucursal"
    ADD CONSTRAINT "usuario_sucursal_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario_sucursal"
    ADD CONSTRAINT "usuario_sucursal_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuario"
    ADD CONSTRAINT "usuario_tenant_contexto_id_fkey" FOREIGN KEY ("tenant_contexto_id") REFERENCES "public"."tenant"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."usuario"
    ADD CONSTRAINT "usuario_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_branch_rule"
    ADD CONSTRAINT "whatsapp_branch_rule_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_branch_rule"
    ADD CONSTRAINT "whatsapp_branch_rule_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "public"."sucursal"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_branch_rule"
    ADD CONSTRAINT "whatsapp_branch_rule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_channel"
    ADD CONSTRAINT "whatsapp_channel_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_inbound_attachment"
    ADD CONSTRAINT "whatsapp_inbound_attachment_inbound_message_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."whatsapp_inbound_message"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_inbound_attachment"
    ADD CONSTRAINT "whatsapp_inbound_attachment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_inbound_message"
    ADD CONSTRAINT "whatsapp_inbound_message_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_job_event"
    ADD CONSTRAINT "whatsapp_job_event_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."whatsapp_processing_job"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_job_event"
    ADD CONSTRAINT "whatsapp_job_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_outbound_message"
    ADD CONSTRAINT "whatsapp_outbound_message_related_job_id_fkey" FOREIGN KEY ("related_job_id") REFERENCES "public"."whatsapp_processing_job"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_outbound_message"
    ADD CONSTRAINT "whatsapp_outbound_message_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_processing_job"
    ADD CONSTRAINT "whatsapp_processing_job_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."sucursal"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."whatsapp_processing_job"
    ADD CONSTRAINT "whatsapp_processing_job_inbound_attachment_id_fkey" FOREIGN KEY ("inbound_attachment_id") REFERENCES "public"."whatsapp_inbound_attachment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_processing_job"
    ADD CONSTRAINT "whatsapp_processing_job_inbound_message_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."whatsapp_inbound_message"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."whatsapp_processing_job"
    ADD CONSTRAINT "whatsapp_processing_job_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE CASCADE;



ALTER TABLE "public"."arca_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."arca_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."caja" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."caja_apertura" ENABLE ROW LEVEL SECURITY;



ALTER TABLE "public"."caja_gasto" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."caja_turno" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."caja_usuario" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categoria" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cierre_mensual" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cierre_z" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cierre_z_medio_pago" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cliente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cliente_sucursal" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cobranza_factura" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cobranza_pago" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."comprobante" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."comprobante_item" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credencial_local_delete_tenant" ON "public"."usuario_credencial_local" FOR DELETE TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "credencial_local_insert_tenant" ON "public"."usuario_credencial_local" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "credencial_local_select_tenant" ON "public"."usuario_credencial_local" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "credencial_local_update_tenant" ON "public"."usuario_credencial_local" FOR UPDATE TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."cuenta_corriente" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."importacion_archivo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."importacion_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lector_factura_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lista_precios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lista_precios_item" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."medio_pago" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."medio_pago_opcion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."medio_pago_rapido" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modulo_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."movimiento" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mp_point_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mp_qr_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mp_qr_webhook_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pago" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pago_proveedor_factura" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pago_proveedor_movimiento" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pedido" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pedido_estado_workflow" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pedido_estado_workflow_transicion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pedido_item" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permiso" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permiso_select_authenticated" ON "public"."permiso" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."precio_historial" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."precio_sucursal" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."producto" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."producto_ganancia_tramo" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."producto_lote_ingreso" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."producto_promocion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."producto_proveedor" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promocion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promocion_combo_item" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proveedor" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."radar_inflacion" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "radar_select_authenticated" ON "public"."radar_inflacion" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."rol" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rol_delete_tenant" ON "public"."rol" FOR DELETE TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "rol_insert_tenant" ON "public"."rol" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."rol_permiso" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rol_permiso_delete_tenant" ON "public"."rol_permiso" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rol" "r"
  WHERE (("r"."id" = "rol_permiso"."rol_id") AND ("r"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "rol_permiso_insert_tenant" ON "public"."rol_permiso" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."rol" "r"
  WHERE (("r"."id" = "rol_permiso"."rol_id") AND ("r"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "rol_permiso_select_tenant" ON "public"."rol_permiso" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."rol" "r"
  WHERE (("r"."id" = "rol_permiso"."rol_id") AND ("r"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "rol_select_tenant" ON "public"."rol" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "rol_update_tenant" ON "public"."rol" FOR UPDATE TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."stock_sucursal" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sucursal" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sucursal_delete_tenant" ON "public"."sucursal" FOR DELETE TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "sucursal_insert_tenant" ON "public"."sucursal" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "sucursal_select_tenant" ON "public"."sucursal" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "sucursal_update_tenant" ON "public"."sucursal" FOR UPDATE TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."super_admin_contexto_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."super_admin_tenant_acceso" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "super_admin_tenant_acceso_select_own" ON "public"."super_admin_tenant_acceso" FOR SELECT TO "authenticated" USING (("usuario_id" = "auth"."uid"()));



ALTER TABLE "public"."tenant" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_delete_caja" ON "public"."caja" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_caja_apertura" ON "public"."caja_apertura" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_caja_gasto" ON "public"."caja_gasto" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_caja_turno" ON "public"."caja_turno" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_caja_usuario" ON "public"."caja_usuario" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_categoria" ON "public"."categoria" FOR DELETE USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_delete_cierre_mensual" ON "public"."cierre_mensual" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_cierre_z" ON "public"."cierre_z" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_cierre_z_medio" ON "public"."cierre_z_medio_pago" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_cliente" ON "public"."cliente" FOR DELETE USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_delete_cobranza_factura" ON "public"."cobranza_factura" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_cobranza_pago" ON "public"."cobranza_pago" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_comprobante" ON "public"."comprobante" FOR DELETE USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_delete_comprobante_item" ON "public"."comprobante_item" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."comprobante"
  WHERE (("comprobante"."id" = "comprobante_item"."comprobante_id") AND ("comprobante"."tenant_id" = "public"."tenant_id"())))));



CREATE POLICY "tenant_delete_cuenta_corriente" ON "public"."cuenta_corriente" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_importacion_archivo" ON "public"."importacion_archivo" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_lector_factura_log" ON "public"."lector_factura_log" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_lista_precios" ON "public"."lista_precios" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_lista_precios_item" ON "public"."lista_precios_item" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."lista_precios" "lp"
  WHERE (("lp"."id" = "lista_precios_item"."lista_id") AND ("lp"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "tenant_delete_medio_pago" ON "public"."medio_pago" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_medio_pago_opcion" ON "public"."medio_pago_opcion" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."medio_pago" "mp"
  WHERE (("mp"."id" = "medio_pago_opcion"."medio_pago_id") AND ("mp"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "tenant_delete_medio_pago_rapido" ON "public"."medio_pago_rapido" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_mp_point_config" ON "public"."mp_point_config" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_mp_qr_config" ON "public"."mp_qr_config" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_pago" ON "public"."pago" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_pago_proveedor_factura" ON "public"."pago_proveedor_factura" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_pago_proveedor_mov" ON "public"."pago_proveedor_movimiento" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_pedido" ON "public"."pedido" FOR DELETE USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_delete_pedido_estado_workflow" ON "public"."pedido_estado_workflow" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_pedido_estado_workflow_transicion" ON "public"."pedido_estado_workflow_transicion" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_pedido_item" ON "public"."pedido_item" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."pedido"
  WHERE (("pedido"."id" = "pedido_item"."pedido_id") AND ("pedido"."tenant_id" = "public"."tenant_id"())))));



CREATE POLICY "tenant_delete_precio_sucursal" ON "public"."precio_sucursal" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_producto" ON "public"."producto" FOR DELETE USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_delete_producto_ganancia_tramo" ON "public"."producto_ganancia_tramo" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_producto_lote_ingreso" ON "public"."producto_lote_ingreso" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_producto_promocion" ON "public"."producto_promocion" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_producto_proveedor" ON "public"."producto_proveedor" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_promocion" ON "public"."promocion" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_promocion_combo_item" ON "public"."promocion_combo_item" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_proveedor" ON "public"."proveedor" FOR DELETE USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_delete_stock_sucursal" ON "public"."stock_sucursal" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_sucursal" ON "public"."sucursal" FOR DELETE TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_delete_usuario" ON "public"."usuario" FOR DELETE USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_delete_usuario_pedido_workflow_estado" ON "public"."usuario_pedido_workflow_estado" FOR DELETE USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_arca_config" ON "public"."arca_config" FOR INSERT WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_insert_arca_log" ON "public"."arca_log" FOR INSERT WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_insert_caja" ON "public"."caja" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_caja_apertura" ON "public"."caja_apertura" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_caja_gasto" ON "public"."caja_gasto" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_caja_turno" ON "public"."caja_turno" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_caja_usuario" ON "public"."caja_usuario" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_categoria" ON "public"."categoria" FOR INSERT WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_insert_cierre_mensual" ON "public"."cierre_mensual" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_cierre_z" ON "public"."cierre_z" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_cierre_z_medio" ON "public"."cierre_z_medio_pago" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_cliente" ON "public"."cliente" FOR INSERT WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_insert_cobranza_factura" ON "public"."cobranza_factura" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_cobranza_pago" ON "public"."cobranza_pago" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_comprobante" ON "public"."comprobante" FOR INSERT WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_insert_comprobante_item" ON "public"."comprobante_item" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."comprobante"
  WHERE (("comprobante"."id" = "comprobante_item"."comprobante_id") AND ("comprobante"."tenant_id" = "public"."tenant_id"())))));



CREATE POLICY "tenant_insert_cuenta_corriente" ON "public"."cuenta_corriente" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_importacion" ON "public"."importacion_log" FOR INSERT WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_insert_importacion_archivo" ON "public"."importacion_archivo" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_lector_factura_log" ON "public"."lector_factura_log" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_lista_precios" ON "public"."lista_precios" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_lista_precios_item" ON "public"."lista_precios_item" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."lista_precios" "lp"
  WHERE (("lp"."id" = "lista_precios_item"."lista_id") AND ("lp"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "tenant_insert_medio_pago" ON "public"."medio_pago" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_medio_pago_opcion" ON "public"."medio_pago_opcion" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."medio_pago" "mp"
  WHERE (("mp"."id" = "medio_pago_opcion"."medio_pago_id") AND ("mp"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "tenant_insert_medio_pago_rapido" ON "public"."medio_pago_rapido" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_movimiento" ON "public"."movimiento" FOR INSERT WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_insert_mp_point_config" ON "public"."mp_point_config" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_mp_qr_config" ON "public"."mp_qr_config" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_pago" ON "public"."pago" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_pago_proveedor_factura" ON "public"."pago_proveedor_factura" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_pago_proveedor_mov" ON "public"."pago_proveedor_movimiento" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_pedido" ON "public"."pedido" FOR INSERT WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_insert_pedido_estado_workflow" ON "public"."pedido_estado_workflow" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_pedido_estado_workflow_transicion" ON "public"."pedido_estado_workflow_transicion" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_pedido_item" ON "public"."pedido_item" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."pedido"
  WHERE (("pedido"."id" = "pedido_item"."pedido_id") AND ("pedido"."tenant_id" = "public"."tenant_id"())))));



CREATE POLICY "tenant_insert_precio" ON "public"."precio_historial" FOR INSERT WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_insert_precio_sucursal" ON "public"."precio_sucursal" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_producto" ON "public"."producto" FOR INSERT WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_insert_producto_ganancia_tramo" ON "public"."producto_ganancia_tramo" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_producto_lote_ingreso" ON "public"."producto_lote_ingreso" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_producto_promocion" ON "public"."producto_promocion" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_producto_proveedor" ON "public"."producto_proveedor" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_promocion" ON "public"."promocion" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_promocion_combo_item" ON "public"."promocion_combo_item" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_proveedor" ON "public"."proveedor" FOR INSERT WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_insert_stock_sucursal" ON "public"."stock_sucursal" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_sucursal" ON "public"."sucursal" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_insert_usuario" ON "public"."usuario" FOR INSERT WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_insert_usuario_pedido_workflow_estado" ON "public"."usuario_pedido_workflow_estado" FOR INSERT WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select" ON "public"."tenant" FOR SELECT USING (("id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_arca_config" ON "public"."arca_config" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_arca_log" ON "public"."arca_log" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_caja" ON "public"."caja" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_caja_apertura" ON "public"."caja_apertura" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_caja_gasto" ON "public"."caja_gasto" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_caja_turno" ON "public"."caja_turno" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_caja_usuario" ON "public"."caja_usuario" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_categoria" ON "public"."categoria" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_cierre_mensual" ON "public"."cierre_mensual" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_cierre_z" ON "public"."cierre_z" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_cierre_z_medio" ON "public"."cierre_z_medio_pago" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_cliente" ON "public"."cliente" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_cobranza_factura" ON "public"."cobranza_factura" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_cobranza_pago" ON "public"."cobranza_pago" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_comprobante" ON "public"."comprobante" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_comprobante_item" ON "public"."comprobante_item" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."comprobante"
  WHERE (("comprobante"."id" = "comprobante_item"."comprobante_id") AND ("comprobante"."tenant_id" = "public"."tenant_id"())))));



CREATE POLICY "tenant_select_cuenta_corriente" ON "public"."cuenta_corriente" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_importacion" ON "public"."importacion_log" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_importacion_archivo" ON "public"."importacion_archivo" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_lector_factura_log" ON "public"."lector_factura_log" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_lista_precios" ON "public"."lista_precios" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_lista_precios_item" ON "public"."lista_precios_item" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."lista_precios" "lp"
  WHERE (("lp"."id" = "lista_precios_item"."lista_id") AND ("lp"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "tenant_select_medio_pago" ON "public"."medio_pago" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_medio_pago_opcion" ON "public"."medio_pago_opcion" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."medio_pago" "mp"
  WHERE (("mp"."id" = "medio_pago_opcion"."medio_pago_id") AND ("mp"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "tenant_select_medio_pago_rapido" ON "public"."medio_pago_rapido" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_modulo" ON "public"."modulo_config" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_movimiento" ON "public"."movimiento" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_mp_point_config" ON "public"."mp_point_config" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_mp_qr_config" ON "public"."mp_qr_config" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_pago" ON "public"."pago" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_pago_proveedor_factura" ON "public"."pago_proveedor_factura" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_pago_proveedor_mov" ON "public"."pago_proveedor_movimiento" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_pedido" ON "public"."pedido" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_pedido_estado_workflow" ON "public"."pedido_estado_workflow" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_pedido_estado_workflow_transicion" ON "public"."pedido_estado_workflow_transicion" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_pedido_item" ON "public"."pedido_item" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."pedido"
  WHERE (("pedido"."id" = "pedido_item"."pedido_id") AND ("pedido"."tenant_id" = "public"."tenant_id"())))));



CREATE POLICY "tenant_select_precio" ON "public"."precio_historial" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_precio_sucursal" ON "public"."precio_sucursal" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_producto" ON "public"."producto" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_producto_ganancia_tramo" ON "public"."producto_ganancia_tramo" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_producto_lote_ingreso" ON "public"."producto_lote_ingreso" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_producto_promocion" ON "public"."producto_promocion" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_producto_proveedor" ON "public"."producto_proveedor" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_promocion" ON "public"."promocion" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_promocion_combo_item" ON "public"."promocion_combo_item" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_proveedor" ON "public"."proveedor" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_stock_sucursal" ON "public"."stock_sucursal" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_sucursal" ON "public"."sucursal" FOR SELECT TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_select_super_admin_acceso" ON "public"."tenant" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."super_admin_tenant_acceso" "s"
  WHERE (("s"."usuario_id" = "auth"."uid"()) AND ("s"."tenant_id" = "tenant"."id")))));



CREATE POLICY "tenant_select_usuario" ON "public"."usuario" FOR SELECT USING (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_select_usuario_pedido_workflow_estado" ON "public"."usuario_pedido_workflow_estado" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update" ON "public"."tenant" FOR UPDATE USING (("id" = "public"."tenant_id"())) WITH CHECK (("id" = "public"."tenant_id"()));



CREATE POLICY "tenant_update_arca_config" ON "public"."arca_config" FOR UPDATE USING (("tenant_id" = "public"."tenant_id"())) WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_update_caja" ON "public"."caja" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_caja_apertura" ON "public"."caja_apertura" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_caja_gasto" ON "public"."caja_gasto" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_caja_turno" ON "public"."caja_turno" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_caja_usuario" ON "public"."caja_usuario" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_categoria" ON "public"."categoria" FOR UPDATE USING (("tenant_id" = "public"."tenant_id"())) WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_update_cierre_mensual" ON "public"."cierre_mensual" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_cierre_z" ON "public"."cierre_z" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_cierre_z_medio" ON "public"."cierre_z_medio_pago" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_cliente" ON "public"."cliente" FOR UPDATE USING (("tenant_id" = "public"."tenant_id"())) WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_update_cobranza_factura" ON "public"."cobranza_factura" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_cobranza_pago" ON "public"."cobranza_pago" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_comprobante" ON "public"."comprobante" FOR UPDATE USING (("tenant_id" = "public"."tenant_id"())) WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_update_comprobante_item" ON "public"."comprobante_item" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."comprobante"
  WHERE (("comprobante"."id" = "comprobante_item"."comprobante_id") AND ("comprobante"."tenant_id" = "public"."tenant_id"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."comprobante"
  WHERE (("comprobante"."id" = "comprobante_item"."comprobante_id") AND ("comprobante"."tenant_id" = "public"."tenant_id"())))));



CREATE POLICY "tenant_update_cuenta_corriente" ON "public"."cuenta_corriente" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_importacion_archivo" ON "public"."importacion_archivo" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_lector_factura_log" ON "public"."lector_factura_log" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_lista_precios" ON "public"."lista_precios" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_lista_precios_item" ON "public"."lista_precios_item" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."lista_precios" "lp"
  WHERE (("lp"."id" = "lista_precios_item"."lista_id") AND ("lp"."tenant_id" = "public"."current_tenant_id"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."lista_precios" "lp"
  WHERE (("lp"."id" = "lista_precios_item"."lista_id") AND ("lp"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "tenant_update_medio_pago" ON "public"."medio_pago" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_medio_pago_opcion" ON "public"."medio_pago_opcion" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."medio_pago" "mp"
  WHERE (("mp"."id" = "medio_pago_opcion"."medio_pago_id") AND ("mp"."tenant_id" = "public"."current_tenant_id"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."medio_pago" "mp"
  WHERE (("mp"."id" = "medio_pago_opcion"."medio_pago_id") AND ("mp"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "tenant_update_medio_pago_rapido" ON "public"."medio_pago_rapido" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_modulo" ON "public"."modulo_config" FOR UPDATE USING (("tenant_id" = "public"."tenant_id"())) WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_update_mp_point_config" ON "public"."mp_point_config" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_mp_qr_config" ON "public"."mp_qr_config" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_pago" ON "public"."pago" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_pago_proveedor_factura" ON "public"."pago_proveedor_factura" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_pago_proveedor_mov" ON "public"."pago_proveedor_movimiento" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_pedido" ON "public"."pedido" FOR UPDATE USING (("tenant_id" = "public"."tenant_id"())) WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_update_pedido_estado_workflow" ON "public"."pedido_estado_workflow" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_pedido_estado_workflow_transicion" ON "public"."pedido_estado_workflow_transicion" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_pedido_item" ON "public"."pedido_item" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."pedido"
  WHERE (("pedido"."id" = "pedido_item"."pedido_id") AND ("pedido"."tenant_id" = "public"."tenant_id"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."pedido"
  WHERE (("pedido"."id" = "pedido_item"."pedido_id") AND ("pedido"."tenant_id" = "public"."tenant_id"())))));



CREATE POLICY "tenant_update_precio_sucursal" ON "public"."precio_sucursal" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_producto" ON "public"."producto" FOR UPDATE USING (("tenant_id" = "public"."tenant_id"())) WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_update_producto_ganancia_tramo" ON "public"."producto_ganancia_tramo" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_producto_lote_ingreso" ON "public"."producto_lote_ingreso" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_producto_promocion" ON "public"."producto_promocion" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_producto_proveedor" ON "public"."producto_proveedor" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_promocion" ON "public"."promocion" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_promocion_combo_item" ON "public"."promocion_combo_item" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_proveedor" ON "public"."proveedor" FOR UPDATE USING (("tenant_id" = "public"."tenant_id"())) WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_update_stock_sucursal" ON "public"."stock_sucursal" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_sucursal" ON "public"."sucursal" FOR UPDATE TO "authenticated" USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "tenant_update_usuario" ON "public"."usuario" FOR UPDATE USING (("tenant_id" = "public"."tenant_id"())) WITH CHECK (("tenant_id" = "public"."tenant_id"()));



CREATE POLICY "tenant_update_usuario_pedido_workflow_estado" ON "public"."usuario_pedido_workflow_estado" FOR UPDATE USING (("tenant_id" = "public"."current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."usuario" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."usuario_credencial_local" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."usuario_pedido_workflow_estado" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."usuario_rol" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuario_rol_delete_tenant" ON "public"."usuario_rol" FOR DELETE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."rol" "r"
  WHERE (("r"."id" = "usuario_rol"."rol_id") AND ("r"."tenant_id" = "public"."current_tenant_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."usuario" "u"
  WHERE (("u"."id" = "usuario_rol"."usuario_id") AND ("u"."tenant_id" = "public"."current_tenant_id"()))))));



CREATE POLICY "usuario_rol_insert_tenant" ON "public"."usuario_rol" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."rol" "r"
  WHERE (("r"."id" = "usuario_rol"."rol_id") AND ("r"."tenant_id" = "public"."current_tenant_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."usuario" "u"
  WHERE (("u"."id" = "usuario_rol"."usuario_id") AND ("u"."tenant_id" = "public"."current_tenant_id"()))))));



CREATE POLICY "usuario_rol_select_tenant" ON "public"."usuario_rol" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."rol" "r"
  WHERE (("r"."id" = "usuario_rol"."rol_id") AND ("r"."tenant_id" = "public"."current_tenant_id"())))) AND (EXISTS ( SELECT 1
   FROM "public"."usuario" "u"
  WHERE (("u"."id" = "usuario_rol"."usuario_id") AND ("u"."tenant_id" = "public"."current_tenant_id"()))))));



CREATE POLICY "usuario_select_own_row" ON "public"."usuario" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."usuario_sucursal" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuario_sucursal_delete_tenant" ON "public"."usuario_sucursal" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sucursal" "s"
  WHERE (("s"."id" = "usuario_sucursal"."sucursal_id") AND ("s"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "usuario_sucursal_insert_tenant" ON "public"."usuario_sucursal" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sucursal" "s"
  WHERE (("s"."id" = "usuario_sucursal"."sucursal_id") AND ("s"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "usuario_sucursal_select_tenant" ON "public"."usuario_sucursal" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sucursal" "s"
  WHERE (("s"."id" = "usuario_sucursal"."sucursal_id") AND ("s"."tenant_id" = "public"."current_tenant_id"())))));



ALTER TABLE "public"."whatsapp_branch_rule" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_branch_rule_tenant_select" ON "public"."whatsapp_branch_rule" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."whatsapp_channel" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_channel_tenant_select" ON "public"."whatsapp_channel" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."whatsapp_inbound_attachment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_inbound_attachment_tenant_select" ON "public"."whatsapp_inbound_attachment" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."whatsapp_inbound_message" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_inbound_message_tenant_select" ON "public"."whatsapp_inbound_message" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."whatsapp_job_event" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_job_event_tenant_select" ON "public"."whatsapp_job_event" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."whatsapp_outbound_message" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_outbound_message_tenant_select" ON "public"."whatsapp_outbound_message" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));



ALTER TABLE "public"."whatsapp_processing_job" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "whatsapp_processing_job_tenant_select" ON "public"."whatsapp_processing_job" FOR SELECT USING (("tenant_id" = "public"."current_tenant_id"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."activar_plan"("p_tenant_id" "uuid", "p_plan" "public"."plan_tipo") TO "anon";
GRANT ALL ON FUNCTION "public"."activar_plan"("p_tenant_id" "uuid", "p_plan" "public"."plan_tipo") TO "authenticated";
GRANT ALL ON FUNCTION "public"."activar_plan"("p_tenant_id" "uuid", "p_plan" "public"."plan_tipo") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bootstrap_security_for_tenant"("p_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bootstrap_security_for_tenant"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."bootstrap_security_for_tenant"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bootstrap_security_for_tenant"("p_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."clonar_lista_precios_a_sucursal"("p_tenant_id" "uuid", "p_lista_id" "uuid", "p_sucursal_destino_id" "uuid", "p_usuario_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."clonar_lista_precios_a_sucursal"("p_tenant_id" "uuid", "p_lista_id" "uuid", "p_sucursal_destino_id" "uuid", "p_usuario_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."clonar_lista_precios_a_sucursal"("p_tenant_id" "uuid", "p_lista_id" "uuid", "p_sucursal_destino_id" "uuid", "p_usuario_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."clonar_productos_a_sucursal"("p_tenant_id" "uuid", "p_sucursal_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_producto_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."clonar_productos_a_sucursal"("p_tenant_id" "uuid", "p_sucursal_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_producto_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."clonar_productos_a_sucursal"("p_tenant_id" "uuid", "p_sucursal_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_producto_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."contribuir_radar"("p_rubro" "text", "p_proveedor_nombre" "text", "p_periodo" "text", "p_variacion_pct" numeric, "p_cantidad_items" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."contribuir_radar"("p_rubro" "text", "p_proveedor_nombre" "text", "p_periodo" "text", "p_variacion_pct" numeric, "p_cantidad_items" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."contribuir_radar"("p_rubro" "text", "p_proveedor_nombre" "text", "p_periodo" "text", "p_variacion_pct" numeric, "p_cantidad_items" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."ensure_tenant_access_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_tenant_access_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_tenant_access_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fecha_vencimiento_proxima_lote"("p_producto_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fecha_vencimiento_proxima_lote"("p_producto_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fecha_vencimiento_proxima_lote"("p_producto_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_permiso"("p_clave" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_permiso"("p_clave" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_permiso"("p_clave" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_permiso"("p_clave" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."lock_arca_config_for_update"("p_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lock_arca_config_for_update"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."lock_arca_config_for_update"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lock_arca_config_for_update"("p_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."materializar_stock_sucursales_faltantes"("p_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."materializar_stock_sucursales_faltantes"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."materializar_stock_sucursales_faltantes"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."materializar_stock_sucursales_faltantes"("p_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."moddatetime"() TO "postgres";
GRANT ALL ON FUNCTION "public"."moddatetime"() TO "anon";
GRANT ALL ON FUNCTION "public"."moddatetime"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."moddatetime"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalizar_texto_buscable_db"("input" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalizar_texto_buscable_db"("input" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalizar_texto_buscable_db"("input" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_tenant_access_code"("p_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_tenant_access_code"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_tenant_access_code"("p_value" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."proveedor_inactivo_desactiva_productos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."proveedor_inactivo_desactiva_productos"() TO "anon";
GRANT ALL ON FUNCTION "public"."proveedor_inactivo_desactiva_productos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."proveedor_inactivo_desactiva_productos"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."proveedor_set_sucursal_por_defecto"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."proveedor_set_sucursal_por_defecto"() TO "anon";
GRANT ALL ON FUNCTION "public"."proveedor_set_sucursal_por_defecto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."proveedor_set_sucursal_por_defecto"() TO "service_role";



GRANT ALL ON TABLE "public"."movimiento" TO "anon";
GRANT ALL ON TABLE "public"."movimiento" TO "authenticated";
GRANT ALL ON TABLE "public"."movimiento" TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_movimiento"("p_tenant_id" "uuid", "p_producto_id" "uuid", "p_sucursal_id" "uuid", "p_tipo" "public"."tipo_movimiento", "p_cantidad" numeric, "p_motivo" "text", "p_referencia_tipo" "public"."referencia_tipo", "p_referencia_id" "uuid", "p_usuario_id" "uuid", "p_permitir_stock_negativo" boolean, "p_proveedor_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_movimiento"("p_tenant_id" "uuid", "p_producto_id" "uuid", "p_sucursal_id" "uuid", "p_tipo" "public"."tipo_movimiento", "p_cantidad" numeric, "p_motivo" "text", "p_referencia_tipo" "public"."referencia_tipo", "p_referencia_id" "uuid", "p_usuario_id" "uuid", "p_permitir_stock_negativo" boolean, "p_proveedor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_movimiento"("p_tenant_id" "uuid", "p_producto_id" "uuid", "p_sucursal_id" "uuid", "p_tipo" "public"."tipo_movimiento", "p_cantidad" numeric, "p_motivo" "text", "p_referencia_tipo" "public"."referencia_tipo", "p_referencia_id" "uuid", "p_usuario_id" "uuid", "p_permitir_stock_negativo" boolean, "p_proveedor_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."pago" TO "anon";
GRANT ALL ON TABLE "public"."pago" TO "authenticated";
GRANT ALL ON TABLE "public"."pago" TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_pago"("p_tenant_id" "uuid", "p_cliente_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_comprobante_id" "uuid", "p_referencia" "text", "p_notas" "text", "p_usuario_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_pago"("p_tenant_id" "uuid", "p_cliente_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_comprobante_id" "uuid", "p_referencia" "text", "p_notas" "text", "p_usuario_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_pago"("p_tenant_id" "uuid", "p_cliente_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_comprobante_id" "uuid", "p_referencia" "text", "p_notas" "text", "p_usuario_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_pago_cobranza"("p_cobranza_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_notas" "text", "p_usuario_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_pago_cobranza"("p_cobranza_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_notas" "text", "p_usuario_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_pago_cobranza"("p_cobranza_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_notas" "text", "p_usuario_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_pago_cobranza"("p_cobranza_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_notas" "text", "p_usuario_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_pago_cuenta_proveedor"("p_tenant_id" "uuid", "p_proveedor_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_comprobante_id" "uuid", "p_referencia" "text", "p_notas" "text", "p_usuario_id" "uuid", "p_fecha" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_pago_cuenta_proveedor"("p_tenant_id" "uuid", "p_proveedor_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_comprobante_id" "uuid", "p_referencia" "text", "p_notas" "text", "p_usuario_id" "uuid", "p_fecha" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_pago_cuenta_proveedor"("p_tenant_id" "uuid", "p_proveedor_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_comprobante_id" "uuid", "p_referencia" "text", "p_notas" "text", "p_usuario_id" "uuid", "p_fecha" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_pago_cuenta_proveedor"("p_tenant_id" "uuid", "p_proveedor_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_comprobante_id" "uuid", "p_referencia" "text", "p_notas" "text", "p_usuario_id" "uuid", "p_fecha" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_pago_proveedor"("p_pago_proveedor_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_notas" "text", "p_usuario_id" "uuid", "p_fecha" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_pago_proveedor"("p_pago_proveedor_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_notas" "text", "p_usuario_id" "uuid", "p_fecha" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_pago_proveedor"("p_pago_proveedor_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_notas" "text", "p_usuario_id" "uuid", "p_fecha" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_pago_proveedor"("p_pago_proveedor_factura_id" "uuid", "p_monto" numeric, "p_tipo_pago" "public"."tipo_pago", "p_notas" "text", "p_usuario_id" "uuid", "p_fecha" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."siguiente_numero_arca"("p_tenant_id" "uuid", "p_tipo" "public"."tipo_comprobante", "p_punto_de_venta" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."siguiente_numero_arca"("p_tenant_id" "uuid", "p_tipo" "public"."tipo_comprobante", "p_punto_de_venta" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."siguiente_numero_arca"("p_tenant_id" "uuid", "p_tipo" "public"."tipo_comprobante", "p_punto_de_venta" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."siguiente_numero_arca"("p_tenant_id" "uuid", "p_tipo" "public"."tipo_comprobante", "p_punto_de_venta" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."siguiente_numero_comprobante"("p_tenant_id" "uuid", "p_sucursal_id" "uuid", "p_tipo" "public"."tipo_comprobante") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."siguiente_numero_comprobante"("p_tenant_id" "uuid", "p_sucursal_id" "uuid", "p_tipo" "public"."tipo_comprobante") TO "anon";
GRANT ALL ON FUNCTION "public"."siguiente_numero_comprobante"("p_tenant_id" "uuid", "p_sucursal_id" "uuid", "p_tipo" "public"."tipo_comprobante") TO "authenticated";
GRANT ALL ON FUNCTION "public"."siguiente_numero_comprobante"("p_tenant_id" "uuid", "p_sucursal_id" "uuid", "p_tipo" "public"."tipo_comprobante") TO "service_role";



GRANT ALL ON FUNCTION "public"."siguiente_numero_orden"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."siguiente_numero_orden"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."siguiente_numero_orden"("p_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."siguiente_numero_ticket_caja"("p_tenant_id" "uuid", "p_caja_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."siguiente_numero_ticket_caja"("p_tenant_id" "uuid", "p_caja_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."siguiente_numero_ticket_caja"("p_tenant_id" "uuid", "p_caja_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."siguiente_numero_ticket_caja"("p_tenant_id" "uuid", "p_caja_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."super_admin_set_tenant_contexto"("p_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."super_admin_set_tenant_contexto"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."super_admin_set_tenant_contexto"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."super_admin_set_tenant_contexto"("p_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."tenant_crea_sucursal_por_defecto"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tenant_crea_sucursal_por_defecto"() TO "anon";
GRANT ALL ON FUNCTION "public"."tenant_crea_sucursal_por_defecto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tenant_crea_sucursal_por_defecto"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tenant_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."transferir_stock_entre_depositos"("p_tenant_id" "uuid", "p_producto_id" "uuid", "p_sucursal_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_cantidad" numeric, "p_motivo" "text", "p_usuario_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transferir_stock_entre_depositos"("p_tenant_id" "uuid", "p_producto_id" "uuid", "p_sucursal_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_cantidad" numeric, "p_motivo" "text", "p_usuario_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."transferir_stock_entre_depositos"("p_tenant_id" "uuid", "p_producto_id" "uuid", "p_sucursal_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_cantidad" numeric, "p_motivo" "text", "p_usuario_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transferir_stock_entre_depositos"("p_tenant_id" "uuid", "p_producto_id" "uuid", "p_sucursal_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_cantidad" numeric, "p_motivo" "text", "p_usuario_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."transferir_stock_entre_sucursales"("p_tenant_id" "uuid", "p_producto_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_cantidad" numeric, "p_motivo" "text", "p_usuario_id" "uuid", "p_producto_destino_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."transferir_stock_entre_sucursales"("p_tenant_id" "uuid", "p_producto_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_cantidad" numeric, "p_motivo" "text", "p_usuario_id" "uuid", "p_producto_destino_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transferir_stock_entre_sucursales"("p_tenant_id" "uuid", "p_producto_origen_id" "uuid", "p_sucursal_destino_id" "uuid", "p_cantidad" numeric, "p_motivo" "text", "p_usuario_id" "uuid", "p_producto_destino_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_cliente_ensure_membresia_sucursal"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_cliente_ensure_membresia_sucursal"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_cliente_ensure_membresia_sucursal"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_cliente_ensure_membresia_sucursal"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_producto_after_insert_stock_sucursal"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_producto_after_insert_stock_sucursal"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_producto_after_insert_stock_sucursal"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_producto_after_insert_stock_sucursal"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_producto_after_update_sync_stock_sucursal"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_producto_after_update_sync_stock_sucursal"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_producto_after_update_sync_stock_sucursal"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_producto_after_update_sync_stock_sucursal"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_producto_lote_refresh_vencimiento"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_producto_lote_refresh_vencimiento"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_producto_lote_refresh_vencimiento"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_producto_lote_refresh_vencimiento"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_stock_sucursal_after_update_sync_producto"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_stock_sucursal_after_update_sync_producto"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_stock_sucursal_after_update_sync_producto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_stock_sucursal_after_update_sync_producto"() TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."usuario_guard_tenant_contexto"() TO "anon";
GRANT ALL ON FUNCTION "public"."usuario_guard_tenant_contexto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."usuario_guard_tenant_contexto"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."usuario_puede_operar_sucursal"("p_sucursal_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."usuario_puede_operar_sucursal"("p_sucursal_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."usuario_puede_operar_sucursal"("p_sucursal_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."usuario_puede_operar_sucursal"("p_sucursal_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";


















GRANT ALL ON TABLE "public"."arca_config" TO "anon";
GRANT ALL ON TABLE "public"."arca_config" TO "authenticated";
GRANT ALL ON TABLE "public"."arca_config" TO "service_role";



GRANT ALL ON TABLE "public"."arca_log" TO "anon";
GRANT ALL ON TABLE "public"."arca_log" TO "authenticated";
GRANT ALL ON TABLE "public"."arca_log" TO "service_role";



GRANT ALL ON TABLE "public"."caja" TO "anon";
GRANT ALL ON TABLE "public"."caja" TO "authenticated";
GRANT ALL ON TABLE "public"."caja" TO "service_role";



GRANT ALL ON TABLE "public"."caja_apertura" TO "anon";
GRANT ALL ON TABLE "public"."caja_apertura" TO "authenticated";
GRANT ALL ON TABLE "public"."caja_apertura" TO "service_role";



GRANT ALL ON TABLE "public"."caja_gasto" TO "anon";
GRANT ALL ON TABLE "public"."caja_gasto" TO "authenticated";
GRANT ALL ON TABLE "public"."caja_gasto" TO "service_role";



GRANT ALL ON TABLE "public"."caja_turno" TO "anon";
GRANT ALL ON TABLE "public"."caja_turno" TO "authenticated";
GRANT ALL ON TABLE "public"."caja_turno" TO "service_role";



GRANT ALL ON TABLE "public"."caja_usuario" TO "anon";
GRANT ALL ON TABLE "public"."caja_usuario" TO "authenticated";
GRANT ALL ON TABLE "public"."caja_usuario" TO "service_role";



GRANT ALL ON TABLE "public"."categoria" TO "anon";
GRANT ALL ON TABLE "public"."categoria" TO "authenticated";
GRANT ALL ON TABLE "public"."categoria" TO "service_role";



GRANT ALL ON TABLE "public"."cierre_mensual" TO "anon";
GRANT ALL ON TABLE "public"."cierre_mensual" TO "authenticated";
GRANT ALL ON TABLE "public"."cierre_mensual" TO "service_role";



GRANT ALL ON TABLE "public"."cierre_z" TO "anon";
GRANT ALL ON TABLE "public"."cierre_z" TO "authenticated";
GRANT ALL ON TABLE "public"."cierre_z" TO "service_role";



GRANT ALL ON TABLE "public"."cierre_z_medio_pago" TO "anon";
GRANT ALL ON TABLE "public"."cierre_z_medio_pago" TO "authenticated";
GRANT ALL ON TABLE "public"."cierre_z_medio_pago" TO "service_role";



GRANT ALL ON TABLE "public"."cliente" TO "anon";
GRANT ALL ON TABLE "public"."cliente" TO "authenticated";
GRANT ALL ON TABLE "public"."cliente" TO "service_role";



GRANT ALL ON TABLE "public"."cliente_sucursal" TO "anon";
GRANT ALL ON TABLE "public"."cliente_sucursal" TO "authenticated";
GRANT ALL ON TABLE "public"."cliente_sucursal" TO "service_role";



GRANT ALL ON TABLE "public"."cobranza_factura" TO "anon";
GRANT ALL ON TABLE "public"."cobranza_factura" TO "authenticated";
GRANT ALL ON TABLE "public"."cobranza_factura" TO "service_role";



GRANT ALL ON TABLE "public"."cobranza_pago" TO "anon";
GRANT ALL ON TABLE "public"."cobranza_pago" TO "authenticated";
GRANT ALL ON TABLE "public"."cobranza_pago" TO "service_role";



GRANT ALL ON TABLE "public"."comprobante" TO "anon";
GRANT ALL ON TABLE "public"."comprobante" TO "authenticated";
GRANT ALL ON TABLE "public"."comprobante" TO "service_role";



GRANT ALL ON TABLE "public"."comprobante_item" TO "anon";
GRANT ALL ON TABLE "public"."comprobante_item" TO "authenticated";
GRANT ALL ON TABLE "public"."comprobante_item" TO "service_role";



GRANT ALL ON TABLE "public"."cuenta_corriente" TO "anon";
GRANT ALL ON TABLE "public"."cuenta_corriente" TO "authenticated";
GRANT ALL ON TABLE "public"."cuenta_corriente" TO "service_role";



GRANT ALL ON TABLE "public"."importacion_archivo" TO "anon";
GRANT ALL ON TABLE "public"."importacion_archivo" TO "authenticated";
GRANT ALL ON TABLE "public"."importacion_archivo" TO "service_role";



GRANT ALL ON TABLE "public"."importacion_log" TO "anon";
GRANT ALL ON TABLE "public"."importacion_log" TO "authenticated";
GRANT ALL ON TABLE "public"."importacion_log" TO "service_role";



GRANT ALL ON TABLE "public"."lector_factura_log" TO "anon";
GRANT ALL ON TABLE "public"."lector_factura_log" TO "authenticated";
GRANT ALL ON TABLE "public"."lector_factura_log" TO "service_role";



GRANT ALL ON TABLE "public"."lista_precios" TO "anon";
GRANT ALL ON TABLE "public"."lista_precios" TO "authenticated";
GRANT ALL ON TABLE "public"."lista_precios" TO "service_role";



GRANT ALL ON TABLE "public"."lista_precios_item" TO "anon";
GRANT ALL ON TABLE "public"."lista_precios_item" TO "authenticated";
GRANT ALL ON TABLE "public"."lista_precios_item" TO "service_role";



GRANT ALL ON TABLE "public"."medio_pago" TO "anon";
GRANT ALL ON TABLE "public"."medio_pago" TO "authenticated";
GRANT ALL ON TABLE "public"."medio_pago" TO "service_role";



GRANT ALL ON TABLE "public"."medio_pago_opcion" TO "anon";
GRANT ALL ON TABLE "public"."medio_pago_opcion" TO "authenticated";
GRANT ALL ON TABLE "public"."medio_pago_opcion" TO "service_role";



GRANT ALL ON TABLE "public"."medio_pago_rapido" TO "anon";
GRANT ALL ON TABLE "public"."medio_pago_rapido" TO "authenticated";
GRANT ALL ON TABLE "public"."medio_pago_rapido" TO "service_role";



GRANT ALL ON TABLE "public"."modulo_config" TO "anon";
GRANT ALL ON TABLE "public"."modulo_config" TO "authenticated";
GRANT ALL ON TABLE "public"."modulo_config" TO "service_role";



GRANT ALL ON TABLE "public"."mp_point_config" TO "anon";
GRANT ALL ON TABLE "public"."mp_point_config" TO "authenticated";
GRANT ALL ON TABLE "public"."mp_point_config" TO "service_role";



GRANT ALL ON TABLE "public"."mp_qr_config" TO "anon";
GRANT ALL ON TABLE "public"."mp_qr_config" TO "authenticated";
GRANT ALL ON TABLE "public"."mp_qr_config" TO "service_role";



GRANT ALL ON TABLE "public"."mp_qr_webhook_log" TO "anon";
GRANT ALL ON TABLE "public"."mp_qr_webhook_log" TO "authenticated";
GRANT ALL ON TABLE "public"."mp_qr_webhook_log" TO "service_role";



GRANT ALL ON TABLE "public"."pago_proveedor_factura" TO "anon";
GRANT ALL ON TABLE "public"."pago_proveedor_factura" TO "authenticated";
GRANT ALL ON TABLE "public"."pago_proveedor_factura" TO "service_role";



GRANT ALL ON TABLE "public"."pago_proveedor_movimiento" TO "anon";
GRANT ALL ON TABLE "public"."pago_proveedor_movimiento" TO "authenticated";
GRANT ALL ON TABLE "public"."pago_proveedor_movimiento" TO "service_role";



GRANT ALL ON TABLE "public"."pedido" TO "anon";
GRANT ALL ON TABLE "public"."pedido" TO "authenticated";
GRANT ALL ON TABLE "public"."pedido" TO "service_role";



GRANT ALL ON TABLE "public"."pedido_estado_workflow" TO "anon";
GRANT ALL ON TABLE "public"."pedido_estado_workflow" TO "authenticated";
GRANT ALL ON TABLE "public"."pedido_estado_workflow" TO "service_role";



GRANT ALL ON TABLE "public"."pedido_estado_workflow_transicion" TO "anon";
GRANT ALL ON TABLE "public"."pedido_estado_workflow_transicion" TO "authenticated";
GRANT ALL ON TABLE "public"."pedido_estado_workflow_transicion" TO "service_role";



GRANT ALL ON TABLE "public"."pedido_item" TO "anon";
GRANT ALL ON TABLE "public"."pedido_item" TO "authenticated";
GRANT ALL ON TABLE "public"."pedido_item" TO "service_role";



GRANT ALL ON TABLE "public"."permiso" TO "anon";
GRANT ALL ON TABLE "public"."permiso" TO "authenticated";
GRANT ALL ON TABLE "public"."permiso" TO "service_role";



GRANT ALL ON TABLE "public"."precio_historial" TO "anon";
GRANT ALL ON TABLE "public"."precio_historial" TO "authenticated";
GRANT ALL ON TABLE "public"."precio_historial" TO "service_role";



GRANT ALL ON TABLE "public"."precio_sucursal" TO "anon";
GRANT ALL ON TABLE "public"."precio_sucursal" TO "authenticated";
GRANT ALL ON TABLE "public"."precio_sucursal" TO "service_role";



GRANT ALL ON TABLE "public"."producto" TO "anon";
GRANT ALL ON TABLE "public"."producto" TO "authenticated";
GRANT ALL ON TABLE "public"."producto" TO "service_role";



GRANT ALL ON TABLE "public"."producto_ganancia_tramo" TO "anon";
GRANT ALL ON TABLE "public"."producto_ganancia_tramo" TO "authenticated";
GRANT ALL ON TABLE "public"."producto_ganancia_tramo" TO "service_role";



GRANT ALL ON TABLE "public"."producto_lote_ingreso" TO "anon";
GRANT ALL ON TABLE "public"."producto_lote_ingreso" TO "authenticated";
GRANT ALL ON TABLE "public"."producto_lote_ingreso" TO "service_role";



GRANT ALL ON TABLE "public"."producto_promocion" TO "anon";
GRANT ALL ON TABLE "public"."producto_promocion" TO "authenticated";
GRANT ALL ON TABLE "public"."producto_promocion" TO "service_role";



GRANT ALL ON TABLE "public"."producto_proveedor" TO "anon";
GRANT ALL ON TABLE "public"."producto_proveedor" TO "authenticated";
GRANT ALL ON TABLE "public"."producto_proveedor" TO "service_role";



GRANT ALL ON TABLE "public"."promocion" TO "anon";
GRANT ALL ON TABLE "public"."promocion" TO "authenticated";
GRANT ALL ON TABLE "public"."promocion" TO "service_role";



GRANT ALL ON TABLE "public"."promocion_combo_item" TO "anon";
GRANT ALL ON TABLE "public"."promocion_combo_item" TO "authenticated";
GRANT ALL ON TABLE "public"."promocion_combo_item" TO "service_role";



GRANT ALL ON TABLE "public"."proveedor" TO "anon";
GRANT ALL ON TABLE "public"."proveedor" TO "authenticated";
GRANT ALL ON TABLE "public"."proveedor" TO "service_role";



GRANT ALL ON TABLE "public"."radar_inflacion" TO "anon";
GRANT ALL ON TABLE "public"."radar_inflacion" TO "authenticated";
GRANT ALL ON TABLE "public"."radar_inflacion" TO "service_role";



GRANT ALL ON TABLE "public"."rol" TO "anon";
GRANT ALL ON TABLE "public"."rol" TO "authenticated";
GRANT ALL ON TABLE "public"."rol" TO "service_role";



GRANT ALL ON TABLE "public"."rol_permiso" TO "anon";
GRANT ALL ON TABLE "public"."rol_permiso" TO "authenticated";
GRANT ALL ON TABLE "public"."rol_permiso" TO "service_role";



GRANT ALL ON TABLE "public"."stock_sucursal" TO "anon";
GRANT ALL ON TABLE "public"."stock_sucursal" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_sucursal" TO "service_role";



GRANT ALL ON TABLE "public"."sucursal" TO "anon";
GRANT ALL ON TABLE "public"."sucursal" TO "authenticated";
GRANT ALL ON TABLE "public"."sucursal" TO "service_role";



GRANT ALL ON TABLE "public"."super_admin_contexto_log" TO "anon";
GRANT ALL ON TABLE "public"."super_admin_contexto_log" TO "authenticated";
GRANT ALL ON TABLE "public"."super_admin_contexto_log" TO "service_role";



GRANT ALL ON TABLE "public"."super_admin_tenant_acceso" TO "anon";
GRANT ALL ON TABLE "public"."super_admin_tenant_acceso" TO "authenticated";
GRANT ALL ON TABLE "public"."super_admin_tenant_acceso" TO "service_role";
GRANT SELECT ON TABLE "public"."super_admin_tenant_acceso" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."tenant" TO "anon";
GRANT ALL ON TABLE "public"."tenant" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant" TO "service_role";



GRANT ALL ON TABLE "public"."usuario" TO "anon";
GRANT ALL ON TABLE "public"."usuario" TO "authenticated";
GRANT ALL ON TABLE "public"."usuario" TO "service_role";
GRANT SELECT ON TABLE "public"."usuario" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."usuario_credencial_local" TO "anon";
GRANT ALL ON TABLE "public"."usuario_credencial_local" TO "authenticated";
GRANT ALL ON TABLE "public"."usuario_credencial_local" TO "service_role";



GRANT ALL ON TABLE "public"."usuario_pedido_workflow_estado" TO "anon";
GRANT ALL ON TABLE "public"."usuario_pedido_workflow_estado" TO "authenticated";
GRANT ALL ON TABLE "public"."usuario_pedido_workflow_estado" TO "service_role";



GRANT ALL ON TABLE "public"."usuario_rol" TO "anon";
GRANT ALL ON TABLE "public"."usuario_rol" TO "authenticated";
GRANT ALL ON TABLE "public"."usuario_rol" TO "service_role";



GRANT ALL ON TABLE "public"."usuario_sucursal" TO "anon";
GRANT ALL ON TABLE "public"."usuario_sucursal" TO "authenticated";
GRANT ALL ON TABLE "public"."usuario_sucursal" TO "service_role";



GRANT ALL ON TABLE "public"."v_clientes_morosos" TO "anon";
GRANT ALL ON TABLE "public"."v_clientes_morosos" TO "authenticated";
GRANT ALL ON TABLE "public"."v_clientes_morosos" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_branch_rule" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_branch_rule" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_branch_rule" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_channel" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_channel" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_channel" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_inbound_attachment" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_inbound_attachment" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_inbound_attachment" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_inbound_message" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_inbound_message" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_inbound_message" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_job_event" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_job_event" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_job_event" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_outbound_message" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_outbound_message" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_outbound_message" TO "service_role";



GRANT ALL ON TABLE "public"."whatsapp_processing_job" TO "anon";
GRANT ALL ON TABLE "public"."whatsapp_processing_job" TO "authenticated";
GRANT ALL ON TABLE "public"."whatsapp_processing_job" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































