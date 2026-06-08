-- Datos propios de la plantilla para no pisar catalogo al enlazar cortes existentes.

ALTER TABLE public.despiece_corte
  ADD COLUMN IF NOT EXISTS nombre_en_plantilla TEXT,
  ADD COLUMN IF NOT EXISTS plu_sugerido VARCHAR(5);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_despiece_corte_plu_sugerido'
      AND conrelid = 'public.despiece_corte'::regclass
  ) THEN
    ALTER TABLE public.despiece_corte
      ADD CONSTRAINT chk_despiece_corte_plu_sugerido
      CHECK (plu_sugerido IS NULL OR plu_sugerido ~ '^[0-9]{5}$');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
