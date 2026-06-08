-- Permisos de promociones (asignables por usuario) y stock de inventario opt-in para operador.

INSERT INTO public.permiso (clave, modulo, descripcion)
VALUES
  ('promociones.ver', 'promociones', 'Ver promociones del catálogo'),
  ('promociones.editar', 'promociones', 'Crear y editar promociones')
ON CONFLICT (clave) DO NOTHING;

-- Roles base (excepto operador): ver promociones.
INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave = 'promociones.ver'
WHERE lower(r.slug) IN ('superadmin', 'admin', 'cajero', 'visor')
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- Solo admin/superadmin: editar promociones.
INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave = 'promociones.editar'
WHERE lower(r.slug) IN ('superadmin', 'admin')
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- Operador: inventario y promos solo vía usuario_permiso (como contactos).
DELETE FROM public.rol_permiso rp
USING public.rol r, public.permiso p
WHERE rp.rol_id = r.id
  AND rp.permiso_id = p.id
  AND lower(r.slug) = 'operador'
  AND p.clave IN ('stock.ver', 'stock.ajustar');

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
    (p_tenant_id, 'visor', 'Visor', 'Solo lectura', TRUE, TRUE)
  ON CONFLICT (tenant_id, slug) DO NOTHING;

  WITH role_map AS (
    SELECT id, slug
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
      ('superadmin', 'contactos.proveedores.ver'),
      ('superadmin', 'contactos.clientes.ver'),
      ('superadmin', 'promociones.ver'),
      ('superadmin', 'promociones.editar'),
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
      ('admin', 'contactos.proveedores.ver'),
      ('admin', 'contactos.clientes.ver'),
      ('admin', 'promociones.ver'),
      ('admin', 'promociones.editar'),
      ('cajero', 'dashboard.ver'),
      ('cajero', 'ventas.ver'),
      ('cajero', 'ventas.crear'),
      ('cajero', 'facturacion.emitir'),
      ('cajero', 'caja.operar'),
      ('cajero', 'stock.ver'),
      ('cajero', 'contactos.proveedores.ver'),
      ('cajero', 'contactos.clientes.ver'),
      ('cajero', 'promociones.ver'),
      ('operador', 'dashboard.ver'),
      ('operador', 'ventas.ver'),
      ('operador', 'ventas.crear'),
      ('operador', 'facturacion.emitir'),
      ('operador', 'pedidos.gestionar'),
      ('operador', 'reportes.ver'),
      ('visor', 'dashboard.ver'),
      ('visor', 'ventas.ver'),
      ('visor', 'stock.ver'),
      ('visor', 'reportes.ver'),
      ('visor', 'contactos.proveedores.ver'),
      ('visor', 'contactos.clientes.ver'),
      ('visor', 'promociones.ver')
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
  'Inicializa sucursal principal (CASA), roles base, permisos y backfill legacy. Operador: stock/promos vía usuario_permiso.';

NOTIFY pgrst, 'reload schema';
