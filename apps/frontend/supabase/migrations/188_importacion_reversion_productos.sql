-- Trazabilidad para revertir cargas hechas desde /importar.

ALTER TABLE public.importacion_log
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'importacion_log'
      AND policyname = 'tenant_update_importacion'
  ) THEN
    CREATE POLICY tenant_update_importacion
      ON public.importacion_log FOR UPDATE
      USING (tenant_id = public.current_tenant_id())
      WITH CHECK (tenant_id = public.current_tenant_id());
  END IF;
END
$$;

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

COMMENT ON TABLE public.importacion_producto_snapshot IS
  'Snapshot de productos tocados por /importar. Permite revertir una carga sin inferir por nombre/codigo.';

ALTER TABLE public.importacion_producto_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_importacion_producto_snapshot
  ON public.importacion_producto_snapshot FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_importacion_producto_snapshot
  ON public.importacion_producto_snapshot FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_importacion_producto_snapshot
  ON public.importacion_producto_snapshot FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_importacion_producto_snapshot
  ON public.importacion_producto_snapshot FOR DELETE
  USING (tenant_id = public.current_tenant_id());

GRANT ALL ON TABLE public.importacion_producto_snapshot TO anon;
GRANT ALL ON TABLE public.importacion_producto_snapshot TO authenticated;
GRANT ALL ON TABLE public.importacion_producto_snapshot TO service_role;
