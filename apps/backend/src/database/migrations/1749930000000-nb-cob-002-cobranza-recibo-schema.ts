import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-COB-002: tipo comprobante `recibo` + v├¡nculo cobranza_pago ÔåÆ comprobante recibo.
 */
export class NbCob002CobranzaReciboSchema1749930000000 implements MigrationInterface {
  name = 'NbCob002CobranzaReciboSchema1749930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TYPE public.tipo_comprobante ADD VALUE IF NOT EXISTS 'recibo';

ALTER TABLE public.cobranza_pago
  ADD COLUMN IF NOT EXISTS recibo_comprobante_id UUID
    REFERENCES public.comprobante (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cobranza_pago_recibo
  ON public.cobranza_pago (recibo_comprobante_id)
  WHERE recibo_comprobante_id IS NOT NULL;

COMMENT ON COLUMN public.cobranza_pago.recibo_comprobante_id IS
  'Comprobante tipo recibo emitido por este cobro (PDF interno, sin ARCA).';
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP INDEX IF EXISTS idx_cobranza_pago_recibo;
ALTER TABLE public.cobranza_pago DROP COLUMN IF EXISTS recibo_comprobante_id;
`);
  }
}
