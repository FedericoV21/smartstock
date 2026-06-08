CREATE TABLE IF NOT EXISTS public.turno_reserva_fija (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  agenda_id UUID NOT NULL REFERENCES public.turno_agenda(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES public.cliente(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  notas TEXT,
  dia_semana SMALLINT NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
  CONSTRAINT chk_turno_reserva_fija_nombre CHECK (length(btrim(nombre)) > 0),
  CONSTRAINT chk_turno_reserva_fija_dia CHECK (dia_semana BETWEEN 1 AND 7),
  CONSTRAINT chk_turno_reserva_fija_rango CHECK (hora_fin <> hora_inicio)
);

CREATE TABLE IF NOT EXISTS public.turno_agenda_extra_horario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  agenda_id UUID NOT NULL REFERENCES public.turno_agenda(id) ON DELETE CASCADE,
  dia_semana SMALLINT NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  extra_monto NUMERIC(12,2) NOT NULL DEFAULT 0,
  descripcion TEXT,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_turno_extra_dia CHECK (dia_semana BETWEEN 1 AND 7),
  CONSTRAINT chk_turno_extra_rango CHECK (hora_fin <> hora_inicio),
  CONSTRAINT chk_turno_extra_monto CHECK (extra_monto >= 0)
);

CREATE INDEX IF NOT EXISTS idx_turno_reserva_fija_agenda_dia
  ON public.turno_reserva_fija (agenda_id, dia_semana, hora_inicio)
  WHERE activa = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_turno_reserva_fija_slot_activo
  ON public.turno_reserva_fija (agenda_id, dia_semana, hora_inicio)
  WHERE activa = TRUE;

CREATE INDEX IF NOT EXISTS idx_turno_reserva_fija_tenant_sucursal
  ON public.turno_reserva_fija (tenant_id, sucursal_id, activa);

CREATE INDEX IF NOT EXISTS idx_turno_extra_agenda_dia
  ON public.turno_agenda_extra_horario (agenda_id, dia_semana, hora_inicio)
  WHERE activa = TRUE;

CREATE OR REPLACE TRIGGER set_turno_reserva_fija_updated_at
  BEFORE UPDATE ON public.turno_reserva_fija
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

CREATE OR REPLACE TRIGGER set_turno_extra_horario_updated_at
  BEFORE UPDATE ON public.turno_agenda_extra_horario
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

ALTER TABLE public.turno_reserva_fija ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turno_agenda_extra_horario ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_turno_reserva_fija ON public.turno_reserva_fija
  FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_insert_turno_reserva_fija ON public.turno_reserva_fija
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_update_turno_reserva_fija ON public.turno_reserva_fija
  FOR UPDATE USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_delete_turno_reserva_fija ON public.turno_reserva_fija
  FOR DELETE USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_select_turno_extra_horario ON public.turno_agenda_extra_horario
  FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_insert_turno_extra_horario ON public.turno_agenda_extra_horario
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_update_turno_extra_horario ON public.turno_agenda_extra_horario
  FOR UPDATE USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_delete_turno_extra_horario ON public.turno_agenda_extra_horario
  FOR DELETE USING (tenant_id = public.current_tenant_id());

GRANT ALL ON TABLE public.turno_reserva_fija TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.turno_agenda_extra_horario TO anon, authenticated, service_role;

COMMENT ON TABLE public.turno_reserva_fija IS
  'Reservas semanales fijas por agenda, cliente y franja horaria.';

COMMENT ON TABLE public.turno_agenda_extra_horario IS
  'Extras de precio semanales por agenda, dia y franja horaria.';
