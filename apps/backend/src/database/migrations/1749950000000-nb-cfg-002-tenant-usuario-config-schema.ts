import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-CFG-002: campos tenant (horarios, c├│digo acceso) + soft delete usuario.
 */
export class NbCfg002TenantUsuarioConfigSchema1749950000000 implements MigrationInterface {
  name = 'NbCfg002TenantUsuarioConfigSchema1749950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS horarios_atencion text,
  ADD COLUMN IF NOT EXISTS codigo_acceso text;

ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.usuario (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usuario_tenant_not_deleted
  ON public.usuario (tenant_id)
  WHERE deleted_at IS NULL;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP INDEX IF EXISTS public.idx_usuario_tenant_not_deleted;

ALTER TABLE public.usuario
  DROP COLUMN IF EXISTS deleted_by,
  DROP COLUMN IF EXISTS deleted_at;

ALTER TABLE public.tenant
  DROP COLUMN IF EXISTS codigo_acceso,
  DROP COLUMN IF EXISTS horarios_atencion;
`);
  }
}
