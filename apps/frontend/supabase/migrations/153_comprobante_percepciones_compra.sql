ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS percepcion_iibb_monto numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percepcion_iva_monto numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.comprobante
  DROP CONSTRAINT IF EXISTS chk_comprobante_percepciones_nonneg,
  ADD CONSTRAINT chk_comprobante_percepciones_nonneg
    CHECK (percepcion_iibb_monto >= 0 AND percepcion_iva_monto >= 0);

COMMENT ON COLUMN public.comprobante.percepcion_iibb_monto IS
  'Percepciones de Ingresos Brutos informadas en facturas de compra importadas o cargadas manualmente.';

COMMENT ON COLUMN public.comprobante.percepcion_iva_monto IS
  'Percepciones de IVA informadas en facturas de compra importadas o cargadas manualmente.';
