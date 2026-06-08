-- Un solo depósito canónico al crear tenant (CASA · Sucursal Principal): el trigger
-- tras INSERT tenant y bootstrap_security_for_tenant ya no crean dos filas distintas.

-- ─── Trigger al insertar tenant ───
CREATE OR REPLACE FUNCTION public.tenant_crea_sucursal_por_defecto ()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sucursal s WHERE s.tenant_id = NEW.id) THEN
    INSERT INTO public.sucursal (tenant_id, codigo, nombre, es_principal, activa)
    VALUES (NEW.id, 'CASA', 'Sucursal Principal', TRUE, TRUE);
  END IF;
  RETURN NEW;
END;
$f$;

COMMENT ON FUNCTION public.tenant_crea_sucursal_por_defecto () IS
  'Crea la sucursal CASA · Sucursal Principal al insertar un tenant (alineado con RBAC bootstrap).';

-- ─── Bootstrap RBAC ───
CREATE OR REPLACE FUNCTION public.bootstrap_security_for_tenant (p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

COMMENT ON FUNCTION public.bootstrap_security_for_tenant (UUID) IS
  'Inicializa sucursal principal (CASA · Sucursal Principal si falta), roles base, permisos y backfill legacy.';

REVOKE ALL ON FUNCTION public.bootstrap_security_for_tenant (UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_security_for_tenant (UUID) TO service_role;

-- Nombre canónico en filas Casa previas ("Sucursal principal").
UPDATE public.sucursal s
SET nombre = 'Sucursal Principal'
WHERE trim(lower(s.codigo)) = 'casa'
  AND lower(trim(s.nombre)) IN ('sucursal principal', 'principal');

-- ─── Histórico: código 1 "Principal" + CASA ───
DO $$
DECLARE
  r RECORD;
  v_dup UUID;
  v_keep UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (dup.id)
      dup.id AS dup_id,
      k.id AS keep_id
    FROM public.sucursal dup
    INNER JOIN public.sucursal k
      ON k.tenant_id = dup.tenant_id
     AND dup.id <> k.id
    WHERE trim(lower(dup.codigo)) = '1'
      AND lower(trim(dup.nombre)) = 'principal'
      AND trim(lower(k.codigo)) = 'casa'
    ORDER BY dup.id, k.es_principal DESC NULLS LAST, k.created_at ASC
  LOOP
    v_dup := r.dup_id;
    v_keep := r.keep_id;

    UPDATE public.usuario u
    SET sucursal_default_id = v_keep
    WHERE u.sucursal_default_id = v_dup;

    DELETE FROM public.usuario_sucursal us
    WHERE us.sucursal_id = v_dup
      AND EXISTS (
          SELECT 1
          FROM public.usuario_sucursal u2
          WHERE u2.usuario_id = us.usuario_id
            AND u2.sucursal_id = v_keep
        );

    UPDATE public.usuario_sucursal us
    SET sucursal_id = v_keep
    WHERE us.sucursal_id = v_dup;

    UPDATE public.stock_sucursal s_keep
    SET stock_actual = s_keep.stock_actual + d.stock_actual,
        stock_minimo = GREATEST(s_keep.stock_minimo, d.stock_minimo),
        ubicacion = COALESCE(NULLIF(trim(s_keep.ubicacion), ''), d.ubicacion)
    FROM public.stock_sucursal d
    WHERE d.sucursal_id = v_dup
      AND d.tenant_id = s_keep.tenant_id
      AND s_keep.sucursal_id = v_keep
      AND d.producto_id = s_keep.producto_id;

    DELETE FROM public.stock_sucursal d
    WHERE d.sucursal_id = v_dup
      AND EXISTS (
          SELECT 1
          FROM public.stock_sucursal k
          WHERE k.sucursal_id = v_keep
            AND k.tenant_id = d.tenant_id
            AND k.producto_id = d.producto_id
        );

    UPDATE public.stock_sucursal ss
    SET sucursal_id = v_keep
    WHERE ss.sucursal_id = v_dup;

    UPDATE public.precio_sucursal p_keep
    SET precio_costo = COALESCE(p_keep.precio_costo, d.precio_costo),
        precio_venta = COALESCE(p_keep.precio_venta, d.precio_venta),
        updated_at = GREATEST(p_keep.updated_at, d.updated_at)
    FROM public.precio_sucursal d
    WHERE d.sucursal_id = v_dup
      AND p_keep.tenant_id = d.tenant_id
      AND p_keep.sucursal_id = v_keep
      AND d.producto_id = p_keep.producto_id;

    DELETE FROM public.precio_sucursal d
    WHERE d.sucursal_id = v_dup
      AND EXISTS (
          SELECT 1
          FROM public.precio_sucursal k
          WHERE k.sucursal_id = v_keep
            AND k.tenant_id = d.tenant_id
            AND k.producto_id = d.producto_id
        );

    UPDATE public.precio_sucursal ps
    SET sucursal_id = v_keep
    WHERE ps.sucursal_id = v_dup;

    DELETE FROM public.cliente_sucursal cs
    WHERE cs.sucursal_id = v_dup
      AND EXISTS (
          SELECT 1
          FROM public.cliente_sucursal c2
          WHERE c2.cliente_id = cs.cliente_id
            AND c2.sucursal_id = v_keep
            AND c2.tenant_id = cs.tenant_id
        );

    UPDATE public.cliente_sucursal cs
    SET sucursal_id = v_keep
    WHERE cs.sucursal_id = v_dup;

    UPDATE public.cliente cli
    SET sucursal_id = v_keep
    WHERE cli.sucursal_id = v_dup;

    UPDATE public.arca_config a
    SET sucursal_id = v_keep
    WHERE a.sucursal_id = v_dup
      AND NOT EXISTS (SELECT 1 FROM public.arca_config a2 WHERE a2.sucursal_id = v_keep);

    DELETE FROM public.arca_config WHERE sucursal_id = v_dup;

    UPDATE public.mp_point_config z
    SET sucursal_id = v_keep
    WHERE z.sucursal_id = v_dup
      AND NOT EXISTS (SELECT 1 FROM public.mp_point_config z2 WHERE z2.sucursal_id = v_keep);

    DELETE FROM public.mp_point_config WHERE sucursal_id = v_dup;

    UPDATE public.mp_qr_config z
    SET sucursal_id = v_keep
    WHERE z.sucursal_id = v_dup
      AND NOT EXISTS (SELECT 1 FROM public.mp_qr_config z2 WHERE z2.sucursal_id = v_keep);

    DELETE FROM public.mp_qr_config WHERE sucursal_id = v_dup;

    UPDATE public.comprobante c
    SET sucursal_id = v_keep
    WHERE c.sucursal_id = v_dup
      AND NOT EXISTS (
          SELECT 1
          FROM public.comprobante c2
          WHERE c2.tenant_id = c.tenant_id
            AND c2.sucursal_id = v_keep
            AND c2.tipo = c.tipo
            AND c2.numero IS NOT DISTINCT FROM c.numero
            AND COALESCE(c2.numero, 0) > 0
        );

    UPDATE public.pedido p
    SET sucursal_id = v_keep
    WHERE p.sucursal_id = v_dup;

    UPDATE public.caja_apertura ca
    SET sucursal_id = v_keep
    WHERE ca.sucursal_id = v_dup;

    UPDATE public.caja caj
    SET sucursal_id = v_keep
    WHERE caj.sucursal_id = v_dup
      AND NOT EXISTS (
          SELECT 1
          FROM public.caja x
          WHERE x.tenant_id = caj.tenant_id
            AND x.sucursal_id = v_keep
            AND x.numero = caj.numero
        );

    DELETE FROM public.caja WHERE sucursal_id = v_dup;

    UPDATE public.lista_precios lp
    SET sucursal_id = v_keep
    WHERE lp.sucursal_id = v_dup;

    UPDATE public.movimiento m
    SET sucursal_id = v_keep
    WHERE m.sucursal_id = v_dup;

    UPDATE public.importacion_log il
    SET sucursal_id = v_keep
    WHERE il.sucursal_id = v_dup;

    UPDATE public.producto pr
    SET sucursal_id = v_keep
    WHERE pr.sucursal_id = v_dup;

    UPDATE public.proveedor prov
    SET sucursal_id = v_keep
    WHERE prov.sucursal_id = v_dup;

    IF EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public'
        AND t.table_name = 'whatsapp_processing_job'
    ) THEN
      UPDATE public.whatsapp_processing_job j
      SET branch_id = v_keep
      WHERE j.branch_id = v_dup;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.tables t
      WHERE t.table_schema = 'public'
        AND t.table_name = 'whatsapp_branch_rule'
    ) THEN
      UPDATE public.whatsapp_branch_rule wbr
      SET sucursal_id = v_keep
      WHERE wbr.sucursal_id = v_dup;
    END IF;

    DELETE FROM public.categoria c
    WHERE c.sucursal_id = v_dup
      AND EXISTS (
          SELECT 1
          FROM public.categoria o
          WHERE o.tenant_id = c.tenant_id
            AND o.sucursal_id = v_keep
            AND lower(trim(o.nombre)) = lower(trim(c.nombre))
        );

    UPDATE public.categoria ct
    SET sucursal_id = v_keep
    WHERE ct.sucursal_id = v_dup;

    DELETE FROM public.promocion p
    WHERE p.sucursal_id = v_dup
      AND EXISTS (
          SELECT 1
          FROM public.promocion q
          WHERE q.tenant_id = p.tenant_id
            AND q.sucursal_id = v_keep
            AND lower(trim(q.nombre)) = lower(trim(p.nombre))
        );

    UPDATE public.promocion pp
    SET sucursal_id = v_keep
    WHERE pp.sucursal_id = v_dup;

    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'cierre_z'
    ) THEN
      EXECUTE 'UPDATE public.cierre_z cz SET sucursal_id = $2 WHERE cz.sucursal_id = $1'
      USING v_dup, v_keep;
    END IF;

    BEGIN
      DELETE FROM public.sucursal WHERE id = v_dup;
    EXCEPTION
      WHEN foreign_key_violation THEN
        RAISE WARNING '114: no se eliminó sucursal duplicada id=% (persisten referencias).', v_dup;
    END;

    RAISE NOTICE '114: merge Principal→Sucursal Principal CASA dup=% keep=%', v_dup, v_keep;
  END LOOP;
END $$;
