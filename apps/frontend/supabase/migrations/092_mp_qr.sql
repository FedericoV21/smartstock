-- V100-MPQR-001: Mercado Pago QR estático (instore) — config por tenant, correlación en comprobante,
-- estado pendiente_qr, log opcional de webhooks.

ALTER TYPE public.estado_comprobante ADD VALUE IF NOT EXISTS 'pendiente_qr';

CREATE TABLE public.mp_qr_config (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  tenant_id          UUID NOT NULL UNIQUE REFERENCES public.tenant (id) ON DELETE CASCADE,
  access_token       TEXT,
  user_id            TEXT,
  external_pos_id    TEXT,
  webhook_secret     TEXT,
  habilitado         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now (),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now ()
);

COMMENT ON TABLE public.mp_qr_config IS
  'Credenciales MP QR estático por tenant. access_token cifrado en aplicación (AES como mp_point_config).';

CREATE INDEX idx_mp_qr_config_tenant ON public.mp_qr_config (tenant_id);

CREATE TRIGGER set_mp_qr_config_updated_at
  BEFORE UPDATE ON public.mp_qr_config
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.mp_qr_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_mp_qr_config
  ON public.mp_qr_config FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_mp_qr_config
  ON public.mp_qr_config FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_mp_qr_config
  ON public.mp_qr_config FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_mp_qr_config
  ON public.mp_qr_config FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS mp_qr_order_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_qr_payment_id BIGINT,
  ADD COLUMN IF NOT EXISTS mp_qr_pago_huerfano BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mp_qr_cancelado_at TIMESTAMPTZ;

COMMENT ON COLUMN public.comprobante.mp_qr_order_id IS
  'ID merchant_order de MP (correlación webhook / estado).';

COMMENT ON COLUMN public.comprobante.mp_qr_payment_id IS
  'ID del pago aprobado en MP tras cobro QR.';

COMMENT ON COLUMN public.comprobante.mp_qr_pago_huerfano IS
  'Pago aprobado en MP luego de cancelación local (revisar / devolver).';

CREATE INDEX IF NOT EXISTS idx_comprobante_mp_qr_order
  ON public.comprobante (tenant_id, mp_qr_order_id)
  WHERE mp_qr_order_id IS NOT NULL;

-- metodo_pago es VARCHAR: valor documentado adicional — ''qr_mp''

CREATE TABLE public.mp_qr_webhook_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  tenant_id     UUID REFERENCES public.tenant (id) ON DELETE SET NULL,
  comprobante_id UUID REFERENCES public.comprobante (id) ON DELETE SET NULL,
  topic         TEXT,
  merchant_order_id TEXT,
  resultado     TEXT,
  payload_snippet TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now ()
);

CREATE INDEX idx_mp_qr_webhook_log_created ON public.mp_qr_webhook_log (created_at DESC);

ALTER TABLE public.mp_qr_webhook_log ENABLE ROW LEVEL SECURITY;

-- Solo service role escribe; sin policy SELECT para usuarios (debug vía SQL/admin).
