-- Último payment intent creado para el POS (sobrevive si se borra el borrador y permite cancelar por API).

ALTER TABLE public.mp_point_config
  ADD COLUMN IF NOT EXISTS last_payment_intent_id TEXT;

COMMENT ON COLUMN public.mp_point_config.last_payment_intent_id IS
  'ID del último payment intent enviado a la terminal; se usa para cancelar intents huérfanos si ya no hay comprobante asociado.';
