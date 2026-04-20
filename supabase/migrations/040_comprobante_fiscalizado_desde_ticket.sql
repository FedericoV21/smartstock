-- Ticket (negro): vínculo al comprobante fiscal emitido después, desde Facturación.

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS fiscalizado_por_id UUID REFERENCES public.comprobante (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comprobante_fiscalizado_por
  ON public.comprobante (fiscalizado_por_id)
  WHERE fiscalizado_por_id IS NOT NULL;

COMMENT ON COLUMN public.comprobante.fiscalizado_por_id IS
  'Si el comprobante es un ticket, ID del comprobante fiscal (factura) emitido para sustituirlo.';
