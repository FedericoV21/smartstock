-- Permite borrar una integracion de pasarela sin perder historial de transacciones cerradas.
-- La API sigue bloqueando el borrado cuando hay cobros activos.

ALTER TABLE public.pasarela_transaccion
  ALTER COLUMN integracion_id DROP NOT NULL;

ALTER TABLE public.pasarela_transaccion
  DROP CONSTRAINT IF EXISTS pasarela_transaccion_integracion_id_fkey;

ALTER TABLE public.pasarela_transaccion
  ADD CONSTRAINT pasarela_transaccion_integracion_id_fkey
  FOREIGN KEY (integracion_id)
  REFERENCES public.pasarela_integracion (id)
  ON DELETE SET NULL;
