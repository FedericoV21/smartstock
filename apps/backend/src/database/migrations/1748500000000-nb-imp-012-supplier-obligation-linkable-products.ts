import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-IMP-012: condici├│n de pago proveedor, obligaciones import_lista y prefs de negocio.
 */
export class NbImp012SupplierObligationLinkableProducts1748500000000 implements MigrationInterface {
  name = 'NbImp012SupplierObligationLinkableProducts1748500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.proveedor
  ADD COLUMN IF NOT EXISTS condicion_pago_default text NOT NULL DEFAULT 'contado',
  ADD COLUMN IF NOT EXISTS plazo_pago_dias integer;

ALTER TABLE public.proveedor
  DROP CONSTRAINT IF EXISTS chk_proveedor_condicion_plazo;

ALTER TABLE public.proveedor
  DROP CONSTRAINT IF EXISTS chk_proveedor_plazo_pago;

ALTER TABLE public.proveedor
  ADD CONSTRAINT chk_proveedor_condicion_plazo
    CHECK (condicion_pago_default IN ('contado', 'dias'));

ALTER TABLE public.proveedor
  ADD CONSTRAINT chk_proveedor_plazo_pago
    CHECK (
      (condicion_pago_default = 'dias' AND plazo_pago_dias IS NOT NULL AND plazo_pago_dias > 0)
      OR
      (condicion_pago_default = 'contado' AND plazo_pago_dias IS NULL)
    );

ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS business_prefs jsonb;

ALTER TABLE public.sucursal
  ADD COLUMN IF NOT EXISTS business_prefs jsonb;

DO $$ BEGIN
  CREATE TYPE public.tipo_cuenta_corriente AS ENUM ('cliente', 'empleado', 'proveedor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.cuenta_corriente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  cliente_id uuid REFERENCES public.cliente (id) ON DELETE CASCADE,
  proveedor_id uuid REFERENCES public.proveedor (id) ON DELETE CASCADE,
  saldo numeric(18, 6) NOT NULL DEFAULT 0,
  tipo_cuenta public.tipo_cuenta_corriente NOT NULL DEFAULT 'cliente',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cuenta_corriente_parte CHECK (
    (cliente_id IS NOT NULL AND proveedor_id IS NULL AND tipo_cuenta IN ('cliente', 'empleado'))
    OR
    (cliente_id IS NULL AND proveedor_id IS NOT NULL AND tipo_cuenta = 'proveedor')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_corriente_tenant_cliente
  ON public.cuenta_corriente (tenant_id, cliente_id)
  WHERE cliente_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_corriente_tenant_proveedor
  ON public.cuenta_corriente (tenant_id, proveedor_id)
  WHERE proveedor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cuenta_corriente_tenant
  ON public.cuenta_corriente (tenant_id);

DROP TRIGGER IF EXISTS set_cuenta_corriente_updated_at ON public.cuenta_corriente;
CREATE TRIGGER set_cuenta_corriente_updated_at
  BEFORE UPDATE ON public.cuenta_corriente
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime(updated_at);

CREATE TABLE IF NOT EXISTS public.pago_proveedor_factura (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  comprobante_id uuid REFERENCES public.comprobante (id) ON DELETE CASCADE,
  proveedor_id uuid NOT NULL REFERENCES public.proveedor (id) ON DELETE CASCADE,
  monto_original numeric(18, 6) NOT NULL
    CONSTRAINT chk_ppf_monto_pos CHECK (monto_original > 0),
  saldo_pendiente numeric(18, 6) NOT NULL
    CONSTRAINT chk_ppf_saldo_no_neg CHECK (saldo_pendiente >= 0),
  vencimiento_at timestamptz NOT NULL,
  condicion_pago text NOT NULL
    CONSTRAINT chk_ppf_cond CHECK (condicion_pago IN ('contado', 'dias', 'fecha_fija')),
  estado text NOT NULL DEFAULT 'pendiente'
    CONSTRAINT chk_ppf_estado CHECK (estado IN ('pendiente', 'parcial', 'pagada', 'anulada')),
  origen text NOT NULL DEFAULT 'comprobante'
    CONSTRAINT chk_ppf_origen CHECK (origen IN ('comprobante', 'import_lista')),
  referencia text,
  recordatorio_snooze_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ppf_saldo_monto CHECK (saldo_pendiente <= monto_original),
  CONSTRAINT chk_ppf_comprobante_o_import CHECK (
    (origen = 'comprobante' AND comprobante_id IS NOT NULL)
    OR
    (origen = 'import_lista' AND comprobante_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pago_proveedor_fact_tenant_comprobante
  ON public.pago_proveedor_factura (tenant_id, comprobante_id)
  WHERE comprobante_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pago_proveedor_fact_tenant_proveedor
  ON public.pago_proveedor_factura (tenant_id, proveedor_id);

CREATE INDEX IF NOT EXISTS idx_pago_proveedor_fact_tenant_venc
  ON public.pago_proveedor_factura (tenant_id, vencimiento_at);

DROP TRIGGER IF EXISTS set_pago_proveedor_factura_updated_at ON public.pago_proveedor_factura;
CREATE TRIGGER set_pago_proveedor_factura_updated_at
  BEFORE UPDATE ON public.pago_proveedor_factura
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime(updated_at);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.pago_proveedor_factura CASCADE;
DROP TABLE IF EXISTS public.cuenta_corriente CASCADE;
ALTER TABLE public.sucursal DROP COLUMN IF EXISTS business_prefs;
ALTER TABLE public.tenant DROP COLUMN IF EXISTS business_prefs;
ALTER TABLE public.proveedor
  DROP CONSTRAINT IF EXISTS chk_proveedor_plazo_pago,
  DROP CONSTRAINT IF EXISTS chk_proveedor_condicion_plazo,
  DROP COLUMN IF EXISTS plazo_pago_dias,
  DROP COLUMN IF EXISTS condicion_pago_default;
DROP TYPE IF EXISTS public.tipo_cuenta_corriente CASCADE;
`);
  }
}
