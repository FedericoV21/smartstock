-- V50-ANAL-004: cuenta corriente de clientes y registro de pagos.
-- Requiere tabla cliente (006_facturacion) y public.current_tenant_id() (017).

-- ─── TABLAS ──────────────────────────────────────────────────────────

CREATE TABLE public.cuenta_corriente (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  cliente_id        UUID NOT NULL REFERENCES public.cliente (id) ON DELETE CASCADE,
  saldo             NUMERIC(18, 6) NOT NULL DEFAULT 0,
  limite_credito    NUMERIC(18, 6),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_cuenta_corriente_tenant_cliente
    UNIQUE (tenant_id, cliente_id)
);

CREATE INDEX idx_cuenta_corriente_tenant
  ON public.cuenta_corriente (tenant_id);

CREATE TRIGGER set_cuenta_corriente_updated_at
  BEFORE UPDATE ON public.cuenta_corriente
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

CREATE TYPE public.tipo_pago AS ENUM (
  'efectivo',
  'transferencia',
  'cheque',
  'tarjeta',
  'otro'
);

CREATE TABLE public.pago (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  cliente_id        UUID NOT NULL REFERENCES public.cliente (id) ON DELETE CASCADE,
  cuenta_id         UUID NOT NULL REFERENCES public.cuenta_corriente (id) ON DELETE CASCADE,
  comprobante_id    UUID REFERENCES public.comprobante (id) ON DELETE SET NULL,

  monto             NUMERIC(18, 6) NOT NULL
    CONSTRAINT chk_pago_monto_positivo CHECK (monto > 0),
  tipo_pago         public.tipo_pago NOT NULL DEFAULT 'efectivo',
  referencia        TEXT,
  notas             TEXT,
  fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
  usuario_id        UUID REFERENCES public.usuario (id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pago_tenant
  ON public.pago (tenant_id);

CREATE INDEX idx_pago_cuenta
  ON public.pago (cuenta_id);

CREATE INDEX idx_pago_cliente
  ON public.pago (cliente_id);

-- ─── RLS ─────────────────────────────────────────────────────────────

ALTER TABLE public.cuenta_corriente ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_cuenta_corriente
  ON public.cuenta_corriente FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_cuenta_corriente
  ON public.cuenta_corriente FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_cuenta_corriente
  ON public.cuenta_corriente FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_cuenta_corriente
  ON public.cuenta_corriente FOR DELETE
  USING (tenant_id = public.current_tenant_id());

ALTER TABLE public.pago ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_pago
  ON public.pago FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_pago
  ON public.pago FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_pago
  ON public.pago FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_pago
  ON public.pago FOR DELETE
  USING (tenant_id = public.current_tenant_id());

-- ─── FUNCIÓN: registrar_pago ─────────────────────────────────────────
-- Crea la cuenta corriente lazy si no existe, registra el pago y reduce el saldo.

CREATE OR REPLACE FUNCTION public.registrar_pago(
  p_tenant_id     UUID,
  p_cliente_id    UUID,
  p_monto         NUMERIC,
  p_tipo_pago     public.tipo_pago DEFAULT 'efectivo',
  p_comprobante_id UUID DEFAULT NULL,
  p_referencia    TEXT DEFAULT NULL,
  p_notas         TEXT DEFAULT NULL,
  p_usuario_id    UUID DEFAULT NULL
)
RETURNS public.pago
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cuenta  public.cuenta_corriente;
  v_pago    public.pago;
BEGIN
  IF p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  INSERT INTO public.cuenta_corriente (tenant_id, cliente_id)
  VALUES (p_tenant_id, p_cliente_id)
  ON CONFLICT (tenant_id, cliente_id) DO NOTHING;

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

-- ─── VISTA: clientes morosos ─────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_clientes_morosos AS
SELECT
  cc.tenant_id,
  cc.cliente_id,
  c.nombre        AS cliente_nombre,
  c.email         AS cliente_email,
  c.telefono      AS cliente_telefono,
  cc.saldo,
  cc.limite_credito,
  CASE
    WHEN cc.limite_credito IS NOT NULL AND cc.saldo > cc.limite_credito
      THEN true
    ELSE false
  END AS excede_limite
FROM public.cuenta_corriente cc
JOIN public.cliente c ON c.id = cc.cliente_id
WHERE cc.saldo > 0;
