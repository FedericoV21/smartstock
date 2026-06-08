-- POS: comprobante.caja_id era VARCHAR(20); el POS usa IDs de MP Point / QR MP
-- (external_pos_id, device_id) que superan 20 caracteres → error al emitir (p. ej. con ARCA).
-- Alineado con caja_apertura / cierre_z (caja_id TEXT).

ALTER TABLE public.comprobante
  ALTER COLUMN caja_id TYPE TEXT;

COMMENT ON COLUMN public.comprobante.caja_id IS
  'Identificador de caja en cierre (p. ej. __sin_caja__) o ID terminal MP / POS; sin límite corto.';
