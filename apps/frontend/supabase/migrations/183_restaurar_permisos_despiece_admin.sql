-- Repara permisos de despiece para admins y alinea la RPC con el modelo legacy.

INSERT INTO public.permiso (clave, modulo, descripcion)
VALUES
  ('despiece.ver', 'despiece', 'Ver plantillas de despiece y calcular precios'),
  ('despiece.editar', 'despiece', 'Crear y editar plantillas de despiece'),
  ('despiece.aplicar_precios', 'despiece', 'Aplicar una estrategia de pricing al catalogo')
ON CONFLICT (clave) DO NOTHING;

-- Roles base existentes: lectura para superadmin/admin/cajero/visor.
INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave = 'despiece.ver'
WHERE lower(r.slug) IN ('superadmin', 'admin', 'cajero', 'visor')
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- Roles base existentes: edicion/aplicacion de precios para superadmin/admin.
INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave IN ('despiece.editar', 'despiece.aplicar_precios')
WHERE lower(r.slug) IN ('superadmin', 'admin')
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- Backfill por si falta usuario_rol para usuarios creados antes/despues del RBAC.
INSERT INTO public.usuario_rol (usuario_id, rol_id)
SELECT u.id, r.id
FROM public.usuario u
JOIN public.rol r
  ON r.tenant_id = u.tenant_id
 AND lower(r.slug) = lower(u.rol::TEXT)
WHERE u.activo = true
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.has_permiso (p_clave TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $has_permiso$
DECLARE
  v_uid UUID := auth.uid();
  v_allowed BOOLEAN := false;
  v_rol TEXT := NULL;
BEGIN
  IF v_uid IS NULL OR p_clave IS NULL OR btrim(p_clave) = '' THEN
    RETURN false;
  END IF;

  SELECT u.es_super_admin, u.rol::TEXT
  INTO v_allowed, v_rol
  FROM public.usuario u
  WHERE u.id = v_uid
    AND u.activo = true;

  IF COALESCE(v_allowed, false) OR v_rol = 'admin' THEN
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
$has_permiso$;

COMMENT ON FUNCTION public.has_permiso (TEXT) IS
  'Evalua permisos RBAC del usuario autenticado (admin legacy, rol y asignacion directa en usuario_permiso).';

GRANT EXECUTE ON FUNCTION public.has_permiso(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permiso(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
