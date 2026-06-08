-- Persistent drafts for product import flows (/importar and PDF a Excel).

CREATE TABLE IF NOT EXISTS public.importacion_borrador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  usuario_id uuid REFERENCES public.usuario (id) ON DELETE SET NULL,
  proveedor_id uuid REFERENCES public.proveedor (id) ON DELETE SET NULL,
  sucursal_id uuid REFERENCES public.sucursal (id) ON DELETE SET NULL,
  flujo text NOT NULL,
  paso text NOT NULL,
  origen public.origen_precio NOT NULL,
  estado text NOT NULL DEFAULT 'activo',
  archivo_nombre text NOT NULL,
  archivo_mime text,
  archivo_tamano bigint,
  total_filas integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_importacion_borrador_flujo CHECK (flujo IN ('importar', 'pdf_excel')),
  CONSTRAINT chk_importacion_borrador_paso CHECK (paso IN ('mapeo', 'preview')),
  CONSTRAINT chk_importacion_borrador_estado CHECK (estado IN ('activo', 'confirmado', 'descartado'))
);

CREATE INDEX IF NOT EXISTS idx_importacion_borrador_tenant_updated
  ON public.importacion_borrador (tenant_id, updated_at DESC)
  WHERE estado = 'activo';

CREATE INDEX IF NOT EXISTS idx_importacion_borrador_tenant_usuario
  ON public.importacion_borrador (tenant_id, usuario_id, updated_at DESC)
  WHERE estado = 'activo';

CREATE INDEX IF NOT EXISTS idx_importacion_borrador_tenant_flujo
  ON public.importacion_borrador (tenant_id, flujo, updated_at DESC)
  WHERE estado = 'activo';

CREATE TRIGGER set_importacion_borrador_updated_at
  BEFORE UPDATE ON public.importacion_borrador
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime(updated_at);

CREATE TABLE IF NOT EXISTS public.importacion_borrador_chunk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrador_id uuid NOT NULL REFERENCES public.importacion_borrador (id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  filas jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_importacion_borrador_chunk_index CHECK (chunk_index >= 0),
  CONSTRAINT uq_importacion_borrador_chunk UNIQUE (borrador_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_importacion_borrador_chunk_borrador
  ON public.importacion_borrador_chunk (borrador_id, chunk_index);

CREATE TRIGGER set_importacion_borrador_chunk_updated_at
  BEFORE UPDATE ON public.importacion_borrador_chunk
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime(updated_at);

CREATE TABLE IF NOT EXISTS public.importacion_borrador_archivo (
  borrador_id uuid PRIMARY KEY REFERENCES public.importacion_borrador (id) ON DELETE CASCADE,
  archivo_nombre text NOT NULL,
  archivo_mime text,
  archivo_tamano bigint NOT NULL DEFAULT 0,
  archivo_bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_importacion_borrador_archivo_updated_at
  BEFORE UPDATE ON public.importacion_borrador_archivo
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime(updated_at);

ALTER TABLE public.importacion_borrador ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.importacion_borrador_chunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.importacion_borrador_archivo ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_importacion_borrador
  ON public.importacion_borrador FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_importacion_borrador
  ON public.importacion_borrador FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_importacion_borrador
  ON public.importacion_borrador FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_importacion_borrador
  ON public.importacion_borrador FOR DELETE
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_select_importacion_borrador_chunk
  ON public.importacion_borrador_chunk FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.importacion_borrador b
      WHERE b.id = importacion_borrador_chunk.borrador_id
        AND b.tenant_id = public.current_tenant_id()
    )
  );

CREATE POLICY tenant_insert_importacion_borrador_chunk
  ON public.importacion_borrador_chunk FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.importacion_borrador b
      WHERE b.id = importacion_borrador_chunk.borrador_id
        AND b.tenant_id = public.current_tenant_id()
    )
  );

CREATE POLICY tenant_update_importacion_borrador_chunk
  ON public.importacion_borrador_chunk FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.importacion_borrador b
      WHERE b.id = importacion_borrador_chunk.borrador_id
        AND b.tenant_id = public.current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.importacion_borrador b
      WHERE b.id = importacion_borrador_chunk.borrador_id
        AND b.tenant_id = public.current_tenant_id()
    )
  );

CREATE POLICY tenant_delete_importacion_borrador_chunk
  ON public.importacion_borrador_chunk FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.importacion_borrador b
      WHERE b.id = importacion_borrador_chunk.borrador_id
        AND b.tenant_id = public.current_tenant_id()
    )
  );

CREATE POLICY tenant_select_importacion_borrador_archivo
  ON public.importacion_borrador_archivo FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.importacion_borrador b
      WHERE b.id = importacion_borrador_archivo.borrador_id
        AND b.tenant_id = public.current_tenant_id()
    )
  );

CREATE POLICY tenant_insert_importacion_borrador_archivo
  ON public.importacion_borrador_archivo FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.importacion_borrador b
      WHERE b.id = importacion_borrador_archivo.borrador_id
        AND b.tenant_id = public.current_tenant_id()
    )
  );

CREATE POLICY tenant_update_importacion_borrador_archivo
  ON public.importacion_borrador_archivo FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.importacion_borrador b
      WHERE b.id = importacion_borrador_archivo.borrador_id
        AND b.tenant_id = public.current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.importacion_borrador b
      WHERE b.id = importacion_borrador_archivo.borrador_id
        AND b.tenant_id = public.current_tenant_id()
    )
  );

CREATE POLICY tenant_delete_importacion_borrador_archivo
  ON public.importacion_borrador_archivo FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.importacion_borrador b
      WHERE b.id = importacion_borrador_archivo.borrador_id
        AND b.tenant_id = public.current_tenant_id()
    )
  );
