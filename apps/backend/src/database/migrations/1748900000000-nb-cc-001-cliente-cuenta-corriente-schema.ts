import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-CC-001: cuenta corriente cliente ÔÇö pago, condiciones de cobro, funciones registrar_pago.
 */
export class NbCc001ClienteCuentaCorrienteSchema1748900000000 implements MigrationInterface {
  name = 'NbCc001ClienteCuentaCorrienteSchema1748900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DO $$ BEGIN
  CREATE TYPE public.tipo_pago AS ENUM ('efectivo', 'transferencia', 'cheque', 'tarjeta', 'otro');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.cobro_modalidad AS ENUM ('por_comprobante', 'periodico', 'dia_fijo_mes');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.cobro_periodicidad AS ENUM ('diaria', 'semanal', 'quincenal', 'mensual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.cuenta_corriente
  ADD COLUMN IF NOT EXISTS limite_credito numeric(18, 6),
  ADD COLUMN IF NOT EXISTS cobro_modalidad public.cobro_modalidad NOT NULL DEFAULT 'por_comprobante',
  ADD COLUMN IF NOT EXISTS cobro_dias_plazo integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS cobro_periodicidad public.cobro_periodicidad,
  ADD COLUMN IF NOT EXISTS cobro_dia_vencimiento_mes integer,
  ADD COLUMN IF NOT EXISTS cobro_monto_minimo numeric(18, 6) NOT NULL DEFAULT 0;

ALTER TABLE public.cuenta_corriente DROP CONSTRAINT IF EXISTS chk_cuenta_corriente_dias_plazo_rango;
ALTER TABLE public.cuenta_corriente
  ADD CONSTRAINT chk_cuenta_corriente_dias_plazo_rango CHECK (
    cobro_dias_plazo >= 1 AND cobro_dias_plazo <= 3650
  );

ALTER TABLE public.cuenta_corriente DROP CONSTRAINT IF EXISTS chk_cuenta_corriente_monto_minimo_no_neg;
ALTER TABLE public.cuenta_corriente
  ADD CONSTRAINT chk_cuenta_corriente_monto_minimo_no_neg CHECK (cobro_monto_minimo >= 0);

ALTER TABLE public.cuenta_corriente DROP CONSTRAINT IF EXISTS chk_cuenta_corriente_cobro_coherente;
ALTER TABLE public.cuenta_corriente
  ADD CONSTRAINT chk_cuenta_corriente_cobro_coherente CHECK (
    (
      cobro_modalidad = 'por_comprobante'
      AND cobro_periodicidad IS NULL
      AND cobro_dia_vencimiento_mes IS NULL
    )
    OR (
      cobro_modalidad = 'periodico'
      AND cobro_periodicidad IS NOT NULL
      AND cobro_dia_vencimiento_mes IS NULL
    )
    OR (
      cobro_modalidad = 'dia_fijo_mes'
      AND cobro_periodicidad IS NULL
      AND cobro_dia_vencimiento_mes IS NOT NULL
      AND cobro_dia_vencimiento_mes >= 1
      AND cobro_dia_vencimiento_mes <= 31
    )
  );

CREATE TABLE IF NOT EXISTS public.pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.cliente (id) ON DELETE CASCADE,
  cuenta_id uuid NOT NULL REFERENCES public.cuenta_corriente (id) ON DELETE CASCADE,
  comprobante_id uuid REFERENCES public.comprobante (id) ON DELETE SET NULL,
  monto numeric(18, 6) NOT NULL CONSTRAINT chk_pago_monto_positivo CHECK (monto > 0),
  tipo_pago public.tipo_pago NOT NULL DEFAULT 'efectivo',
  referencia text,
  notas text,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  usuario_id uuid REFERENCES public.usuario (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pago_tenant ON public.pago (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pago_cuenta ON public.pago (cuenta_id);
CREATE INDEX IF NOT EXISTS idx_pago_cliente ON public.pago (cliente_id);
CREATE INDEX IF NOT EXISTS idx_pago_cliente_fecha ON public.pago (tenant_id, cliente_id, fecha);

CREATE OR REPLACE FUNCTION public.registrar_pago(
  p_tenant_id uuid,
  p_cliente_id uuid,
  p_monto numeric,
  p_tipo_pago public.tipo_pago DEFAULT 'efectivo',
  p_comprobante_id uuid DEFAULT NULL,
  p_referencia text DEFAULT NULL,
  p_notas text DEFAULT NULL,
  p_usuario_id uuid DEFAULT NULL
)
RETURNS public.pago
LANGUAGE plpgsql
AS $$
DECLARE
  v_cuenta public.cuenta_corriente;
  v_pago public.pago;
BEGIN
  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  INSERT INTO public.cuenta_corriente (tenant_id, cliente_id, saldo, tipo_cuenta)
  SELECT p_tenant_id, p_cliente_id, 0, 'cliente'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cuenta_corriente
    WHERE tenant_id = p_tenant_id AND cliente_id = p_cliente_id
  );

  SELECT * INTO v_cuenta
  FROM public.cuenta_corriente
  WHERE tenant_id = p_tenant_id AND cliente_id = p_cliente_id
  FOR UPDATE;

  UPDATE public.cuenta_corriente
  SET saldo = saldo - p_monto
  WHERE id = v_cuenta.id;

  INSERT INTO public.pago (
    tenant_id, cliente_id, cuenta_id,
    comprobante_id, monto, tipo_pago,
    referencia, notas, usuario_id
  ) VALUES (
    p_tenant_id, p_cliente_id, v_cuenta.id,
    p_comprobante_id, p_monto, p_tipo_pago,
    p_referencia, p_notas, p_usuario_id
  ) RETURNING * INTO v_pago;

  RETURN v_pago;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_pago_cliente_desde_cuenta_corriente(
  p_tenant_id uuid,
  p_cliente_id uuid,
  p_monto numeric,
  p_tipo_pago public.tipo_pago DEFAULT 'efectivo',
  p_referencia text DEFAULT NULL,
  p_notas text DEFAULT NULL,
  p_usuario_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_pago public.pago;
BEGIN
  IF p_cliente_id IS NULL OR p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'cliente_id y monto (> 0) son requeridos';
  END IF;

  v_pago := public.registrar_pago(
    p_tenant_id,
    p_cliente_id,
    p_monto,
    p_tipo_pago,
    NULL,
    p_referencia,
    p_notas,
    p_usuario_id
  );

  RETURN jsonb_build_object(
    'modo', 'cuenta_directa',
    'cobranzas_aplicadas', 0,
    'monto_sin_factura', p_monto,
    'pago_id', v_pago.id
  );
END;
$$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP FUNCTION IF EXISTS public.registrar_pago_cliente_desde_cuenta_corriente(uuid, uuid, numeric, public.tipo_pago, text, text, uuid);
DROP FUNCTION IF EXISTS public.registrar_pago(uuid, uuid, numeric, public.tipo_pago, uuid, text, text, uuid);
DROP TABLE IF EXISTS public.pago CASCADE;
ALTER TABLE public.cuenta_corriente
  DROP COLUMN IF EXISTS limite_credito,
  DROP COLUMN IF EXISTS cobro_modalidad,
  DROP COLUMN IF EXISTS cobro_dias_plazo,
  DROP COLUMN IF EXISTS cobro_periodicidad,
  DROP COLUMN IF EXISTS cobro_dia_vencimiento_mes,
  DROP COLUMN IF EXISTS cobro_monto_minimo;
DROP TYPE IF EXISTS public.tipo_pago CASCADE;
DROP TYPE IF EXISTS public.cobro_modalidad CASCADE;
DROP TYPE IF EXISTS public.cobro_periodicidad CASCADE;
`);
  }
}
