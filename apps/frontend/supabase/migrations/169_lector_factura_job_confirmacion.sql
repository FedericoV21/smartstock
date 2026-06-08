-- Confirmacion/aplicacion de jobs del lector de facturas desde chatbot/API.

BEGIN;

ALTER TABLE public.lector_factura_job
  ADD COLUMN IF NOT EXISTS application_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS impacto_preview JSONB,
  ADD COLUMN IF NOT EXISTS impact_hash TEXT,
  ADD COLUMN IF NOT EXISTS confirm_payload JSONB,
  ADD COLUMN IF NOT EXISTS applied_comprobante_id UUID REFERENCES public.comprobante (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applied_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_lector_factura_job_application_status'
  ) THEN
    ALTER TABLE public.lector_factura_job
      ADD CONSTRAINT chk_lector_factura_job_application_status
      CHECK (application_status IN ('pending', 'blocked', 'applying', 'applied', 'error'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_lector_factura_job_application_status
  ON public.lector_factura_job (tenant_id, application_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lector_factura_job_applied_comprobante
  ON public.lector_factura_job (applied_comprobante_id)
  WHERE applied_comprobante_id IS NOT NULL;

ALTER TABLE public.api_integracion_key
  ALTER COLUMN scopes SET DEFAULT ARRAY[
    'lector_facturas:jobs:create',
    'lector_facturas:jobs:read',
    'lector_facturas:jobs:confirm'
  ];

COMMIT;
