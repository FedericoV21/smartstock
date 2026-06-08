-- API publica independiente para extraccion pura de facturas IA.

CREATE TABLE IF NOT EXISTS public.api_extractor_key (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_preview TEXT,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['invoice:extract']::TEXT[],
  estado TEXT NOT NULL DEFAULT 'activa',
  rate_limit_por_minuto INTEGER NOT NULL DEFAULT 10,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uk_api_extractor_key_hash UNIQUE (key_hash),
  CONSTRAINT chk_api_extractor_key_estado CHECK (estado IN ('activa', 'pausada', 'revocada')),
  CONSTRAINT chk_api_extractor_key_rate CHECK (rate_limit_por_minuto > 0)
);

CREATE INDEX IF NOT EXISTS idx_api_extractor_key_estado
  ON public.api_extractor_key (estado);

CREATE TRIGGER set_api_extractor_key_updated_at
  BEFORE UPDATE ON public.api_extractor_key
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime(updated_at);

COMMENT ON TABLE public.api_extractor_key IS
  'API keys para el producto extractor puro de facturas IA, independiente de tenants SmartStock.';

COMMENT ON COLUMN public.api_extractor_key.key_hash IS
  'SHA-256 de la API key. La key real no se almacena en texto plano.';

CREATE TABLE IF NOT EXISTS public.factura_extractor_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES public.api_extractor_key (id) ON DELETE SET NULL,
  archivo_nombre TEXT,
  archivo_mime TEXT,
  archivo_tamano BIGINT,
  estado TEXT NOT NULL,
  error_code TEXT,
  error_detail TEXT,
  duracion_ms INTEGER,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_factura_extractor_log_estado CHECK (estado IN ('extraido', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_factura_extractor_log_key_created
  ON public.factura_extractor_log (api_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_factura_extractor_log_estado_created
  ON public.factura_extractor_log (estado, created_at DESC);

COMMENT ON TABLE public.factura_extractor_log IS
  'Auditoria minima de uso del extractor puro. No guarda archivo, base64 ni raw completo de IA.';

ALTER TABLE public.api_extractor_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factura_extractor_log ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.api_extractor_key TO anon;
GRANT ALL ON TABLE public.api_extractor_key TO authenticated;
GRANT ALL ON TABLE public.api_extractor_key TO service_role;
GRANT ALL ON TABLE public.factura_extractor_log TO anon;
GRANT ALL ON TABLE public.factura_extractor_log TO authenticated;
GRANT ALL ON TABLE public.factura_extractor_log TO service_role;

