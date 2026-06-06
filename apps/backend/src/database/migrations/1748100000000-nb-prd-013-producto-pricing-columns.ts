import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-PRD-013: columnas de pricing en producto + defaults tenant para bulk ganancia.
 */
export class NbPrd013ProductoPricingColumns1748100000000 implements MigrationInterface {
  name = 'NbPrd013ProductoPricingColumns1748100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS iva_porcentaje_default numeric(5, 2) NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS pos_prefs jsonb;

ALTER TABLE public.producto
  ADD COLUMN IF NOT EXISTS iva_porcentaje numeric(5, 2),
  ADD COLUMN IF NOT EXISTS porcentaje_ganancia numeric(5, 2),
  ADD COLUMN IF NOT EXISTS descuento_costo_pct numeric(5, 2);

ALTER TABLE public.producto
  DROP CONSTRAINT IF EXISTS chk_producto_porcentaje_ganancia_rango;

ALTER TABLE public.producto
  ADD CONSTRAINT chk_producto_porcentaje_ganancia_rango
  CHECK (porcentaje_ganancia IS NULL OR (porcentaje_ganancia >= 0 AND porcentaje_ganancia <= 999.99));

ALTER TABLE public.producto
  DROP CONSTRAINT IF EXISTS chk_producto_descuento_costo_pct_rango;

ALTER TABLE public.producto
  ADD CONSTRAINT chk_producto_descuento_costo_pct_rango
  CHECK (
    descuento_costo_pct IS NULL
    OR (descuento_costo_pct >= 0 AND descuento_costo_pct <= 100)
  );
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.producto
  DROP CONSTRAINT IF EXISTS chk_producto_descuento_costo_pct_rango,
  DROP CONSTRAINT IF EXISTS chk_producto_porcentaje_ganancia_rango;

ALTER TABLE public.producto
  DROP COLUMN IF EXISTS descuento_costo_pct,
  DROP COLUMN IF EXISTS porcentaje_ganancia,
  DROP COLUMN IF EXISTS iva_porcentaje;

ALTER TABLE public.tenant
  DROP COLUMN IF EXISTS pos_prefs,
  DROP COLUMN IF EXISTS iva_porcentaje_default;
`);
  }
}
