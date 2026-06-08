-- Motivo y auditoría de anulación interna (sin CAE AFIP válido / reverso de stock).

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS motivo_anulacion text,
  ADD COLUMN IF NOT EXISTS anulado_at timestamptz,
  ADD COLUMN IF NOT EXISTS anulado_por uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comprobante_anulado_por_fkey'
  ) THEN
    ALTER TABLE public.comprobante
      ADD CONSTRAINT comprobante_anulado_por_fkey
      FOREIGN KEY (anulado_por) REFERENCES public.usuario (id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.comprobante.motivo_anulacion IS
  'Texto obligatorio al anular con reverso interno (queda registrado; no pisar comprobante.notas).';
COMMENT ON COLUMN public.comprobante.anulado_at IS 'Marca de tiempo de la anulación interna.';
COMMENT ON COLUMN public.comprobante.anulado_por IS 'Usuario que ejecutó la anulación interna.';

NOTIFY pgrst, 'reload schema';
