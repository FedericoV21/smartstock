import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-MPP-003: correlaci├│n MP Point en comprobante + estado pendiente_posnet.
 */
export class NbMpp003ComprobanteMpPointSchema1749970000000 implements MigrationInterface {
  name = 'NbMpp003ComprobanteMpPointSchema1749970000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TYPE public.estado_comprobante ADD VALUE IF NOT EXISTS 'pendiente_posnet';

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS mp_point_intent_id text,
  ADD COLUMN IF NOT EXISTS mp_point_payment_id bigint;

CREATE INDEX IF NOT EXISTS idx_comprobante_mp_intent
  ON public.comprobante (tenant_id, mp_point_intent_id)
  WHERE mp_point_intent_id IS NOT NULL;

COMMENT ON COLUMN public.comprobante.mp_point_intent_id IS
  'ID del payment intent en API Mercado Pago Point (correlaci├│n webhook / cancelar).';

COMMENT ON COLUMN public.comprobante.mp_point_payment_id IS
  'ID del pago aprobado en Mercado Pago cuando el cobro en terminal finaliza OK.';
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP INDEX IF EXISTS public.idx_comprobante_mp_intent;

ALTER TABLE public.comprobante
  DROP COLUMN IF EXISTS mp_point_payment_id,
  DROP COLUMN IF EXISTS mp_point_intent_id;
`);
  }
}
