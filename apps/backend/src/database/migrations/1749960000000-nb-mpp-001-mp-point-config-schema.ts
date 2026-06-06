import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-MPP-001: configuraci├│n Mercado Pago Point por sucursal (paridad `mp_point_config`).
 */
export class NbMpp001MpPointConfigSchema1749960000000 implements MigrationInterface {
  name = 'NbMpp001MpPointConfigSchema1749960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.mp_point_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE CASCADE,
  access_token text,
  device_id text,
  webhook_secret text,
  habilitado boolean NOT NULL DEFAULT true,
  last_payment_intent_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uk_mp_point_config_tenant_sucursal UNIQUE (tenant_id, sucursal_id),
  CONSTRAINT uk_mp_point_config_sucursal UNIQUE (sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_point_config_tenant
  ON public.mp_point_config (tenant_id);

COMMENT ON TABLE public.mp_point_config IS
  'Credenciales Mercado Pago Point por sucursal. access_token cifrado en aplicaci├│n (AES-256-CBC).';

CREATE TRIGGER mp_point_config_set_updated_at
  BEFORE UPDATE ON public.mp_point_config
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TRIGGER IF EXISTS mp_point_config_set_updated_at ON public.mp_point_config;
DROP TABLE IF EXISTS public.mp_point_config CASCADE;
`);
  }
}
