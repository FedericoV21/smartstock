import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-CAJA-001: caja POS, turnos, apertura, cierre Z + columnas comprobante.
 * Port de 108_caja_por_usuario_fase1, 058/059/061 cierre_z, 060 caja_apertura, 072 sucursal.
 */
export class NbCaja001PosCajaSchema1749800000000 implements MigrationInterface {
  name = 'NbCaja001PosCajaSchema1749800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.caja (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal(id) ON DELETE RESTRICT,
  numero INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  usuario_default_id UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
  activa BOOLEAN NOT NULL DEFAULT true,
  auto_cierre_horas INTEGER NULL,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uk_caja_numero_sucursal UNIQUE (sucursal_id, numero),
  CONSTRAINT chk_caja_numero_positivo CHECK (numero > 0),
  CONSTRAINT chk_caja_auto_cierre_horas_rango CHECK (
    auto_cierre_horas IS NULL OR (auto_cierre_horas >= 1 AND auto_cierre_horas <= 168)
  )
);

CREATE INDEX IF NOT EXISTS idx_caja_tenant ON public.caja (tenant_id);
CREATE INDEX IF NOT EXISTS idx_caja_sucursal ON public.caja (sucursal_id);

DROP TRIGGER IF EXISTS set_caja_updated_at ON public.caja;
CREATE TRIGGER set_caja_updated_at
  BEFORE UPDATE ON public.caja
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.caja_usuario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  caja_id UUID NOT NULL REFERENCES public.caja(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.usuario(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uk_caja_usuario UNIQUE (caja_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_caja_usuario_tenant ON public.caja_usuario (tenant_id);
CREATE INDEX IF NOT EXISTS idx_caja_usuario_usuario ON public.caja_usuario (usuario_id);

CREATE TABLE IF NOT EXISTS public.caja_apertura (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal(id) ON DELETE RESTRICT,
  caja_id TEXT NOT NULL DEFAULT '__sin_caja__',
  fecha_operativa DATE NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fondo_efectivo NUMERIC(18, 6) NOT NULL,
  notas TEXT,
  usuario_id UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_caja_apertura_fondo CHECK (fondo_efectivo >= 0)
);

CREATE INDEX IF NOT EXISTS idx_caja_apertura_tenant_caja_opened
  ON public.caja_apertura (tenant_id, caja_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_caja_apertura_tenant_sucursal_fecha
  ON public.caja_apertura (tenant_id, sucursal_id, fecha_operativa DESC, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.cierre_z (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal(id) ON DELETE RESTRICT,
  caja_id TEXT NOT NULL DEFAULT '__sin_caja__',
  fecha_operativa DATE NOT NULL,
  caja_apertura_id UUID REFERENCES public.caja_apertura(id) ON DELETE SET NULL,
  tipo_cierre TEXT NOT NULL DEFAULT 'diario',
  rango_desde TIMESTAMPTZ NOT NULL,
  rango_hasta TIMESTAMPTZ NOT NULL,
  total_comprobantes INTEGER NOT NULL DEFAULT 0,
  ventas_brutas NUMERIC(18, 6) NOT NULL DEFAULT 0,
  notas_credito_total NUMERIC(18, 6) NOT NULL DEFAULT 0,
  ventas_netas NUMERIC(18, 6) NOT NULL DEFAULT 0,
  pagos_cta_cte_total NUMERIC(18, 6) NOT NULL DEFAULT 0,
  usuario_cierre_id UUID REFERENCES public.usuario(id) ON DELETE SET NULL,
  payload_resumen JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cierre_z_tipo CHECK (tipo_cierre IN ('diario', 'parcial')),
  CONSTRAINT chk_cierre_z_rango CHECK (rango_hasta >= rango_desde)
);

CREATE INDEX IF NOT EXISTS idx_cierre_z_tenant_fecha
  ON public.cierre_z (tenant_id, fecha_operativa DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cierre_z_tenant_sucursal_fecha
  ON public.cierre_z (tenant_id, sucursal_id, fecha_operativa DESC, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cierre_z_diario_por_apertura
  ON public.cierre_z (caja_apertura_id)
  WHERE tipo_cierre = 'diario' AND caja_apertura_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cierre_z_parcial_rango
  ON public.cierre_z (tenant_id, caja_id, tipo_cierre, rango_desde, rango_hasta)
  WHERE tipo_cierre = 'parcial';

CREATE TABLE IF NOT EXISTS public.cierre_z_medio_pago (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  cierre_z_id UUID NOT NULL REFERENCES public.cierre_z(id) ON DELETE CASCADE,
  metodo_pago TEXT NOT NULL,
  monto_neto NUMERIC(18, 6) NOT NULL DEFAULT 0,
  cantidad_comprobantes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_cierre_z_medio_pago UNIQUE (cierre_z_id, metodo_pago)
);

CREATE INDEX IF NOT EXISTS idx_cierre_z_medio_tenant
  ON public.cierre_z_medio_pago (tenant_id, cierre_z_id);

CREATE TABLE IF NOT EXISTS public.caja_turno (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  caja_id UUID NOT NULL REFERENCES public.caja(id) ON DELETE RESTRICT,
  usuario_id UUID NOT NULL REFERENCES public.usuario(id) ON DELETE RESTRICT,
  estado TEXT NOT NULL CHECK (estado IN ('abierto', 'cerrado')),
  abierto_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_at TIMESTAMPTZ,
  monto_inicial NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monto_inicial >= 0),
  cierre_z_id UUID REFERENCES public.cierre_z(id) ON DELETE SET NULL,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caja_turno_tenant ON public.caja_turno (tenant_id);
CREATE INDEX IF NOT EXISTS idx_caja_turno_caja ON public.caja_turno (caja_id);
CREATE INDEX IF NOT EXISTS idx_caja_turno_usuario ON public.caja_turno (usuario_id);
CREATE INDEX IF NOT EXISTS idx_caja_turno_abierto_at ON public.caja_turno (abierto_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uk_caja_turno_usuario_abierto
  ON public.caja_turno (tenant_id, usuario_id)
  WHERE estado = 'abierto';

CREATE UNIQUE INDEX IF NOT EXISTS uk_caja_turno_caja_abierto
  ON public.caja_turno (tenant_id, caja_id)
  WHERE estado = 'abierto';

DROP TRIGGER IF EXISTS set_caja_turno_updated_at ON public.caja_turno;
CREATE TRIGGER set_caja_turno_updated_at
  BEFORE UPDATE ON public.caja_turno
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS caja_uuid UUID REFERENCES public.caja(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS caja_turno_id UUID REFERENCES public.caja_turno(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS numero_caja INTEGER;

CREATE INDEX IF NOT EXISTS idx_comprobante_caja_uuid ON public.comprobante (caja_uuid)
  WHERE caja_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comprobante_caja_turno ON public.comprobante (caja_turno_id)
  WHERE caja_turno_id IS NOT NULL;

INSERT INTO public.caja (tenant_id, sucursal_id, numero, nombre)
SELECT s.tenant_id, s.id, 1, 'Caja general'
FROM public.sucursal s
WHERE NOT EXISTS (
  SELECT 1 FROM public.caja c WHERE c.sucursal_id = s.id
);

UPDATE public.comprobante c
SET
  caja_uuid = (
    SELECT ca.id FROM public.caja ca
    WHERE ca.sucursal_id = c.sucursal_id AND ca.numero = 1
    LIMIT 1
  ),
  numero_caja = c.numero
WHERE c.tipo = 'ticket'::public.tipo_comprobante
  AND c.caja_uuid IS NULL
  AND c.numero IS NOT NULL;

ALTER TABLE public.comprobante
  DROP CONSTRAINT IF EXISTS chk_ticket_numero_caja;

ALTER TABLE public.comprobante
  ADD CONSTRAINT chk_ticket_numero_caja CHECK (
    NOT (tipo = 'ticket'::public.tipo_comprobante AND caja_uuid IS NOT NULL)
    OR numero_caja IS NOT NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS uk_comprobante_ticket_caja_numero
  ON public.comprobante (caja_uuid, numero_caja)
  WHERE tipo = 'ticket'::public.tipo_comprobante
    AND caja_uuid IS NOT NULL
    AND numero_caja IS NOT NULL;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP INDEX IF EXISTS public.uk_comprobante_ticket_caja_numero;
ALTER TABLE public.comprobante DROP CONSTRAINT IF EXISTS chk_ticket_numero_caja;
ALTER TABLE public.comprobante
  DROP COLUMN IF EXISTS numero_caja,
  DROP COLUMN IF EXISTS caja_turno_id,
  DROP COLUMN IF EXISTS caja_uuid;

DROP TRIGGER IF EXISTS set_caja_turno_updated_at ON public.caja_turno;
DROP TABLE IF EXISTS public.caja_turno;

DROP TABLE IF EXISTS public.cierre_z_medio_pago;
DROP TABLE IF EXISTS public.cierre_z;
DROP TABLE IF EXISTS public.caja_apertura;
DROP TABLE IF EXISTS public.caja_usuario;

DROP TRIGGER IF EXISTS set_caja_updated_at ON public.caja;
DROP TABLE IF EXISTS public.caja;
`);
  }
}
