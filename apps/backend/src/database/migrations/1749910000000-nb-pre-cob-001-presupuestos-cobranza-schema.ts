import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-PRE-001 / NB-COB-001: pedido.numero_orden + pedido.sucursal_id,
 * siguiente_numero_orden, cobranza_factura/cobranza_pago, registrar_pago_cobranza.
 */
export class NbPreCob001PresupuestosCobranzaSchema1749910000000 implements MigrationInterface {
  name = 'NbPreCob001PresupuestosCobranzaSchema1749910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.pedido
  ADD COLUMN IF NOT EXISTS numero_orden INTEGER,
  ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES public.sucursal (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pedido.numero_orden IS
  'Orden de venta interna por tenant (misma que comprobante.numero_orden).';

CREATE INDEX IF NOT EXISTS idx_pedido_tenant_numero_orden
  ON public.pedido (tenant_id, numero_orden);

CREATE INDEX IF NOT EXISTS idx_pedido_sucursal
  ON public.pedido (tenant_id, sucursal_id);

CREATE OR REPLACE FUNCTION public.siguiente_numero_orden(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_comp INTEGER;
  v_max_ped  INTEGER;
BEGIN
  SELECT COALESCE(MAX(numero_orden), 0) INTO v_max_comp
  FROM public.comprobante
  WHERE tenant_id = p_tenant_id;

  SELECT COALESCE(MAX(numero_orden), 0) INTO v_max_ped
  FROM public.pedido
  WHERE tenant_id = p_tenant_id;

  RETURN GREATEST(v_max_comp, v_max_ped) + 1;
END;
$$;

CREATE TABLE IF NOT EXISTS public.cobranza_factura (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  comprobante_id            UUID NOT NULL REFERENCES public.comprobante (id) ON DELETE CASCADE,
  cliente_id                UUID NOT NULL REFERENCES public.cliente (id) ON DELETE CASCADE,
  monto_original            NUMERIC(18, 6) NOT NULL,
  saldo_pendiente           NUMERIC(18, 6) NOT NULL,
  vencimiento_at            TIMESTAMPTZ NOT NULL,
  recordatorio_snooze_until TIMESTAMPTZ NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_cobranza_factura_comprobante UNIQUE (tenant_id, comprobante_id),
  CONSTRAINT chk_cobranza_saldo_no_neg CHECK (saldo_pendiente >= 0),
  CONSTRAINT chk_cobranza_monto_pos CHECK (monto_original > 0)
);

CREATE INDEX IF NOT EXISTS idx_cobranza_factura_tenant_saldo
  ON public.cobranza_factura (tenant_id)
  WHERE saldo_pendiente > 0;

CREATE INDEX IF NOT EXISTS idx_cobranza_factura_cliente
  ON public.cobranza_factura (tenant_id, cliente_id);

DROP TRIGGER IF EXISTS set_cobranza_factura_updated_at ON public.cobranza_factura;
CREATE TRIGGER set_cobranza_factura_updated_at
  BEFORE UPDATE ON public.cobranza_factura
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.cobranza_pago (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  cobranza_factura_id UUID NOT NULL REFERENCES public.cobranza_factura (id) ON DELETE CASCADE,
  monto               NUMERIC(18, 6) NOT NULL
    CONSTRAINT chk_cobranza_pago_monto_pos CHECK (monto > 0),
  tipo_pago           public.tipo_pago NOT NULL DEFAULT 'efectivo',
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  usuario_id          UUID REFERENCES public.usuario (id) ON DELETE SET NULL,
  notas               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cobranza_pago_tenant
  ON public.cobranza_pago (tenant_id);

CREATE INDEX IF NOT EXISTS idx_cobranza_pago_factura
  ON public.cobranza_pago (cobranza_factura_id);

CREATE OR REPLACE FUNCTION public.registrar_pago_cobranza(
  p_tenant_id UUID,
  p_cobranza_factura_id UUID,
  p_monto NUMERIC,
  p_tipo_pago public.tipo_pago DEFAULT 'efectivo',
  p_notas TEXT DEFAULT NULL,
  p_usuario_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.cobranza_factura%ROWTYPE;
  v_new_saldo NUMERIC(18, 6);
  v_new_venc TIMESTAMPTZ;
  v_pago_id UUID;
  v_pago_cc public.pago;
BEGIN
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  SELECT * INTO v_row
  FROM public.cobranza_factura
  WHERE id = p_cobranza_factura_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobranza no encontrada';
  END IF;

  IF p_monto > v_row.saldo_pendiente THEN
    RAISE EXCEPTION 'El monto supera el saldo pendiente';
  END IF;

  v_new_saldo := v_row.saldo_pendiente - p_monto;

  IF v_new_saldo > 0 THEN
    v_new_venc := now() + interval '7 days';
  ELSE
    v_new_venc := v_row.vencimiento_at;
  END IF;

  UPDATE public.cobranza_factura
  SET
    saldo_pendiente = v_new_saldo,
    vencimiento_at = v_new_venc,
    recordatorio_snooze_until = NULL,
    updated_at = now()
  WHERE id = v_row.id;

  INSERT INTO public.cobranza_pago (
    tenant_id,
    cobranza_factura_id,
    monto,
    tipo_pago,
    fecha,
    usuario_id,
    notas
  )
  VALUES (
    p_tenant_id,
    v_row.id,
    p_monto,
    p_tipo_pago,
    CURRENT_DATE,
    p_usuario_id,
    p_notas
  )
  RETURNING id INTO v_pago_id;

  v_pago_cc := public.registrar_pago(
    p_tenant_id,
    v_row.cliente_id,
    p_monto,
    p_tipo_pago,
    v_row.comprobante_id,
    NULL,
    p_notas,
    p_usuario_id
  );

  RETURN jsonb_build_object(
    'cobranza_pago_id', v_pago_id,
    'nuevo_saldo', v_new_saldo,
    'pago_cuenta_corriente_id', v_pago_cc.id
  );
END;
$$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP FUNCTION IF EXISTS public.registrar_pago_cobranza(UUID, UUID, NUMERIC, public.tipo_pago, TEXT, UUID);
DROP TABLE IF EXISTS public.cobranza_pago;
DROP TABLE IF EXISTS public.cobranza_factura;
DROP FUNCTION IF EXISTS public.siguiente_numero_orden(UUID);
DROP INDEX IF EXISTS idx_pedido_sucursal;
DROP INDEX IF EXISTS idx_pedido_tenant_numero_orden;
ALTER TABLE public.pedido
  DROP COLUMN IF EXISTS sucursal_id,
  DROP COLUMN IF EXISTS numero_orden;
`);
  }
}
