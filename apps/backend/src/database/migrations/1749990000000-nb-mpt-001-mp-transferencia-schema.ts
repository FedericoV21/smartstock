import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-MPT-001: conciliación transferencias MP (movimientos + verificaciones).
 */
export class NbMpt001MpTransferenciaSchema1749990000000 implements MigrationInterface {
  name = 'NbMpt001MpTransferenciaSchema1749990000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TYPE public.estado_comprobante ADD VALUE IF NOT EXISTS 'pendiente_transferencia_mp';

ALTER TABLE public.mp_qr_config
  ADD COLUMN IF NOT EXISTS transferencia_habilitada boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.mp_qr_config.transferencia_habilitada IS
  'Habilita verificador de transferencias CVU/alias usando el access_token MP QR de la sucursal.';

CREATE TABLE IF NOT EXISTS public.mp_transferencia_reporte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE CASCADE,
  fecha date NOT NULL,
  begin_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'solicitado',
  mp_report_id text,
  file_name text,
  raw_response jsonb,
  ultimo_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_mp_transferencia_reporte_estado CHECK (
    estado IN ('solicitado', 'listo', 'descargado', 'error')
  ),
  CONSTRAINT uq_mp_transferencia_reporte_dia UNIQUE (tenant_id, sucursal_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_mp_transferencia_reporte_estado
  ON public.mp_transferencia_reporte (tenant_id, sucursal_id, estado, fecha DESC);

CREATE TRIGGER mp_transferencia_reporte_set_updated_at
  BEFORE UPDATE ON public.mp_transferencia_reporte
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.mp_transferencia_movimiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE CASCADE,
  reporte_id uuid REFERENCES public.mp_transferencia_reporte (id) ON DELETE SET NULL,
  mp_movimiento_id text NOT NULL,
  fecha_operacion date NOT NULL,
  fecha_hora timestamptz,
  monto numeric(18, 2) NOT NULL,
  moneda text NOT NULL DEFAULT 'ARS',
  transaction_type text,
  payment_type text,
  descripcion text,
  contraparte text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_mp_transferencia_movimiento_monto CHECK (monto > 0),
  CONSTRAINT uq_mp_transferencia_movimiento_mp_id UNIQUE (tenant_id, mp_movimiento_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_transferencia_movimiento_match
  ON public.mp_transferencia_movimiento (tenant_id, sucursal_id, fecha_operacion, monto);

CREATE TRIGGER mp_transferencia_movimiento_set_updated_at
  BEFORE UPDATE ON public.mp_transferencia_movimiento
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.mp_transferencia_verificacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE CASCADE,
  comprobante_id uuid NOT NULL REFERENCES public.comprobante (id) ON DELETE CASCADE,
  movimiento_id uuid REFERENCES public.mp_transferencia_movimiento (id) ON DELETE SET NULL,
  mp_movimiento_id text NOT NULL,
  monto numeric(18, 2) NOT NULL,
  fecha_operacion date NOT NULL,
  usuario_id uuid REFERENCES public.usuario (id) ON DELETE SET NULL,
  estado text NOT NULL DEFAULT 'reservado',
  verificado_at timestamptz,
  ultimo_error text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_mp_transferencia_verificacion_estado CHECK (
    estado IN ('reservado', 'verificado', 'error')
  ),
  CONSTRAINT uq_mp_transferencia_verificacion_mp_id UNIQUE (tenant_id, mp_movimiento_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mp_transferencia_verificacion_comprobante_activa
  ON public.mp_transferencia_verificacion (comprobante_id)
  WHERE estado IN ('reservado', 'verificado');

CREATE INDEX IF NOT EXISTS idx_mp_transferencia_verificacion_tenant
  ON public.mp_transferencia_verificacion (tenant_id, sucursal_id, created_at DESC);

CREATE TRIGGER mp_transferencia_verificacion_set_updated_at
  BEFORE UPDATE ON public.mp_transferencia_verificacion
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TRIGGER IF EXISTS mp_transferencia_verificacion_set_updated_at ON public.mp_transferencia_verificacion;
DROP TABLE IF EXISTS public.mp_transferencia_verificacion CASCADE;

DROP TRIGGER IF EXISTS mp_transferencia_movimiento_set_updated_at ON public.mp_transferencia_movimiento;
DROP TABLE IF EXISTS public.mp_transferencia_movimiento CASCADE;

DROP TRIGGER IF EXISTS mp_transferencia_reporte_set_updated_at ON public.mp_transferencia_reporte;
DROP TABLE IF EXISTS public.mp_transferencia_reporte CASCADE;

ALTER TABLE public.mp_qr_config DROP COLUMN IF EXISTS transferencia_habilitada;
`);
  }
}
