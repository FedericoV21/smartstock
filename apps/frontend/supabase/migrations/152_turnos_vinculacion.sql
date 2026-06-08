ALTER TABLE public.turno_agenda
  ADD COLUMN IF NOT EXISTS agenda_principal_id UUID NULL
    REFERENCES public.turno_agenda(id) ON DELETE SET NULL;

ALTER TABLE public.turno_agenda
  DROP CONSTRAINT IF EXISTS chk_turno_agenda_no_self_link;

ALTER TABLE public.turno_agenda
  ADD CONSTRAINT chk_turno_agenda_no_self_link
  CHECK (agenda_principal_id IS NULL OR agenda_principal_id <> id);

CREATE INDEX IF NOT EXISTS idx_turno_agenda_principal
  ON public.turno_agenda (agenda_principal_id)
  WHERE agenda_principal_id IS NOT NULL;

COMMENT ON COLUMN public.turno_agenda.agenda_principal_id IS
  'Si la agenda es dependiente, apunta a la agenda principal cuyas reservas activas la bloquean por solapamiento horario. Una agenda no puede ser a la vez principal y dependiente (validado en API).';
