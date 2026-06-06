import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-ANL-002: producto_proveedor (comparar proveedores) + resumen_ia en lista_precios.
 */
export class NbAnl002AnalyzerExtensionsSchema1749940000000 implements MigrationInterface {
  name = 'NbAnl002AnalyzerExtensionsSchema1749940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.producto_proveedor (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  proveedor_id     UUID NOT NULL REFERENCES public.proveedor (id) ON DELETE CASCADE,
  precio_costo     NUMERIC(18, 6) NOT NULL DEFAULT 0,
  codigo_proveedor TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_producto_proveedor_tenant_producto_proveedor
    UNIQUE (tenant_id, producto_id, proveedor_id)
);

CREATE INDEX IF NOT EXISTS idx_producto_proveedor_tenant_producto
  ON public.producto_proveedor (tenant_id, producto_id);

CREATE INDEX IF NOT EXISTS idx_producto_proveedor_tenant_proveedor
  ON public.producto_proveedor (tenant_id, proveedor_id);

DROP TRIGGER IF EXISTS set_producto_proveedor_updated_at ON public.producto_proveedor;
CREATE TRIGGER set_producto_proveedor_updated_at
  BEFORE UPDATE ON public.producto_proveedor
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

ALTER TABLE public.lista_precios
  ADD COLUMN IF NOT EXISTS resumen_ia JSONB;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.lista_precios DROP COLUMN IF EXISTS resumen_ia;
DROP TABLE IF EXISTS public.producto_proveedor;
`);
  }
}
