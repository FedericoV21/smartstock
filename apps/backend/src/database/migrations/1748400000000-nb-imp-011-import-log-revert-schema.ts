import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-IMP-011: columnas extendidas en importacion_log + snapshots para revertir cargas.
 */
export class NbImp011ImportLogRevertSchema1748400000000 implements MigrationInterface {
  name = 'NbImp011ImportLogRevertSchema1748400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.importacion_log
  ADD COLUMN IF NOT EXISTS sucursal_id uuid REFERENCES public.sucursal (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS carga_id uuid,
  ADD COLUMN IF NOT EXISTS archivo_storage_path text,
  ADD COLUMN IF NOT EXISTS archivo_mime text,
  ADD COLUMN IF NOT EXISTS archivo_tamano bigint,
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'aplicada',
  ADD COLUMN IF NOT EXISTS revertida_at timestamptz,
  ADD COLUMN IF NOT EXISTS revertida_por uuid REFERENCES public.usuario (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_reversion text,
  ADD COLUMN IF NOT EXISTS resumen_reversion jsonb;

ALTER TABLE public.importacion_log
  DROP CONSTRAINT IF EXISTS chk_importacion_log_estado;

ALTER TABLE public.importacion_log
  ADD CONSTRAINT chk_importacion_log_estado
  CHECK (estado IN ('aplicada', 'revertida'));

CREATE INDEX IF NOT EXISTS idx_importacion_log_tenant_carga
  ON public.importacion_log (tenant_id, carga_id)
  WHERE carga_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_importacion_log_tenant_sucursal_fecha
  ON public.importacion_log (tenant_id, sucursal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.importacion_producto_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  importacion_log_id uuid NOT NULL REFERENCES public.importacion_log (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL,
  accion text NOT NULL,
  fila_original integer,
  producto_before jsonb,
  producto_after jsonb NOT NULL,
  precio_sucursal_before jsonb,
  precio_sucursal_after jsonb,
  movimiento_id uuid REFERENCES public.movimiento (id) ON DELETE SET NULL,
  producto_variante_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_importacion_producto_snapshot_accion
    CHECK (accion IN ('created', 'updated'))
);

CREATE INDEX IF NOT EXISTS idx_importacion_producto_snapshot_log
  ON public.importacion_producto_snapshot (tenant_id, importacion_log_id);

CREATE INDEX IF NOT EXISTS idx_importacion_producto_snapshot_producto
  ON public.importacion_producto_snapshot (tenant_id, producto_id);

CREATE INDEX IF NOT EXISTS idx_importacion_producto_snapshot_created
  ON public.importacion_producto_snapshot (tenant_id, created_at DESC);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.importacion_producto_snapshot CASCADE;

ALTER TABLE public.importacion_log
  DROP CONSTRAINT IF EXISTS chk_importacion_log_estado;

DROP INDEX IF EXISTS idx_importacion_log_tenant_carga;
DROP INDEX IF EXISTS idx_importacion_log_tenant_sucursal_fecha;

ALTER TABLE public.importacion_log
  DROP COLUMN IF EXISTS resumen_reversion,
  DROP COLUMN IF EXISTS motivo_reversion,
  DROP COLUMN IF EXISTS revertida_por,
  DROP COLUMN IF EXISTS revertida_at,
  DROP COLUMN IF EXISTS estado,
  DROP COLUMN IF EXISTS archivo_tamano,
  DROP COLUMN IF EXISTS archivo_mime,
  DROP COLUMN IF EXISTS archivo_storage_path,
  DROP COLUMN IF EXISTS carga_id,
  DROP COLUMN IF EXISTS sucursal_id;
`);
  }
}
