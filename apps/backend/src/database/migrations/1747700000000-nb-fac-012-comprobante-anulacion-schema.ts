import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-FAC-012: anulaci├│n interna (motivo/auditor├¡a), compras importadas y reversi├│n.
 */
export class NbFac012ComprobanteAnulacionSchema1747700000000 implements MigrationInterface {
  name = 'NbFac012ComprobanteAnulacionSchema1747700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TYPE public.estado_comprobante ADD VALUE IF NOT EXISTS 'importado';

ALTER TYPE public.referencia_tipo ADD VALUE IF NOT EXISTS 'factura_recibida';
ALTER TYPE public.referencia_tipo ADD VALUE IF NOT EXISTS 'factura_importada';

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS sucursal_id uuid REFERENCES public.sucursal (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tipo_operacion text NOT NULL DEFAULT 'venta',
  ADD COLUMN IF NOT EXISTS proveedor_id uuid REFERENCES public.proveedor (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_anulacion text,
  ADD COLUMN IF NOT EXISTS anulado_at timestamptz,
  ADD COLUMN IF NOT EXISTS anulado_por uuid REFERENCES public.usuario (id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_comprobante_tipo_operacion'
  ) THEN
    ALTER TABLE public.comprobante
      ADD CONSTRAINT chk_comprobante_tipo_operacion
      CHECK (tipo_operacion IN ('venta', 'compra'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comprobante_sucursal
  ON public.comprobante (tenant_id, sucursal_id)
  WHERE sucursal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comprobante_proveedor
  ON public.comprobante (tenant_id, proveedor_id)
  WHERE proveedor_id IS NOT NULL;

COMMENT ON COLUMN public.comprobante.motivo_anulacion IS
  'Motivo obligatorio al anular con reverso interno (sin CAE AFIP v├ílido).';
COMMENT ON COLUMN public.comprobante.tipo_operacion IS
  'venta: emisi├│n habitual; compra: factura recibida / importada.';

CREATE TABLE IF NOT EXISTS public.factura_importada_aplicacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  comprobante_id uuid NOT NULL REFERENCES public.comprobante (id) ON DELETE CASCADE,
  origen text NOT NULL CHECK (origen IN ('lector', 'manual')),
  afecta_stock boolean NOT NULL DEFAULT true,
  afecta_cuenta_corriente boolean NOT NULL DEFAULT true,
  subtotal numeric(18, 6) NOT NULL DEFAULT 0,
  iva_monto numeric(18, 6) NOT NULL DEFAULT 0,
  total numeric(18, 6) NOT NULL DEFAULT 0,
  cuenta_corriente_delta numeric(18, 6) NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'aplicada' CHECK (estado IN ('aplicada', 'revertida')),
  revertida_at timestamptz,
  revertida_por uuid REFERENCES public.usuario (id) ON DELETE SET NULL,
  motivo_reversion text,
  resumen_reversion jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_factura_importada_aplicacion_comprobante UNIQUE (tenant_id, comprobante_id),
  CONSTRAINT chk_factura_importada_aplicacion_montos CHECK (
    subtotal >= 0 AND iva_monto >= 0 AND total >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_factura_importada_aplicacion_tenant_estado
  ON public.factura_importada_aplicacion (tenant_id, estado);

CREATE TRIGGER factura_importada_aplicacion_set_updated_at
  BEFORE UPDATE ON public.factura_importada_aplicacion
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.factura_importada_producto_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  aplicacion_id uuid NOT NULL REFERENCES public.factura_importada_aplicacion (id) ON DELETE CASCADE,
  comprobante_id uuid NOT NULL REFERENCES public.comprobante (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  creado_en_confirmacion boolean NOT NULL DEFAULT false,
  producto_before jsonb,
  producto_after jsonb NOT NULL DEFAULT '{}'::jsonb,
  producto_after_hash text NOT NULL DEFAULT '',
  precio_sucursal_before jsonb NOT NULL DEFAULT '[]'::jsonb,
  precio_sucursal_after jsonb NOT NULL DEFAULT '[]'::jsonb,
  precio_sucursal_after_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_factura_importada_producto_snapshot UNIQUE (aplicacion_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_factura_importada_producto_snapshot_producto
  ON public.factura_importada_producto_snapshot (tenant_id, producto_id);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.factura_importada_producto_snapshot;
DROP TABLE IF EXISTS public.factura_importada_aplicacion;

ALTER TABLE public.comprobante
  DROP COLUMN IF EXISTS anulado_por,
  DROP COLUMN IF EXISTS anulado_at,
  DROP COLUMN IF EXISTS motivo_anulacion,
  DROP COLUMN IF EXISTS proveedor_id,
  DROP COLUMN IF EXISTS tipo_operacion,
  DROP COLUMN IF EXISTS sucursal_id;
`);
  }
}
