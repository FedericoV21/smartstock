import { MigrationInterface, QueryRunner } from 'typeorm';

/** NB-BAR-002: esquema `producto_barcode` (hist├│rico alineado con migraciones del repo legado). */
export class NbBar002ProductoBarcode1745100120000 implements MigrationInterface {
  name = 'NbBar002ProductoBarcode1745100120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TYPE public.producto_barcode_tipo AS ENUM (
  'EAN13',
  'UPCA',
  'ITF14',
  'OTRO'
);

CREATE TABLE public.producto_barcode (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id       UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,

  tipo              public.producto_barcode_tipo NOT NULL,
  valor             VARCHAR(32) NOT NULL,

  es_principal      BOOLEAN NOT NULL DEFAULT false,
  activo            BOOLEAN NOT NULL DEFAULT true,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_producto_barcode_valor_no_vacio
    CHECK (length(trim(both from valor)) > 0)
);

CREATE INDEX idx_producto_barcode_tenant_producto
  ON public.producto_barcode (tenant_id, producto_id);

CREATE INDEX idx_producto_barcode_tenant_valor_lookup
  ON public.producto_barcode (tenant_id, valor);

CREATE UNIQUE INDEX uq_producto_barcode_tenant_valor_activo
  ON public.producto_barcode (tenant_id, valor)
  WHERE activo = true;

CREATE UNIQUE INDEX uq_producto_barcode_producto_principal_activo
  ON public.producto_barcode (producto_id)
  WHERE es_principal = true AND activo = true;

CREATE TRIGGER set_producto_barcode_updated_at
  BEFORE UPDATE ON public.producto_barcode
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);
`);

    await queryRunner.query(`
INSERT INTO public.producto_barcode (
  tenant_id,
  producto_id,
  tipo,
  valor,
  es_principal,
  activo,
  created_at,
  updated_at
)
SELECT
  p.tenant_id,
  p.id,
  CASE
    WHEN length(trim(both from p.codigo_barras)) = 14 THEN 'ITF14'::public.producto_barcode_tipo
    WHEN length(trim(both from p.codigo_barras)) = 13 THEN 'EAN13'::public.producto_barcode_tipo
    WHEN length(trim(both from p.codigo_barras)) = 12 THEN 'UPCA'::public.producto_barcode_tipo
    ELSE 'OTRO'::public.producto_barcode_tipo
  END,
  trim(both from p.codigo_barras),
  true,
  p.activo,
  now(),
  now()
FROM public.producto p
WHERE p.codigo_barras IS NOT NULL
  AND length(trim(both from p.codigo_barras)) > 0;
`);

    await queryRunner.query(`
ALTER TABLE public.producto_barcode ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_producto_barcode
  ON public.producto_barcode FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_producto_barcode
  ON public.producto_barcode FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_producto_barcode
  ON public.producto_barcode FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_producto_barcode
  ON public.producto_barcode FOR DELETE
  USING (tenant_id = public.current_tenant_id());
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.producto_barcode CASCADE;
DROP TYPE IF EXISTS public.producto_barcode_tipo CASCADE;
`);
  }
}
