import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-LST-003: columnas simular/comparar temporal + clonar sucursal.
 */
export class NbLst003ListaSimularCompararSchema1749920000000 implements MigrationInterface {
  name = 'NbLst003ListaSimularCompararSchema1749920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.lista_precios
  ADD COLUMN IF NOT EXISTS items_con_aumento integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margen_global_anterior_pct numeric(12, 4),
  ADD COLUMN IF NOT EXISTS margen_global_nuevo_pct numeric(12, 4);

ALTER TABLE public.lista_precios_item
  ADD COLUMN IF NOT EXISTS nombre_normalizado text,
  ADD COLUMN IF NOT EXISTS precio_venta_decidido numeric(18, 6);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.lista_precios_item
  DROP COLUMN IF EXISTS precio_venta_decidido,
  DROP COLUMN IF EXISTS nombre_normalizado;

ALTER TABLE public.lista_precios
  DROP COLUMN IF EXISTS margen_global_nuevo_pct,
  DROP COLUMN IF EXISTS margen_global_anterior_pct,
  DROP COLUMN IF EXISTS items_con_aumento;
`);
  }
}
