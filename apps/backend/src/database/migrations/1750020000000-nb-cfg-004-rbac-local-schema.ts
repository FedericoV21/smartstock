import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-CFG-004: RBAC configurable, credenciales locales PIN, permisos extra por usuario,
 * asignación workflow pedidos.
 */
export class NbCfg004RbacLocalSchema1750020000000 implements MigrationInterface {
  name = 'NbCfg004RbacLocalSchema1750020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.permiso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave text NOT NULL UNIQUE,
  modulo text NOT NULL,
  descripcion text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_permiso_clave_not_blank CHECK (btrim(clave) <> ''),
  CONSTRAINT chk_permiso_modulo_not_blank CHECK (btrim(modulo) <> '')
);

CREATE TABLE IF NOT EXISTS public.rol (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  slug text NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  es_base boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
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
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.rol_permiso (
  rol_id uuid NOT NULL REFERENCES public.rol (id) ON DELETE CASCADE,
  permiso_id uuid NOT NULL REFERENCES public.permiso (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rol_id, permiso_id)
);

CREATE INDEX IF NOT EXISTS idx_rol_permiso_permiso
  ON public.rol_permiso (permiso_id);

CREATE TABLE IF NOT EXISTS public.usuario_rol (
  usuario_id uuid NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  rol_id uuid NOT NULL REFERENCES public.rol (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, rol_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_rol_rol
  ON public.usuario_rol (rol_id);

CREATE TABLE IF NOT EXISTS public.usuario_permiso (
  usuario_id uuid NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  permiso_id uuid NOT NULL REFERENCES public.permiso (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, permiso_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_permiso_permiso
  ON public.usuario_permiso (permiso_id);

CREATE TABLE IF NOT EXISTS public.usuario_credencial_local (
  usuario_id uuid PRIMARY KEY REFERENCES public.usuario (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  username_local text NOT NULL,
  pin_hash text NOT NULL,
  pin_temporal boolean NOT NULL DEFAULT true,
  activo boolean NOT NULL DEFAULT true,
  intentos_fallidos smallint NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz,
  ultimo_login_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
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
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.usuario_pedido_workflow_estado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  workflow_estado_id uuid NOT NULL REFERENCES public.pedido_estado_workflow (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uk_usuario_pedido_wf_estado UNIQUE (tenant_id, usuario_id, workflow_estado_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_pedido_wf_estado_lookup
  ON public.usuario_pedido_workflow_estado (tenant_id, usuario_id);

ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS pedidos_puede_crear boolean NOT NULL DEFAULT false;

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
  ('reportes.consolidado', 'reportes', 'Ver consolidado multi-sucursal'),
  ('contactos.proveedores.ver', 'contactos', 'Ver proveedores'),
  ('contactos.clientes.ver', 'contactos', 'Ver clientes'),
  ('promociones.ver', 'promociones', 'Ver promociones'),
  ('promociones.editar', 'promociones', 'Editar promociones'),
  ('despiece.ver', 'despiece', 'Ver despiece'),
  ('despiece.editar', 'despiece', 'Editar despiece'),
  ('despiece.aplicar_precios', 'despiece', 'Aplicar precios desde despiece'),
  ('tesoreria.gestionar', 'tesoreria', 'Gestionar tesorería')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO public.rol (tenant_id, slug, nombre, descripcion, es_base, activo)
SELECT t.id, v.slug, v.nombre, v.descripcion, true, true
FROM public.tenant t
CROSS JOIN (
  VALUES
    ('admin', 'Administrador', 'Acceso total al negocio'),
    ('operador', 'Operador', 'Operación diaria'),
    ('visor', 'Visor', 'Solo lectura')
) AS v(slug, nombre, descripcion)
WHERE NOT EXISTS (
  SELECT 1 FROM public.rol r
  WHERE r.tenant_id = t.id AND lower(r.slug) = v.slug
);

INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
CROSS JOIN public.permiso p
WHERE r.es_base = true AND r.slug = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave IN (
  'dashboard.ver', 'ventas.ver', 'ventas.crear', 'facturacion.emitir',
  'caja.operar', 'stock.ver', 'pedidos.gestionar', 'reportes.ver'
)
WHERE r.es_base = true AND r.slug = 'operador'
ON CONFLICT DO NOTHING;

INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave IN (
  'dashboard.ver', 'ventas.ver', 'stock.ver', 'reportes.ver'
)
WHERE r.es_base = true AND r.slug = 'visor'
ON CONFLICT DO NOTHING;

INSERT INTO public.usuario_rol (usuario_id, rol_id)
SELECT u.id, r.id
FROM public.usuario u
JOIN public.rol r ON r.tenant_id = u.tenant_id AND r.slug = u.rol::text AND r.es_base = true
WHERE u.deleted_at IS NULL
ON CONFLICT DO NOTHING;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.usuario DROP COLUMN IF EXISTS pedidos_puede_crear;

DROP TABLE IF EXISTS public.usuario_pedido_workflow_estado CASCADE;
DROP TABLE IF EXISTS public.usuario_credencial_local CASCADE;
DROP TABLE IF EXISTS public.usuario_permiso CASCADE;
DROP TABLE IF EXISTS public.usuario_rol CASCADE;
DROP TABLE IF EXISTS public.rol_permiso CASCADE;
DROP TABLE IF EXISTS public.rol CASCADE;
DROP TABLE IF EXISTS public.permiso CASCADE;
`);
  }
}
