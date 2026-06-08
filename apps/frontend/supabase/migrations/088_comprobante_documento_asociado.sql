-- Nota de crédito: referencia al comprobante fiscal original (factura) para trazabilidad y reintentos ARCA (CbtesAsoc).

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS documento_asociado_id uuid REFERENCES public.comprobante (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comprobante_documento_asociado
  ON public.comprobante (documento_asociado_id)
  WHERE documento_asociado_id IS NOT NULL;

COMMENT ON COLUMN public.comprobante.documento_asociado_id IS
  'Comprobante asociado (p. ej. factura A/B/C referenciada por una nota de crédito). Usado en ARCA CbtesAsoc y en reintentos de CAE.';
