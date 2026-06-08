-- Historial de importaciones: sucursal, agrupación por carga y archivo en Storage (listas-precios).

ALTER TABLE public.importacion_log
  ADD COLUMN IF NOT EXISTS sucursal_id uuid REFERENCES public.sucursal (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS carga_id uuid,
  ADD COLUMN IF NOT EXISTS archivo_storage_path text,
  ADD COLUMN IF NOT EXISTS archivo_mime text,
  ADD COLUMN IF NOT EXISTS archivo_tamano bigint;

CREATE INDEX IF NOT EXISTS idx_importacion_log_tenant_carga
  ON public.importacion_log (tenant_id, carga_id)
  WHERE carga_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_importacion_log_tenant_sucursal_fecha
  ON public.importacion_log (tenant_id, sucursal_id, created_at DESC);
