-- API async para lector de facturas IA.
-- Modelo aditivo: no cambia el flujo existente de /lector-facturas.

BEGIN;

CREATE TABLE IF NOT EXISTS public.api_integracion_key (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id UUID REFERENCES public.sucursal (id) ON DELETE SET NULL,
  usuario_id UUID REFERENCES public.usuario (id) ON DELETE SET NULL,
  nombre TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_preview TEXT,
  scopes TEXT[] NOT NULL DEFAULT ARRAY[
    'lector_facturas:jobs:create',
    'lector_facturas:jobs:read'
  ],
  estado TEXT NOT NULL DEFAULT 'activa',
  rate_limit_por_minuto INTEGER NOT NULL DEFAULT 10,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uk_api_integracion_key_hash UNIQUE (key_hash),
  CONSTRAINT chk_api_integracion_key_estado CHECK (estado IN ('activa', 'revocada', 'pausada')),
  CONSTRAINT chk_api_integracion_key_rate CHECK (rate_limit_por_minuto > 0)
);

CREATE INDEX IF NOT EXISTS idx_api_integracion_key_tenant
  ON public.api_integracion_key (tenant_id, estado);

CREATE TRIGGER set_api_integracion_key_updated_at
  BEFORE UPDATE ON public.api_integracion_key
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

COMMENT ON TABLE public.api_integracion_key IS
  'Claves API por tenant/sucursal para integraciones externas como chatbots.';

COMMENT ON COLUMN public.api_integracion_key.key_hash IS
  'SHA-256 hexadecimal del token plano. El token plano no se guarda.';

CREATE TABLE IF NOT EXISTS public.lector_factura_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id UUID REFERENCES public.sucursal (id) ON DELETE SET NULL,
  usuario_id UUID REFERENCES public.usuario (id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES public.api_integracion_key (id) ON DELETE SET NULL,
  whatsapp_processing_job_id UUID REFERENCES public.whatsapp_processing_job (id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'api_publica',
  status TEXT NOT NULL DEFAULT 'queued',
  external_id TEXT,
  idempotency_key TEXT,
  callback_url TEXT,
  callback_status TEXT,
  callback_error TEXT,
  callback_sent_at TIMESTAMPTZ,
  archivos JSONB NOT NULL DEFAULT '[]'::jsonb,
  lector_factura_log_id UUID REFERENCES public.lector_factura_log (id) ON DELETE SET NULL,
  resultado JSONB,
  error_code TEXT,
  error_detail TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_lector_factura_job_source CHECK (source IN ('api_publica', 'whatsapp')),
  CONSTRAINT chk_lector_factura_job_status CHECK (status IN ('queued', 'processing', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_lector_factura_job_tenant_status_created
  ON public.lector_factura_job (tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_lector_factura_job_api_key
  ON public.lector_factura_job (api_key_id, created_at DESC)
  WHERE api_key_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lector_factura_job_log
  ON public.lector_factura_job (lector_factura_log_id)
  WHERE lector_factura_log_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_lector_factura_job_idempotency
  ON public.lector_factura_job (tenant_id, api_key_id, idempotency_key)
  WHERE api_key_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_lector_factura_job_external
  ON public.lector_factura_job (tenant_id, source, external_id)
  WHERE external_id IS NOT NULL;

CREATE TRIGGER set_lector_factura_job_updated_at
  BEFORE UPDATE ON public.lector_factura_job
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

COMMENT ON TABLE public.lector_factura_job IS
  'Cola async de preview JSON del lector de facturas IA para API externa y WhatsApp.';

ALTER TABLE public.api_integracion_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lector_factura_job ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_api_integracion_key ON public.api_integracion_key FOR SELECT
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_insert_api_integracion_key ON public.api_integracion_key FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_update_api_integracion_key ON public.api_integracion_key FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_delete_api_integracion_key ON public.api_integracion_key FOR DELETE
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_select_lector_factura_job ON public.lector_factura_job FOR SELECT
  USING (tenant_id = public.current_tenant_id());

GRANT ALL ON TABLE public.api_integracion_key TO anon;
GRANT ALL ON TABLE public.api_integracion_key TO authenticated;
GRANT ALL ON TABLE public.api_integracion_key TO service_role;
GRANT ALL ON TABLE public.lector_factura_job TO anon;
GRANT ALL ON TABLE public.lector_factura_job TO authenticated;
GRANT ALL ON TABLE public.lector_factura_job TO service_role;

COMMIT;
