import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-LEC-001 Phase A: Lector facturas foundation schema (no RLS, no storage).
 * Paridad Supabase 046, 154 (estado revertido), 167, 169.
 */
export class NbLec001LectorFacturasSchema1750100000000 implements MigrationInterface {
  name = 'NbLec001LectorFacturasSchema1750100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.modulo_config
  ADD COLUMN IF NOT EXISTS lector_facturas BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.lector_factura_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.usuario(id) ON DELETE CASCADE,
  archivo_url TEXT NOT NULL,
  archivo_nombre TEXT NOT NULL,
  archivo_mime TEXT NOT NULL,
  archivo_tamano INT NOT NULL,
  gemini_raw JSONB,
  datos_extraidos JSONB,
  direccion TEXT NOT NULL DEFAULT 'desconocida',
  estado TEXT NOT NULL DEFAULT 'extraido',
  comprobante_id UUID REFERENCES public.comprobante(id) ON DELETE SET NULL,
  proveedor_id UUID REFERENCES public.proveedor(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES public.cliente(id) ON DELETE SET NULL,
  error_mensaje TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_lector_factura_log_direccion CHECK (
    direccion IN ('recibida', 'emitida', 'desconocida')
  ),
  CONSTRAINT chk_lector_factura_log_estado CHECK (
    estado IN ('extraido', 'confirmado', 'descartado', 'error', 'revertido')
  )
);

CREATE INDEX IF NOT EXISTS idx_lector_factura_log_tenant
  ON public.lector_factura_log (tenant_id);

CREATE INDEX IF NOT EXISTS idx_lector_factura_log_estado
  ON public.lector_factura_log (tenant_id, estado);

CREATE INDEX IF NOT EXISTS idx_lector_factura_log_comprobante
  ON public.lector_factura_log (comprobante_id)
  WHERE comprobante_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_lector_factura_log_updated_at ON public.lector_factura_log;
CREATE TRIGGER set_lector_factura_log_updated_at
  BEFORE UPDATE ON public.lector_factura_log
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

CREATE TABLE IF NOT EXISTS public.api_integracion_key (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  sucursal_id UUID REFERENCES public.sucursal(id) ON DELETE SET NULL,
  usuario_id UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_preview TEXT,
  scopes TEXT[] NOT NULL DEFAULT ARRAY[
    'lector_facturas:jobs:create',
    'lector_facturas:jobs:read',
    'lector_facturas:jobs:confirm'
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

DROP TRIGGER IF EXISTS set_api_integracion_key_updated_at ON public.api_integracion_key;
CREATE TRIGGER set_api_integracion_key_updated_at
  BEFORE UPDATE ON public.api_integracion_key
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

CREATE TABLE IF NOT EXISTS public.lector_factura_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  sucursal_id UUID REFERENCES public.sucursal(id) ON DELETE SET NULL,
  usuario_id UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES public.api_integracion_key(id) ON DELETE SET NULL,
  whatsapp_processing_job_id UUID REFERENCES public.whatsapp_processing_job(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'api_publica',
  status TEXT NOT NULL DEFAULT 'queued',
  external_id TEXT,
  idempotency_key TEXT,
  callback_url TEXT,
  callback_status TEXT,
  callback_error TEXT,
  callback_sent_at TIMESTAMPTZ,
  archivos JSONB NOT NULL DEFAULT '[]'::jsonb,
  lector_factura_log_id UUID REFERENCES public.lector_factura_log(id) ON DELETE SET NULL,
  resultado JSONB,
  error_code TEXT,
  error_detail TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  application_status TEXT NOT NULL DEFAULT 'pending',
  impacto_preview JSONB,
  impact_hash TEXT,
  confirm_payload JSONB,
  applied_comprobante_id UUID REFERENCES public.comprobante(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ,
  applied_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_lector_factura_job_source CHECK (source IN ('api_publica', 'whatsapp')),
  CONSTRAINT chk_lector_factura_job_status CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  CONSTRAINT chk_lector_factura_job_application_status CHECK (
    application_status IN ('pending', 'blocked', 'applying', 'applied', 'error')
  )
);

CREATE INDEX IF NOT EXISTS idx_lector_factura_job_tenant_status_created
  ON public.lector_factura_job (tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_lector_factura_job_api_key
  ON public.lector_factura_job (api_key_id, created_at DESC)
  WHERE api_key_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lector_factura_job_log
  ON public.lector_factura_job (lector_factura_log_id)
  WHERE lector_factura_log_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lector_factura_job_application_status
  ON public.lector_factura_job (tenant_id, application_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lector_factura_job_applied_comprobante
  ON public.lector_factura_job (applied_comprobante_id)
  WHERE applied_comprobante_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_lector_factura_job_idempotency
  ON public.lector_factura_job (tenant_id, api_key_id, idempotency_key)
  WHERE api_key_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_lector_factura_job_external
  ON public.lector_factura_job (tenant_id, source, external_id)
  WHERE external_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_lector_factura_job_updated_at ON public.lector_factura_job;
CREATE TRIGGER set_lector_factura_job_updated_at
  BEFORE UPDATE ON public.lector_factura_job
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TRIGGER IF EXISTS set_lector_factura_job_updated_at ON public.lector_factura_job;
DROP TABLE IF EXISTS public.lector_factura_job CASCADE;

DROP TRIGGER IF EXISTS set_api_integracion_key_updated_at ON public.api_integracion_key;
DROP TABLE IF EXISTS public.api_integracion_key CASCADE;

DROP TRIGGER IF EXISTS set_lector_factura_log_updated_at ON public.lector_factura_log;
DROP TABLE IF EXISTS public.lector_factura_log CASCADE;
`);
  }
}
