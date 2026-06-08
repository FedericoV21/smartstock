-- Copia del archivo de importación (Excel/CSV) en Postgres, una fila por carga (tenant + carga_id).

CREATE TABLE public.importacion_archivo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  carga_id uuid NOT NULL,
  archivo_nombre text NOT NULL,
  archivo_mime text,
  archivo_bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_importacion_archivo_tenant_carga UNIQUE (tenant_id, carga_id)
);

CREATE INDEX idx_importacion_archivo_tenant_creado
  ON public.importacion_archivo (tenant_id, created_at DESC);

ALTER TABLE public.importacion_archivo ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_importacion_archivo
  ON public.importacion_archivo FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_importacion_archivo
  ON public.importacion_archivo FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_importacion_archivo
  ON public.importacion_archivo FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_importacion_archivo
  ON public.importacion_archivo FOR DELETE
  USING (tenant_id = public.current_tenant_id());
