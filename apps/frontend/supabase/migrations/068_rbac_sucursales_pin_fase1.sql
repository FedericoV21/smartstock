-- V90-SEC-001: Fundaciones de seguridad (RBAC + sucursales + credenciales locales PIN).
-- Objetivo: preparar el esquema para permisos configurables por tenant, asignación por sucursal
-- y login local por usuario+PIN sin romper el modelo actual de usuario.rol.

-- ------------------------------------------------------------
-- 1) Sucursales (multi-sucursal dentro del mismo tenant)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sucursal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  direccion TEXT,
  activa BOOLEAN NOT NULL DEFAULT true,
  es_principal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_sucursal_codigo_not_blank CHECK (btrim(codigo) <> ''),
  CONSTRAINT chk_sucursal_nombre_not_blank CHECK (btrim(nombre) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sucursal_tenant_codigo_unique
  ON public.sucursal (tenant_id, lower(codigo));

CREATE UNIQUE INDEX IF NOT EXISTS idx_sucursal_tenant_nombre_unique
  ON public.sucursal (tenant_id, lower(nombre));

CREATE INDEX IF NOT EXISTS idx_sucursal_tenant_activa
  ON public.sucursal (tenant_id, activa);

DROP TRIGGER IF EXISTS set_sucursal_updated_at ON public.sucursal;
CREATE TRIGGER set_sucursal_updated_at
  BEFORE UPDATE ON public.sucursal
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.sucursal IS
  'Locales/sucursales de un tenant. Base para aislamiento operativo por sucursal.';
COMMENT ON COLUMN public.sucursal.es_principal IS
  'Marca la sucursal principal del tenant (seed inicial).';

-- Vincula usuario con sucursal por defecto (contexto operativo inicial).
ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS sucursal_default_id UUID REFERENCES public.sucursal (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usuario_sucursal_default
  ON public.usuario (sucursal_default_id);

CREATE TABLE IF NOT EXISTS public.usuario_sucursal (
  usuario_id UUID NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_sucursal_sucursal
  ON public.usuario_sucursal (sucursal_id);

COMMENT ON TABLE public.usuario_sucursal IS
  'Asignaciones de sucursales permitidas por usuario.';

-- ------------------------------------------------------------
-- 2) RBAC configurable por tenant
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permiso (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clave TEXT NOT NULL UNIQUE,
  modulo TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_permiso_clave_not_blank CHECK (btrim(clave) <> ''),
  CONSTRAINT chk_permiso_modulo_not_blank CHECK (btrim(modulo) <> '')
);

COMMENT ON TABLE public.permiso IS
  'Catálogo global de permisos (acciones).';

CREATE TABLE IF NOT EXISTS public.rol (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  es_base BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_rol_slug_not_blank CHECK (btrim(slug) <> ''),
  CONSTRAINT chk_rol_nombre_not_blank CHECK (btrim(nombre) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rol_tenant_slug_unique
  ON public.rol (tenant_id, lower(slug));

CREATE UNIQUE INDEX IF NOT EXISTS idx_rol_tenant_nombre_unique
  ON public.rol (tenant_id, lower(nombre));

CREATE INDEX IF NOT EXISTS idx_rol_tenant_activo
  ON public.rol (tenant_id, activo);

DROP TRIGGER IF EXISTS set_rol_updated_at ON public.rol;
CREATE TRIGGER set_rol_updated_at
  BEFORE UPDATE ON public.rol
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.rol IS
  'Roles por tenant. Incluye roles base y personalizados.';

CREATE TABLE IF NOT EXISTS public.rol_permiso (
  rol_id UUID NOT NULL REFERENCES public.rol (id) ON DELETE CASCADE,
  permiso_id UUID NOT NULL REFERENCES public.permiso (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rol_id, permiso_id)
);

CREATE INDEX IF NOT EXISTS idx_rol_permiso_permiso
  ON public.rol_permiso (permiso_id);

CREATE TABLE IF NOT EXISTS public.usuario_rol (
  usuario_id UUID NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  rol_id UUID NOT NULL REFERENCES public.rol (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, rol_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_rol_rol
  ON public.usuario_rol (rol_id);

COMMENT ON TABLE public.usuario_rol IS
  'Asignación de roles a usuarios (permite 1..N roles por usuario).';

-- ------------------------------------------------------------
-- 3) Credencial local (usuario + PIN)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.usuario_credencial_local (
  usuario_id UUID PRIMARY KEY REFERENCES public.usuario (id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  username_local TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_temporal BOOLEAN NOT NULL DEFAULT true,
  activo BOOLEAN NOT NULL DEFAULT true,
  intentos_fallidos SMALLINT NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  ultimo_login_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_username_local_not_blank CHECK (btrim(username_local) <> ''),
  CONSTRAINT chk_intentos_fallidos_nonnegative CHECK (intentos_fallidos >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credencial_local_tenant_username_unique
  ON public.usuario_credencial_local (tenant_id, lower(username_local));

CREATE INDEX IF NOT EXISTS idx_credencial_local_tenant_activo
  ON public.usuario_credencial_local (tenant_id, activo);

DROP TRIGGER IF EXISTS set_usuario_credencial_local_updated_at ON public.usuario_credencial_local;
CREATE TRIGGER set_usuario_credencial_local_updated_at
  BEFORE UPDATE ON public.usuario_credencial_local
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.usuario_credencial_local IS
  'Credenciales locales para login por usuario+PIN (hash), scope por tenant.';
COMMENT ON COLUMN public.usuario_credencial_local.pin_hash IS
  'Hash del PIN (argon2/bcrypt). Nunca almacenar PIN plano.';

-- ------------------------------------------------------------
-- 4) Seed de permisos base (idempotente)
-- ------------------------------------------------------------
INSERT INTO public.permiso (clave, modulo, descripcion)
VALUES
  ('dashboard.ver', 'dashboard', 'Ver dashboard general'),
  ('usuarios.gestionar', 'usuarios', 'Gestionar usuarios'),
  ('roles.gestionar', 'usuarios', 'Gestionar roles y permisos'),
  ('sucursales.gestionar', 'sucursales', 'Gestionar sucursales'),
  ('sucursales.ver_todas', 'sucursales', 'Operar/consultar todas las sucursales del tenant'),
  ('ventas.ver', 'ventas', 'Ver ventas'),
  ('ventas.crear', 'ventas', 'Crear ventas'),
  ('facturacion.emitir', 'facturacion', 'Emitir comprobantes'),
  ('facturacion.anular', 'facturacion', 'Anular comprobantes'),
  ('caja.operar', 'caja', 'Apertura/cierre y operación de caja'),
  ('stock.ver', 'stock', 'Ver stock'),
  ('stock.ajustar', 'stock', 'Registrar ajustes y movimientos'),
  ('pedidos.gestionar', 'pedidos', 'Crear y gestionar pedidos'),
  ('reportes.ver', 'reportes', 'Ver reportes'),
  ('reportes.consolidado', 'reportes', 'Ver consolidado multi-sucursal')
ON CONFLICT (clave) DO NOTHING;

-- ------------------------------------------------------------
-- 5) Helpers de autorización (RPC)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permiso(p_clave TEXT)
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

COMMENT ON FUNCTION public.has_permiso(TEXT) IS
  'Evalúa permisos RBAC del usuario autenticado dentro del tenant efectivo.';

CREATE OR REPLACE FUNCTION public.usuario_puede_operar_sucursal(p_sucursal_id UUID)
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
  IF v_uid IS NULL OR p_sucursal_id IS NULL THEN
    RETURN false;
  END IF;

  -- Super admin habilitado si la sucursal pertenece al tenant efectivo del contexto.
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

  -- Permiso global por rol dentro del tenant.
  IF public.has_permiso('sucursales.ver_todas') THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.sucursal s
      WHERE s.id = p_sucursal_id
        AND s.tenant_id = public.current_tenant_id()
    );
  END IF;

  -- Asignación explícita.
  SELECT EXISTS (
    SELECT 1
    FROM public.usuario_sucursal us
    JOIN public.sucursal s ON s.id = us.sucursal_id
    WHERE us.usuario_id = v_uid
      AND us.sucursal_id = p_sucursal_id
      AND s.tenant_id = public.current_tenant_id()
  )
  INTO v_allowed;

  RETURN COALESCE(v_allowed, false);
END;
$$;

COMMENT ON FUNCTION public.usuario_puede_operar_sucursal(UUID) IS
  'Valida acceso del usuario autenticado a una sucursal del tenant efectivo.';

-- ------------------------------------------------------------
-- 6) Bootstrap de roles base por tenant (idempotente)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bootstrap_security_for_tenant(p_tenant_id UUID)
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

  -- Sucursal principal.
  INSERT INTO public.sucursal (tenant_id, codigo, nombre, es_principal, activa)
  VALUES (p_tenant_id, 'CASA', 'Sucursal principal', true, true)
  ON CONFLICT DO NOTHING;

  SELECT s.id
  INTO v_sucursal_principal_id
  FROM public.sucursal s
  WHERE s.tenant_id = p_tenant_id
  ORDER BY s.es_principal DESC, s.created_at ASC
  LIMIT 1;

  -- Roles base.
  INSERT INTO public.rol (tenant_id, slug, nombre, descripcion, es_base, activo)
  VALUES
    (p_tenant_id, 'superadmin', 'Superadministrador', 'Acceso total del tenant', true, true),
    (p_tenant_id, 'admin', 'Administrador', 'Gestión completa del negocio', true, true),
    (p_tenant_id, 'cajero', 'Cajero', 'Operación de caja y emisión de comprobantes', true, true),
    (p_tenant_id, 'operador', 'Operador', 'Operación general sin configuración avanzada', true, true),
    (p_tenant_id, 'visor', 'Visor', 'Acceso de solo lectura', true, true)
  ON CONFLICT (tenant_id, lower(slug)) DO NOTHING;

  -- Mapeo permisos por rol base.
  WITH role_map AS (
    SELECT id, lower(slug) AS slug
    FROM public.rol
    WHERE tenant_id = p_tenant_id
      AND lower(slug) IN ('superadmin', 'admin', 'cajero', 'operador', 'visor')
  ),
  target(role_slug, permiso_clave) AS (
    VALUES
      -- superadmin
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
      -- admin
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
      -- cajero
      ('cajero', 'dashboard.ver'),
      ('cajero', 'ventas.ver'),
      ('cajero', 'ventas.crear'),
      ('cajero', 'facturacion.emitir'),
      ('cajero', 'caja.operar'),
      ('cajero', 'stock.ver'),
      -- operador
      ('operador', 'dashboard.ver'),
      ('operador', 'ventas.ver'),
      ('operador', 'ventas.crear'),
      ('operador', 'facturacion.emitir'),
      ('operador', 'stock.ver'),
      ('operador', 'stock.ajustar'),
      ('operador', 'pedidos.gestionar'),
      ('operador', 'reportes.ver'),
      -- visor
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

  -- Backfill: mapea usuario.rol legacy hacia usuario_rol.
  INSERT INTO public.usuario_rol (usuario_id, rol_id)
  SELECT u.id, r.id
  FROM public.usuario u
  JOIN public.rol r
    ON r.tenant_id = u.tenant_id
   AND lower(r.slug) = lower(u.rol::text)
  WHERE u.tenant_id = p_tenant_id
  ON CONFLICT DO NOTHING;

  -- Backfill: asigna sucursal principal y pertenencia.
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

COMMENT ON FUNCTION public.bootstrap_security_for_tenant(UUID) IS
  'Inicializa sucursal principal, roles base, permisos y backfill legacy para un tenant.';

-- Ejecuta bootstrap para tenants ya existentes.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM public.tenant LOOP
    PERFORM public.bootstrap_security_for_tenant(t.id);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 7) RLS
-- ------------------------------------------------------------
ALTER TABLE public.sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permiso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rol ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rol_permiso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_rol ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_credencial_local ENABLE ROW LEVEL SECURITY;

-- sucursal
DROP POLICY IF EXISTS sucursal_select_tenant ON public.sucursal;
CREATE POLICY sucursal_select_tenant
  ON public.sucursal FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS sucursal_insert_tenant ON public.sucursal;
CREATE POLICY sucursal_insert_tenant
  ON public.sucursal FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS sucursal_update_tenant ON public.sucursal;
CREATE POLICY sucursal_update_tenant
  ON public.sucursal FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS sucursal_delete_tenant ON public.sucursal;
CREATE POLICY sucursal_delete_tenant
  ON public.sucursal FOR DELETE
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- usuario_sucursal (vía sucursal)
DROP POLICY IF EXISTS usuario_sucursal_select_tenant ON public.usuario_sucursal;
CREATE POLICY usuario_sucursal_select_tenant
  ON public.usuario_sucursal FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sucursal s
      WHERE s.id = usuario_sucursal.sucursal_id
        AND s.tenant_id = public.current_tenant_id()
    )
  );

DROP POLICY IF EXISTS usuario_sucursal_insert_tenant ON public.usuario_sucursal;
CREATE POLICY usuario_sucursal_insert_tenant
  ON public.usuario_sucursal FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.sucursal s
      WHERE s.id = usuario_sucursal.sucursal_id
        AND s.tenant_id = public.current_tenant_id()
    )
  );

DROP POLICY IF EXISTS usuario_sucursal_delete_tenant ON public.usuario_sucursal;
CREATE POLICY usuario_sucursal_delete_tenant
  ON public.usuario_sucursal FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sucursal s
      WHERE s.id = usuario_sucursal.sucursal_id
        AND s.tenant_id = public.current_tenant_id()
    )
  );

-- permiso (catálogo global)
DROP POLICY IF EXISTS permiso_select_authenticated ON public.permiso;
CREATE POLICY permiso_select_authenticated
  ON public.permiso FOR SELECT
  TO authenticated
  USING (true);

-- rol
DROP POLICY IF EXISTS rol_select_tenant ON public.rol;
CREATE POLICY rol_select_tenant
  ON public.rol FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS rol_insert_tenant ON public.rol;
CREATE POLICY rol_insert_tenant
  ON public.rol FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS rol_update_tenant ON public.rol;
CREATE POLICY rol_update_tenant
  ON public.rol FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS rol_delete_tenant ON public.rol;
CREATE POLICY rol_delete_tenant
  ON public.rol FOR DELETE
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- rol_permiso (vía rol)
DROP POLICY IF EXISTS rol_permiso_select_tenant ON public.rol_permiso;
CREATE POLICY rol_permiso_select_tenant
  ON public.rol_permiso FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.rol r
      WHERE r.id = rol_permiso.rol_id
        AND r.tenant_id = public.current_tenant_id()
    )
  );

DROP POLICY IF EXISTS rol_permiso_insert_tenant ON public.rol_permiso;
CREATE POLICY rol_permiso_insert_tenant
  ON public.rol_permiso FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.rol r
      WHERE r.id = rol_permiso.rol_id
        AND r.tenant_id = public.current_tenant_id()
    )
  );

DROP POLICY IF EXISTS rol_permiso_delete_tenant ON public.rol_permiso;
CREATE POLICY rol_permiso_delete_tenant
  ON public.rol_permiso FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.rol r
      WHERE r.id = rol_permiso.rol_id
        AND r.tenant_id = public.current_tenant_id()
    )
  );

-- usuario_rol (vía rol + usuario tenant)
DROP POLICY IF EXISTS usuario_rol_select_tenant ON public.usuario_rol;
CREATE POLICY usuario_rol_select_tenant
  ON public.usuario_rol FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.rol r
      WHERE r.id = usuario_rol.rol_id
        AND r.tenant_id = public.current_tenant_id()
    )
    AND EXISTS (
      SELECT 1
      FROM public.usuario u
      WHERE u.id = usuario_rol.usuario_id
        AND u.tenant_id = public.current_tenant_id()
    )
  );

DROP POLICY IF EXISTS usuario_rol_insert_tenant ON public.usuario_rol;
CREATE POLICY usuario_rol_insert_tenant
  ON public.usuario_rol FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.rol r
      WHERE r.id = usuario_rol.rol_id
        AND r.tenant_id = public.current_tenant_id()
    )
    AND EXISTS (
      SELECT 1
      FROM public.usuario u
      WHERE u.id = usuario_rol.usuario_id
        AND u.tenant_id = public.current_tenant_id()
    )
  );

DROP POLICY IF EXISTS usuario_rol_delete_tenant ON public.usuario_rol;
CREATE POLICY usuario_rol_delete_tenant
  ON public.usuario_rol FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.rol r
      WHERE r.id = usuario_rol.rol_id
        AND r.tenant_id = public.current_tenant_id()
    )
    AND EXISTS (
      SELECT 1
      FROM public.usuario u
      WHERE u.id = usuario_rol.usuario_id
        AND u.tenant_id = public.current_tenant_id()
    )
  );

-- usuario_credencial_local
DROP POLICY IF EXISTS credencial_local_select_tenant ON public.usuario_credencial_local;
CREATE POLICY credencial_local_select_tenant
  ON public.usuario_credencial_local FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS credencial_local_insert_tenant ON public.usuario_credencial_local;
CREATE POLICY credencial_local_insert_tenant
  ON public.usuario_credencial_local FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS credencial_local_update_tenant ON public.usuario_credencial_local;
CREATE POLICY credencial_local_update_tenant
  ON public.usuario_credencial_local FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS credencial_local_delete_tenant ON public.usuario_credencial_local;
CREATE POLICY credencial_local_delete_tenant
  ON public.usuario_credencial_local FOR DELETE
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- ------------------------------------------------------------
-- 8) Grants
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.has_permiso(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permiso(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permiso(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.usuario_puede_operar_sucursal(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.usuario_puede_operar_sucursal(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.usuario_puede_operar_sucursal(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.bootstrap_security_for_tenant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_security_for_tenant(UUID) TO service_role;

