import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-FAC-013: tracking de intentos ARCA en comprobante (bandeja + alertas).
 */
export class NbFac013ComprobanteArcaTracking1747800000000 implements MigrationInterface {
  name = 'NbFac013ComprobanteArcaTracking1747800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.comprobante ALTER COLUMN numero DROP NOT NULL;

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS numero_orden integer,
  ADD COLUMN IF NOT EXISTS intentos_arca integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_error_arca_codigo varchar(20),
  ADD COLUMN IF NOT EXISTS ultimo_error_arca_mensaje text,
  ADD COLUMN IF NOT EXISTS ultimo_intento_arca_at timestamptz;

COMMENT ON COLUMN public.comprobante.intentos_arca IS
  'Intentos de solicitud CAE (WSFE); fuente para bandeja ARCA y tope de reintentos.';
COMMENT ON COLUMN public.comprobante.ultimo_error_arca_codigo IS
  'C├│digo AFIP u observaci├│n del ├║ltimo rechazo o NETWORK.';
COMMENT ON COLUMN public.comprobante.numero_orden IS
  'Orden de venta interna por tenant (ticket/factura del mismo hecho).';

UPDATE public.comprobante
   SET numero_orden = numero
 WHERE numero_orden IS NULL AND numero IS NOT NULL;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.comprobante
  DROP COLUMN IF EXISTS ultimo_intento_arca_at,
  DROP COLUMN IF EXISTS ultimo_error_arca_mensaje,
  DROP COLUMN IF EXISTS ultimo_error_arca_codigo,
  DROP COLUMN IF EXISTS intentos_arca,
  DROP COLUMN IF EXISTS numero_orden;

ALTER TABLE public.comprobante ALTER COLUMN numero SET NOT NULL;
`);
  }
}
