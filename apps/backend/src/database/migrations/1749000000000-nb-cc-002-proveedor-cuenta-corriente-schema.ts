import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-CC-002: cuenta corriente proveedor ÔÇö pago con proveedor_id, movimientos, registrar_pago_cuenta_proveedor.
 */
export class NbCc002ProveedorCuentaCorrienteSchema1749000000000 implements MigrationInterface {
  name = 'NbCc002ProveedorCuentaCorrienteSchema1749000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.pago
  ADD COLUMN IF NOT EXISTS proveedor_id uuid REFERENCES public.proveedor (id) ON DELETE RESTRICT;

ALTER TABLE public.pago
  ALTER COLUMN cliente_id DROP NOT NULL;

ALTER TABLE public.pago DROP CONSTRAINT IF EXISTS chk_pago_cliente_x_proveedor;
ALTER TABLE public.pago
  ADD CONSTRAINT chk_pago_cliente_x_proveedor CHECK (
    (cliente_id IS NOT NULL AND proveedor_id IS NULL)
    OR
    (cliente_id IS NULL AND proveedor_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_pago_tenant_proveedor
  ON public.pago (tenant_id, proveedor_id)
  WHERE proveedor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pago_proveedor_fecha
  ON public.pago (tenant_id, proveedor_id, fecha);

CREATE TABLE IF NOT EXISTS public.pago_proveedor_movimiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  pago_proveedor_factura_id uuid NOT NULL
    REFERENCES public.pago_proveedor_factura (id) ON DELETE CASCADE,
  monto numeric(18, 6) NOT NULL
    CONSTRAINT chk_ppm_monto_pos CHECK (monto > 0),
  tipo_pago public.tipo_pago NOT NULL DEFAULT 'efectivo',
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  usuario_id uuid REFERENCES public.usuario (id) ON DELETE SET NULL,
  notas text,
  recibo_comprobante_id uuid REFERENCES public.comprobante (id) ON DELETE SET NULL,
  pago_cuenta_corriente_id uuid REFERENCES public.pago (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pago_proveedor_mov_tenant
  ON public.pago_proveedor_movimiento (tenant_id);

CREATE INDEX IF NOT EXISTS idx_pago_proveedor_mov_fact
  ON public.pago_proveedor_movimiento (pago_proveedor_factura_id);

CREATE INDEX IF NOT EXISTS idx_pago_proveedor_mov_pago_cc
  ON public.pago_proveedor_movimiento (tenant_id, pago_cuenta_corriente_id)
  WHERE pago_cuenta_corriente_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.registrar_pago_cuenta_proveedor(
  p_tenant_id uuid,
  p_proveedor_id uuid,
  p_monto numeric,
  p_tipo_pago public.tipo_pago DEFAULT 'efectivo',
  p_comprobante_id uuid DEFAULT NULL,
  p_referencia text DEFAULT NULL,
  p_notas text DEFAULT NULL,
  p_usuario_id uuid DEFAULT NULL,
  p_fecha date DEFAULT NULL
)
RETURNS public.pago
LANGUAGE plpgsql
AS $$
DECLARE
  v_cuenta public.cuenta_corriente;
  v_pago public.pago;
  v_fecha date := COALESCE(p_fecha, CURRENT_DATE);
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  INSERT INTO public.cuenta_corriente (tenant_id, cliente_id, proveedor_id, saldo, tipo_cuenta)
  VALUES (p_tenant_id, NULL, p_proveedor_id, 0, 'proveedor')
  ON CONFLICT (tenant_id, proveedor_id) WHERE proveedor_id IS NOT NULL
  DO NOTHING;

  SELECT * INTO v_cuenta
  FROM public.cuenta_corriente
  WHERE tenant_id = p_tenant_id AND proveedor_id = p_proveedor_id
  FOR UPDATE;

  IF v_cuenta IS NULL OR v_cuenta.proveedor_id IS NULL THEN
    RAISE EXCEPTION 'Cuenta corriente de proveedor no encontrada';
  END IF;

  UPDATE public.cuenta_corriente
  SET saldo = saldo - p_monto
  WHERE id = v_cuenta.id;

  INSERT INTO public.pago (
    tenant_id,
    cliente_id,
    proveedor_id,
    cuenta_id,
    comprobante_id,
    monto,
    tipo_pago,
    referencia,
    notas,
    usuario_id,
    fecha
  ) VALUES (
    p_tenant_id,
    NULL,
    p_proveedor_id,
    v_cuenta.id,
    p_comprobante_id,
    p_monto,
    p_tipo_pago,
    p_referencia,
    p_notas,
    p_usuario_id,
    v_fecha
  )
  RETURNING * INTO v_pago;

  RETURN v_pago;
END;
$$;

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
    tenant_id, cliente_id, proveedor_id, cuenta_id,
    comprobante_id, monto, tipo_pago,
    referencia, notas, usuario_id
  ) VALUES (
    p_tenant_id, p_cliente_id, NULL, v_cuenta.id,
    p_comprobante_id, p_monto, p_tipo_pago,
    p_referencia, p_notas, p_usuario_id
  ) RETURNING * INTO v_pago;

  RETURN v_pago;
END;
$$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP FUNCTION IF EXISTS public.registrar_pago_cuenta_proveedor(
  uuid, uuid, numeric, public.tipo_pago, uuid, text, text, uuid, date
);
DROP TABLE IF EXISTS public.pago_proveedor_movimiento CASCADE;

DELETE FROM public.pago WHERE proveedor_id IS NOT NULL;

ALTER TABLE public.pago DROP CONSTRAINT IF EXISTS chk_pago_cliente_x_proveedor;
DROP INDEX IF EXISTS idx_pago_tenant_proveedor;
DROP INDEX IF EXISTS idx_pago_proveedor_fecha;
ALTER TABLE public.pago DROP COLUMN IF EXISTS proveedor_id;
ALTER TABLE public.pago ALTER COLUMN cliente_id SET NOT NULL;
`);
  }
}
