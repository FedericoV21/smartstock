-- Comprobante interno "recibo" (cobranza) + vínculo opcional desde cobranza_pago.
-- Requiere 044_cobranza_factura.sql (tablas public.cobranza_factura y public.cobranza_pago).

ALTER TYPE public.tipo_comprobante ADD VALUE IF NOT EXISTS 'recibo';

ALTER TABLE public.cobranza_pago
  ADD COLUMN IF NOT EXISTS recibo_comprobante_id UUID REFERENCES public.comprobante (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cobranza_pago_recibo
  ON public.cobranza_pago (recibo_comprobante_id)
  WHERE recibo_comprobante_id IS NOT NULL;

COMMENT ON COLUMN public.cobranza_pago.recibo_comprobante_id IS
  'Comprobante tipo recibo emitido por este cobro (PDF interno, sin ARCA).';
