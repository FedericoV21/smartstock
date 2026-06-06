import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-PAY-001: medios de pago configurables, opciones de financiaci├│n y atajos POS.
 * Port de 038_medios_pago_financiacion.sql + 039_medio_pago_rapido.sql.
 */
export class NbPay001MediosPagoSchema1749700000000 implements MigrationInterface {
  name = 'NbPay001MediosPagoSchema1749700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.medio_pago (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  orden       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medio_pago_tenant_activo
  ON public.medio_pago (tenant_id, activo);

CREATE TABLE IF NOT EXISTS public.medio_pago_opcion (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medio_pago_id      UUID NOT NULL REFERENCES public.medio_pago(id) ON DELETE CASCADE,
  cuotas             INTEGER NOT NULL,
  recargo_porcentaje NUMERIC(12, 4) NOT NULL,
  CONSTRAINT chk_medio_pago_opcion_cuotas CHECK (cuotas >= 1),
  CONSTRAINT uq_medio_pago_opcion_medio_cuotas UNIQUE (medio_pago_id, cuotas)
);

CREATE INDEX IF NOT EXISTS idx_medio_pago_opcion_medio
  ON public.medio_pago_opcion (medio_pago_id);

DROP TRIGGER IF EXISTS set_medio_pago_updated_at ON public.medio_pago;
CREATE TRIGGER set_medio_pago_updated_at
  BEFORE UPDATE ON public.medio_pago
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.medio_pago_rapido (
  tenant_id          UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  codigo             VARCHAR(20) NOT NULL,
  recargo_porcentaje NUMERIC(12, 4) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, codigo),
  CONSTRAINT chk_medio_pago_rapido_codigo CHECK (
    codigo IN ('efectivo', 'debito', 'credito', 'transferencia', 'mixto')
  )
);

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS total_mercaderia NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS medio_pago_opcion_id UUID REFERENCES public.medio_pago_opcion(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS financiacion_monto NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS financiacion_porcentaje NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS financiacion_descripcion TEXT;

CREATE INDEX IF NOT EXISTS idx_comprobante_medio_pago_opcion
  ON public.comprobante (medio_pago_opcion_id);

COMMENT ON COLUMN public.comprobante.total_mercaderia IS
  'Total de mercader├¡a (antes de recargo/descuento por medio de pago). Si NULL, no hubo financiaci├│n expl├¡cita.';
COMMENT ON COLUMN public.comprobante.financiacion_monto IS
  'Monto del ajuste: positivo recargo, negativo descuento. ImpTrib ARCA solo si > 0.';
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.comprobante
  DROP COLUMN IF EXISTS financiacion_descripcion,
  DROP COLUMN IF EXISTS financiacion_porcentaje,
  DROP COLUMN IF EXISTS financiacion_monto,
  DROP COLUMN IF EXISTS medio_pago_opcion_id,
  DROP COLUMN IF EXISTS total_mercaderia;

DROP TABLE IF EXISTS public.medio_pago_rapido;
DROP TRIGGER IF EXISTS set_medio_pago_updated_at ON public.medio_pago;
DROP TABLE IF EXISTS public.medio_pago_opcion;
DROP TABLE IF EXISTS public.medio_pago;
`);
  }
}
