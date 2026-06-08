ALTER TABLE public.turno_reserva
  ADD COLUMN IF NOT EXISTS sena_monto NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.turno_reserva
  DROP CONSTRAINT IF EXISTS chk_turno_reserva_sena_monto;

ALTER TABLE public.turno_reserva
  ADD CONSTRAINT chk_turno_reserva_sena_monto
  CHECK (sena_monto >= 0 AND sena_monto <= precio_snapshot);

COMMENT ON COLUMN public.turno_reserva.sena_monto IS
  'Monto de seña registrado en la reserva. Al cobrar desde POS se precarga como descuento fijo.';
