ALTER TABLE public.modulo_config
  ADD COLUMN IF NOT EXISTS turnos BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.modulo_config
  DROP CONSTRAINT IF EXISTS chk_turnos_requiere_facturador;

ALTER TABLE public.modulo_config
  ADD CONSTRAINT chk_turnos_requiere_facturador
  CHECK (turnos = FALSE OR facturador_simple = TRUE);

COMMENT ON COLUMN public.modulo_config.turnos IS
  'Modulo de turnos internos por agenda. Requiere facturador_simple para cobrar/facturar reservas.';

ALTER TABLE public.producto
  ADD COLUMN IF NOT EXISTS es_servicio BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.producto.es_servicio IS
  'Producto no stockeable usado para servicios facturables (por ejemplo turnos). No debe mover stock al facturarse.';

CREATE TABLE IF NOT EXISTS public.turno_agenda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES public.producto(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  precio NUMERIC(12,2) NOT NULL DEFAULT 0,
  duracion_minutos SMALLINT NOT NULL DEFAULT 60,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_turno_agenda_nombre CHECK (length(btrim(nombre)) > 0),
  CONSTRAINT chk_turno_agenda_precio CHECK (precio >= 0),
  CONSTRAINT chk_turno_agenda_duracion_v1 CHECK (duracion_minutos = 60)
);

CREATE TABLE IF NOT EXISTS public.turno_agenda_disponibilidad (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  agenda_id UUID NOT NULL REFERENCES public.turno_agenda(id) ON DELETE CASCADE,
  dia_semana SMALLINT NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_turno_disp_dia CHECK (dia_semana BETWEEN 1 AND 7),
  CONSTRAINT chk_turno_disp_rango CHECK (hora_fin > hora_inicio)
);

CREATE TABLE IF NOT EXISTS public.turno_bloqueo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  agenda_id UUID NOT NULL REFERENCES public.turno_agenda(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  motivo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
  CONSTRAINT chk_turno_bloqueo_rango CHECK (hora_fin > hora_inicio)
);

CREATE TABLE IF NOT EXISTS public.turno_reserva (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  agenda_id UUID NOT NULL REFERENCES public.turno_agenda(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES public.cliente(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  notas TEXT,
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  precio_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'reservado',
  comprobante_id UUID REFERENCES public.comprobante(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
  cancelado_at TIMESTAMPTZ,
  cancelado_por UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
  CONSTRAINT chk_turno_reserva_nombre CHECK (length(btrim(nombre)) > 0),
  CONSTRAINT chk_turno_reserva_precio CHECK (precio_snapshot >= 0),
  CONSTRAINT chk_turno_reserva_rango CHECK (hora_fin > hora_inicio),
  CONSTRAINT chk_turno_reserva_estado CHECK (estado IN ('reservado', 'cobrando', 'cobrado', 'cancelado'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_turno_reserva_slot_activo
  ON public.turno_reserva (agenda_id, fecha, hora_inicio)
  WHERE estado IN ('reservado', 'cobrando', 'cobrado');

CREATE INDEX IF NOT EXISTS idx_turno_agenda_tenant_sucursal
  ON public.turno_agenda (tenant_id, sucursal_id, activa);

CREATE INDEX IF NOT EXISTS idx_turno_disp_agenda_dia
  ON public.turno_agenda_disponibilidad (agenda_id, dia_semana, hora_inicio);

CREATE INDEX IF NOT EXISTS idx_turno_bloqueo_agenda_fecha
  ON public.turno_bloqueo (agenda_id, fecha, hora_inicio);

CREATE INDEX IF NOT EXISTS idx_turno_reserva_agenda_fecha
  ON public.turno_reserva (agenda_id, fecha, hora_inicio);

CREATE OR REPLACE TRIGGER set_turno_agenda_updated_at
  BEFORE UPDATE ON public.turno_agenda
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

CREATE OR REPLACE TRIGGER set_turno_reserva_updated_at
  BEFORE UPDATE ON public.turno_reserva
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

ALTER TABLE public.turno_agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turno_agenda_disponibilidad ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turno_bloqueo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turno_reserva ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_turno_agenda ON public.turno_agenda
  FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_insert_turno_agenda ON public.turno_agenda
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_update_turno_agenda ON public.turno_agenda
  FOR UPDATE USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_delete_turno_agenda ON public.turno_agenda
  FOR DELETE USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_select_turno_disp ON public.turno_agenda_disponibilidad
  FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_insert_turno_disp ON public.turno_agenda_disponibilidad
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_update_turno_disp ON public.turno_agenda_disponibilidad
  FOR UPDATE USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_delete_turno_disp ON public.turno_agenda_disponibilidad
  FOR DELETE USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_select_turno_bloqueo ON public.turno_bloqueo
  FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_insert_turno_bloqueo ON public.turno_bloqueo
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_delete_turno_bloqueo ON public.turno_bloqueo
  FOR DELETE USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_select_turno_reserva ON public.turno_reserva
  FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_insert_turno_reserva ON public.turno_reserva
  FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_update_turno_reserva ON public.turno_reserva
  FOR UPDATE USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

GRANT ALL ON TABLE public.turno_agenda TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.turno_agenda_disponibilidad TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.turno_bloqueo TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.turno_reserva TO anon, authenticated, service_role;
