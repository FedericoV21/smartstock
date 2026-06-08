import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-MPQ-001: MP QR config por sucursal, correlación en comprobante, log webhook.
 */
export class NbMpq001MpQrSchema1749980000000 implements MigrationInterface {
  name = 'NbMpq001MpQrSchema1749980000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TYPE public.estado_comprobante ADD VALUE IF NOT EXISTS 'pendiente_qr';

CREATE TABLE IF NOT EXISTS public.mp_qr_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE CASCADE,
  access_token text,
  user_id text,
  external_pos_id text,
  webhook_secret text,
  habilitado boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uk_mp_qr_config_tenant_sucursal UNIQUE (tenant_id, sucursal_id),
  CONSTRAINT uk_mp_qr_config_sucursal UNIQUE (sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_qr_config_tenant
  ON public.mp_qr_config (tenant_id);

COMMENT ON TABLE public.mp_qr_config IS
  'Credenciales MP QR instore por sucursal. access_token cifrado en aplicación.';

CREATE TRIGGER mp_qr_config_set_updated_at
  BEFORE UPDATE ON public.mp_qr_config
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS mp_qr_order_id text,
  ADD COLUMN IF NOT EXISTS mp_qr_payment_id bigint,
  ADD COLUMN IF NOT EXISTS mp_qr_pago_huerfano boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mp_qr_cancelado_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_comprobante_mp_qr_order
  ON public.comprobante (tenant_id, mp_qr_order_id)
  WHERE mp_qr_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.mp_qr_webhook_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenant (id) ON DELETE SET NULL,
  comprobante_id uuid REFERENCES public.comprobante (id) ON DELETE SET NULL,
  topic text,
  merchant_order_id text,
  resultado text,
  payload_snippet text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mp_qr_webhook_log_created
  ON public.mp_qr_webhook_log (created_at DESC);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP INDEX IF EXISTS public.idx_mp_qr_webhook_log_created;
DROP TABLE IF EXISTS public.mp_qr_webhook_log CASCADE;

DROP INDEX IF EXISTS public.idx_comprobante_mp_qr_order;

ALTER TABLE public.comprobante
  DROP COLUMN IF EXISTS mp_qr_cancelado_at,
  DROP COLUMN IF EXISTS mp_qr_pago_huerfano,
  DROP COLUMN IF EXISTS mp_qr_payment_id,
  DROP COLUMN IF EXISTS mp_qr_order_id;

DROP TRIGGER IF EXISTS mp_qr_config_set_updated_at ON public.mp_qr_config;
DROP TABLE IF EXISTS public.mp_qr_config CASCADE;
`);
  }
}
