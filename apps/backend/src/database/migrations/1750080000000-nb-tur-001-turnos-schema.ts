import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-TUR-001: módulo turnos (agendas, reservas, bloqueos, reservas fijas).
 * Paridad Supabase 145, 152, 164, 165, 172.
 */
export class NbTur001TurnosSchema1750080000000 implements MigrationInterface {
  name = 'NbTur001TurnosSchema1750080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.modulo_config
  ADD COLUMN IF NOT EXISTS turnos BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.modulo_config
  DROP CONSTRAINT IF EXISTS chk_turnos_requiere_facturador;

ALTER TABLE public.modulo_config
  ADD CONSTRAINT chk_turnos_requiere_facturador
  CHECK (turnos = FALSE OR facturador_simple = TRUE);

ALTER TABLE public.producto
  ADD COLUMN IF NOT EXISTS es_servicio BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.turno_agenda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES public.producto(id) ON DELETE SET NULL,
  agenda_principal_id UUID REFERENCES public.turno_agenda(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  precio NUMERIC(12,2) NOT NULL DEFAULT 0,
  duracion_minutos SMALLINT NOT NULL DEFAULT 60,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_turno_agenda_nombre CHECK (length(btrim(nombre)) > 0),
  CONSTRAINT chk_turno_agenda_precio CHECK (precio >= 0),
  CONSTRAINT chk_turno_agenda_duracion_v1 CHECK (duracion_minutos = 60),
  CONSTRAINT chk_turno_agenda_no_self_link CHECK (agenda_principal_id IS NULL OR agenda_principal_id <> id)
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
  CONSTRAINT chk_turno_disp_rango CHECK (hora_fin <> hora_inicio)
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
  CONSTRAINT chk_turno_bloqueo_rango CHECK (hora_fin <> hora_inicio)
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
  sena_monto NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'reservado',
  comprobante_id UUID REFERENCES public.comprobante(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
  cancelado_at TIMESTAMPTZ,
  cancelado_por UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
  CONSTRAINT chk_turno_reserva_nombre CHECK (length(btrim(nombre)) > 0),
  CONSTRAINT chk_turno_reserva_precio CHECK (precio_snapshot >= 0),
  CONSTRAINT chk_turno_reserva_rango CHECK (hora_fin <> hora_inicio),
  CONSTRAINT chk_turno_reserva_estado CHECK (estado IN ('reservado', 'cobrando', 'cobrado', 'cancelado')),
  CONSTRAINT chk_turno_reserva_sena_monto CHECK (sena_monto >= 0 AND sena_monto <= precio_snapshot)
);

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_turno_reserva_slot_activo
  ON public.turno_reserva (agenda_id, fecha, hora_inicio)
  WHERE estado IN ('reservado', 'cobrando', 'cobrado');

CREATE UNIQUE INDEX IF NOT EXISTS uq_turno_reserva_fija_slot_activo
  ON public.turno_reserva_fija (agenda_id, dia_semana, hora_inicio)
  WHERE activa = TRUE;

CREATE INDEX IF NOT EXISTS idx_turno_agenda_tenant_sucursal
  ON public.turno_agenda (tenant_id, sucursal_id, activa);
CREATE INDEX IF NOT EXISTS idx_turno_agenda_principal
  ON public.turno_agenda (agenda_principal_id) WHERE agenda_principal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_turno_disp_agenda_dia
  ON public.turno_agenda_disponibilidad (agenda_id, dia_semana, hora_inicio);
CREATE INDEX IF NOT EXISTS idx_turno_bloqueo_agenda_fecha
  ON public.turno_bloqueo (agenda_id, fecha, hora_inicio);
CREATE INDEX IF NOT EXISTS idx_turno_reserva_agenda_fecha
  ON public.turno_reserva (agenda_id, fecha, hora_inicio);
CREATE INDEX IF NOT EXISTS idx_turno_reserva_fija_agenda_dia
  ON public.turno_reserva_fija (agenda_id, dia_semana, hora_inicio) WHERE activa = TRUE;
CREATE INDEX IF NOT EXISTS idx_turno_reserva_fija_tenant_sucursal
  ON public.turno_reserva_fija (tenant_id, sucursal_id, activa);
CREATE INDEX IF NOT EXISTS idx_turno_extra_agenda_dia
  ON public.turno_agenda_extra_horario (agenda_id, dia_semana, hora_inicio) WHERE activa = TRUE;

DROP TRIGGER IF EXISTS set_turno_agenda_updated_at ON public.turno_agenda;
CREATE TRIGGER set_turno_agenda_updated_at
  BEFORE UPDATE ON public.turno_agenda
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

DROP TRIGGER IF EXISTS set_turno_reserva_updated_at ON public.turno_reserva;
CREATE TRIGGER set_turno_reserva_updated_at
  BEFORE UPDATE ON public.turno_reserva
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

DROP TRIGGER IF EXISTS set_turno_reserva_fija_updated_at ON public.turno_reserva_fija;
CREATE TRIGGER set_turno_reserva_fija_updated_at
  BEFORE UPDATE ON public.turno_reserva_fija
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');

DROP TRIGGER IF EXISTS set_turno_extra_horario_updated_at ON public.turno_agenda_extra_horario;
CREATE TRIGGER set_turno_extra_horario_updated_at
  BEFORE UPDATE ON public.turno_agenda_extra_horario
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TRIGGER IF EXISTS set_turno_extra_horario_updated_at ON public.turno_agenda_extra_horario;
DROP TRIGGER IF EXISTS set_turno_reserva_fija_updated_at ON public.turno_reserva_fija;
DROP TRIGGER IF EXISTS set_turno_reserva_updated_at ON public.turno_reserva;
DROP TRIGGER IF EXISTS set_turno_agenda_updated_at ON public.turno_agenda;

DROP TABLE IF EXISTS public.turno_agenda_extra_horario;
DROP TABLE IF EXISTS public.turno_reserva_fija;
DROP TABLE IF EXISTS public.turno_reserva;
DROP TABLE IF EXISTS public.turno_bloqueo;
DROP TABLE IF EXISTS public.turno_agenda_disponibilidad;
DROP TABLE IF EXISTS public.turno_agenda;

ALTER TABLE public.producto DROP COLUMN IF EXISTS es_servicio;

ALTER TABLE public.modulo_config DROP CONSTRAINT IF EXISTS chk_turnos_requiere_facturador;
ALTER TABLE public.modulo_config DROP COLUMN IF EXISTS turnos;
`);
  }
}
