-- Preferencias por caja (ej. ticket cuenta corriente sin importes). Opt-in por fila; default vacío.
ALTER TABLE public.caja
  ADD COLUMN IF NOT EXISTS prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.caja.prefs IS
  'Preferencias de operación de la caja (JSON). Ej. cuentaCorrienteCaja.ticketOcultarImportes.';
