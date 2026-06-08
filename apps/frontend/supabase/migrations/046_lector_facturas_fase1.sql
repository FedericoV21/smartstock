-- V70-LECT-001..004: Lector de facturas (Plan H) — fundaciones DB, módulo, cuenta corriente proveedor, storage.
-- Requiere 020_cuenta_corriente, 026_facturador_pos (activar_plan), 030_storage_policies_tenant_claim, comprobante/proveedor/usuario.

-- ─── Enums ───────────────────────────────────────────────────────────

ALTER TYPE public.estado_comprobante ADD VALUE IF NOT EXISTS 'importado';

ALTER TYPE public.origen_precio ADD VALUE IF NOT EXISTS 'factura_recibida';
ALTER TYPE public.origen_precio ADD VALUE IF NOT EXISTS 'lector_factura';

ALTER TYPE public.referencia_tipo ADD VALUE IF NOT EXISTS 'factura_recibida';
ALTER TYPE public.referencia_tipo ADD VALUE IF NOT EXISTS 'factura_importada';

-- ─── modulo_config: flag Plan Completo ─────────────────────────────────

ALTER TABLE public.modulo_config
  ADD COLUMN IF NOT EXISTS lector_facturas BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.modulo_config.lector_facturas IS
  'Plan H: módulo lector de facturas con IA (Gemini).';

-- ─── comprobante: compras vs ventas + proveedor en facturas recibidas ─

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS tipo_operacion TEXT NOT NULL DEFAULT 'venta';

ALTER TABLE public.comprobante
  ADD CONSTRAINT chk_comprobante_tipo_operacion
  CHECK (tipo_operacion IN ('venta', 'compra'));

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES public.proveedor (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comprobante_proveedor
  ON public.comprobante (tenant_id, proveedor_id)
  WHERE proveedor_id IS NOT NULL;

COMMENT ON COLUMN public.comprobante.tipo_operacion IS
  'venta: flujo de emisión habitual; compra: factura recibida / importada (Plan H).';
COMMENT ON COLUMN public.comprobante.proveedor_id IS
  'Proveedor asociado cuando tipo_operacion = compra (factura recibida).';

-- ─── cuenta_corriente: misma tabla para cliente y proveedor ───────────

ALTER TABLE public.cuenta_corriente
  DROP CONSTRAINT IF EXISTS uq_cuenta_corriente_tenant_cliente;

ALTER TABLE public.cuenta_corriente
  ALTER COLUMN cliente_id DROP NOT NULL;

ALTER TABLE public.cuenta_corriente
  ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES public.proveedor (id) ON DELETE CASCADE;

ALTER TABLE public.cuenta_corriente
  ADD CONSTRAINT chk_cuenta_corriente_parte CHECK (
    (cliente_id IS NOT NULL AND proveedor_id IS NULL)
    OR (cliente_id IS NULL AND proveedor_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_corriente_tenant_cliente
  ON public.cuenta_corriente (tenant_id, cliente_id)
  WHERE cliente_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_corriente_tenant_proveedor
  ON public.cuenta_corriente (tenant_id, proveedor_id)
  WHERE proveedor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cuenta_corriente_proveedor
  ON public.cuenta_corriente (tenant_id, proveedor_id)
  WHERE proveedor_id IS NOT NULL;

COMMENT ON COLUMN public.cuenta_corriente.proveedor_id IS
  'Cuenta corriente a pagar (proveedor). Mutuamente excluyente con cliente_id.';

-- Lazy-create cuenta cliente: compatible con índice único parcial
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
  ON CONFLICT (tenant_id, cliente_id) WHERE cliente_id IS NOT NULL
  DO NOTHING;

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

-- ─── lector_factura_log ────────────────────────────────────────────────

CREATE TABLE public.lector_factura_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  usuario_id      UUID NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  archivo_url     TEXT NOT NULL,
  archivo_nombre  TEXT NOT NULL,
  archivo_mime    TEXT NOT NULL,
  archivo_tamano  INT NOT NULL,
  gemini_raw      JSONB,
  datos_extraidos JSONB,
  direccion       TEXT NOT NULL DEFAULT 'desconocida',
  estado          TEXT NOT NULL DEFAULT 'extraido',
  comprobante_id  UUID REFERENCES public.comprobante (id) ON DELETE SET NULL,
  proveedor_id    UUID REFERENCES public.proveedor (id) ON DELETE SET NULL,
  cliente_id      UUID REFERENCES public.cliente (id) ON DELETE SET NULL,
  error_mensaje   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_lector_factura_log_direccion CHECK (
    direccion IN ('recibida', 'emitida', 'desconocida')
  ),
  CONSTRAINT chk_lector_factura_log_estado CHECK (
    estado IN ('extraido', 'confirmado', 'descartado', 'error')
  )
);

CREATE INDEX idx_lector_factura_log_tenant
  ON public.lector_factura_log (tenant_id);

CREATE INDEX idx_lector_factura_log_estado
  ON public.lector_factura_log (tenant_id, estado);

CREATE INDEX idx_lector_factura_log_comprobante
  ON public.lector_factura_log (comprobante_id)
  WHERE comprobante_id IS NOT NULL;

CREATE TRIGGER set_lector_factura_log_updated_at
  BEFORE UPDATE ON public.lector_factura_log
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.lector_factura_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_lector_factura_log
  ON public.lector_factura_log FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_lector_factura_log
  ON public.lector_factura_log FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_lector_factura_log
  ON public.lector_factura_log FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_lector_factura_log
  ON public.lector_factura_log FOR DELETE
  USING (tenant_id = public.current_tenant_id());

-- ─── Storage: facturas-recibidas (mismo patrón que comprobantes) ───────

INSERT INTO storage.buckets (id, name, public)
VALUES ('facturas-recibidas', 'facturas-recibidas', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Tenant lee sus facturas recibidas (IA)"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'facturas-recibidas'
  AND (storage.foldername (name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant sube sus facturas recibidas (IA)"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'facturas-recibidas'
  AND (storage.foldername (name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant actualiza sus facturas recibidas (IA)"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'facturas-recibidas'
  AND (storage.foldername (name))[1] = public.current_tenant_id()::text
)
WITH CHECK (
  bucket_id = 'facturas-recibidas'
  AND (storage.foldername (name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant borra sus facturas recibidas (IA)"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'facturas-recibidas'
  AND (storage.foldername (name))[1] = public.current_tenant_id()::text
);

-- ─── activar_plan: lector_facturas en Plan Completo ────────────────────

CREATE OR REPLACE FUNCTION activar_plan(
  p_tenant_id UUID,
  p_plan      plan_tipo
) RETURNS void AS $$
BEGIN
  UPDATE tenant SET plan = p_plan WHERE id = p_tenant_id;

  IF p_plan = 'completo' THEN
    UPDATE modulo_config SET
      facturador_simple = true,
      facturador_arca = true,
      facturador_pos = true,
      pedidos = true,
      presupuestos = true,
      ia_precios = true,
      analizador_rentabilidad = true,
      lector_facturas = true
    WHERE tenant_id = p_tenant_id;
  ELSIF p_plan = 'base' THEN
    UPDATE modulo_config SET
      facturador_simple = true,
      facturador_arca = true,
      facturador_pos = true,
      pedidos = true,
      presupuestos = false,
      ia_precios = false,
      analizador_rentabilidad = false,
      lector_facturas = false
    WHERE tenant_id = p_tenant_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
