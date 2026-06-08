-- Permisos granulares por usuario (contactos) y ampliación de RBAC.

-- ─── Catálogo ───
INSERT INTO public.permiso (clave, modulo, descripcion)
VALUES
  ('contactos.proveedores.ver', 'contactos', 'Ver proveedores y sus datos'),
  ('contactos.clientes.ver', 'contactos', 'Ver clientes y cuenta corriente')
ON CONFLICT (clave) DO NOTHING;

-- ─── Roles base: todos menos operador ───
INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave IN ('contactos.proveedores.ver', 'contactos.clientes.ver')
WHERE lower(r.slug) IN ('superadmin', 'admin', 'cajero', 'visor')
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- ─── Tabla asignación por usuario ───
CREATE TABLE IF NOT EXISTS public.usuario_permiso (
  usuario_id UUID NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  permiso_id UUID NOT NULL REFERENCES public.permiso (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, permiso_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_permiso_permiso
  ON public.usuario_permiso (permiso_id);

COMMENT ON TABLE public.usuario_permiso IS
  'Permisos adicionales otorgados directamente a un usuario (además de los del rol).';

ALTER TABLE public.usuario_permiso ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_permiso_select_tenant ON public.usuario_permiso;
CREATE POLICY usuario_permiso_select_tenant
  ON public.usuario_permiso FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.usuario u
      WHERE u.id = usuario_permiso.usuario_id
        AND u.tenant_id = public.current_tenant_id()
    )
  );

DROP POLICY IF EXISTS usuario_permiso_insert_tenant ON public.usuario_permiso;
CREATE POLICY usuario_permiso_insert_tenant
  ON public.usuario_permiso FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.usuario u
      WHERE u.id = usuario_permiso.usuario_id
        AND u.tenant_id = public.current_tenant_id()
    )
  );

DROP POLICY IF EXISTS usuario_permiso_delete_tenant ON public.usuario_permiso;
CREATE POLICY usuario_permiso_delete_tenant
  ON public.usuario_permiso FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.usuario u
      WHERE u.id = usuario_permiso.usuario_id
        AND u.tenant_id = public.current_tenant_id()
    )
  );

GRANT ALL ON TABLE public.usuario_permiso TO anon;
GRANT ALL ON TABLE public.usuario_permiso TO authenticated;
GRANT ALL ON TABLE public.usuario_permiso TO service_role;

-- ─── has_permiso: incluye usuario_permiso ───
CREATE OR REPLACE FUNCTION public.has_permiso (p_clave TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_allowed BOOLEAN := false;
BEGIN
  IF v_uid IS NULL OR p_clave IS NULL OR btrim(p_clave) = '' THEN
    RETURN false;
  END IF;

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

  IF COALESCE(v_allowed, false) THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.usuario_permiso up
    JOIN public.permiso perm
      ON perm.id = up.permiso_id
    JOIN public.usuario u
      ON u.id = up.usuario_id
   WHERE up.usuario_id = v_uid
     AND u.tenant_id = public.current_tenant_id()
     AND u.activo = true
     AND perm.clave = p_clave
  )
  INTO v_allowed;

  RETURN COALESCE(v_allowed, false);
END;
$$;

COMMENT ON FUNCTION public.has_permiso (TEXT) IS
  'Evalúa permisos RBAC del usuario autenticado (rol + asignación directa en usuario_permiso).';

-- ─── Bootstrap: nuevos permisos en roles base (excepto operador) ───
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
      ('superadmin', 'contactos.proveedores.ver'),
      ('superadmin', 'contactos.clientes.ver'),
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
      ('cajero', 'dashboard.ver'),
      ('cajero', 'ventas.ver'),
      ('cajero', 'ventas.crear'),
      ('cajero', 'facturacion.emitir'),
      ('cajero', 'caja.operar'),
      ('cajero', 'stock.ver'),
      ('cajero', 'contactos.proveedores.ver'),
      ('cajero', 'contactos.clientes.ver'),
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
      ('visor', 'reportes.ver'),
      ('visor', 'contactos.proveedores.ver'),
      ('visor', 'contactos.clientes.ver')
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
