import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-SCH-002: perfil app `usuario` + asignaci├│n `usuario_sucursal` (sin credenciales auth).
 */
export class NbSch002UsuarioSchema1747300000000 implements MigrationInterface {
  name = 'NbSch002UsuarioSchema1747300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.usuario (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  nombre text NOT NULL,
  apellido text NOT NULL DEFAULT '',
  email varchar(255) NOT NULL,
  rol public.rol_usuario NOT NULL DEFAULT 'operador',
  activo boolean NOT NULL DEFAULT true,
  es_super_admin boolean NOT NULL DEFAULT false,
  sucursal_default_id uuid REFERENCES public.sucursal (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_usuario_nombre_not_blank CHECK (btrim(nombre) <> ''),
  CONSTRAINT chk_usuario_email_not_blank CHECK (btrim(email) <> '')
);

CREATE INDEX IF NOT EXISTS idx_usuario_tenant_activo
  ON public.usuario (tenant_id, activo);

CREATE INDEX IF NOT EXISTS idx_usuario_sucursal_default
  ON public.usuario (sucursal_default_id);

CREATE TRIGGER usuario_set_updated_at
  BEFORE UPDATE ON public.usuario
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.usuario_sucursal (
  usuario_id uuid NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_sucursal_sucursal
  ON public.usuario_sucursal (sucursal_id);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.usuario_sucursal CASCADE;
DROP TABLE IF EXISTS public.usuario CASCADE;
`);
  }
}
