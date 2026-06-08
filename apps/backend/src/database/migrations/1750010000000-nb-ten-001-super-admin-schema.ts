import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-TEN-001/002: super-admin contexto + whitelist de tenants.
 */
export class NbTen001SuperAdminSchema1750010000000 implements MigrationInterface {
  name = 'NbTen001SuperAdminSchema1750010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS tenant_contexto_id uuid REFERENCES public.tenant (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.usuario.tenant_contexto_id IS
  'Tenant efectivo si es super admin; NULL = usar tenant_id (casa).';

CREATE TABLE IF NOT EXISTS public.super_admin_tenant_acceso (
  usuario_id uuid NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_super_admin_tenant_acceso_tenant
  ON public.super_admin_tenant_acceso (tenant_id);

CREATE TABLE IF NOT EXISTS public.super_admin_contexto_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  tenant_id_prev uuid REFERENCES public.tenant (id) ON DELETE SET NULL,
  tenant_id_next uuid REFERENCES public.tenant (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_super_admin_contexto_log_usuario
  ON public.super_admin_contexto_log (usuario_id, created_at DESC);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.super_admin_contexto_log CASCADE;
DROP TABLE IF EXISTS public.super_admin_tenant_acceso CASCADE;
ALTER TABLE public.usuario DROP COLUMN IF EXISTS tenant_contexto_id;
`);
  }
}
