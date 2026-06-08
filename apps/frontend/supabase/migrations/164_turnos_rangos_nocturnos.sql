ALTER TABLE public.turno_agenda_disponibilidad
  DROP CONSTRAINT IF EXISTS chk_turno_disp_rango;

ALTER TABLE public.turno_agenda_disponibilidad
  ADD CONSTRAINT chk_turno_disp_rango
  CHECK (hora_fin <> hora_inicio);

ALTER TABLE public.turno_bloqueo
  DROP CONSTRAINT IF EXISTS chk_turno_bloqueo_rango;

ALTER TABLE public.turno_bloqueo
  ADD CONSTRAINT chk_turno_bloqueo_rango
  CHECK (hora_fin <> hora_inicio);

ALTER TABLE public.turno_reserva
  DROP CONSTRAINT IF EXISTS chk_turno_reserva_rango;

ALTER TABLE public.turno_reserva
  ADD CONSTRAINT chk_turno_reserva_rango
  CHECK (hora_fin <> hora_inicio);

COMMENT ON CONSTRAINT chk_turno_disp_rango ON public.turno_agenda_disponibilidad IS
  'Permite rangos nocturnos: si hora_fin es menor que hora_inicio, el rango termina al dia siguiente.';

COMMENT ON CONSTRAINT chk_turno_bloqueo_rango ON public.turno_bloqueo IS
  'Permite bloqueos nocturnos: si hora_fin es menor que hora_inicio, el rango termina al dia siguiente.';

COMMENT ON CONSTRAINT chk_turno_reserva_rango ON public.turno_reserva IS
  'Permite reservas nocturnas: si hora_fin es menor que hora_inicio, el rango termina al dia siguiente.';
