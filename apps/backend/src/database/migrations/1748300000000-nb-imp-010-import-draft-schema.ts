import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-IMP-010: borradores de importaci├│n (metadata, chunks, archivo) + importacion_archivo para confirmaci├│n.
 */
export class NbImp010ImportDraftSchema1748300000000 implements MigrationInterface {
  name = 'NbImp010ImportDraftSchema1748300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
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

DROP TRIGGER IF EXISTS set_importacion_borrador_updated_at ON public.importacion_borrador;
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

DROP TRIGGER IF EXISTS set_importacion_borrador_chunk_updated_at ON public.importacion_borrador_chunk;
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

DROP TRIGGER IF EXISTS set_importacion_borrador_archivo_updated_at ON public.importacion_borrador_archivo;
CREATE TRIGGER set_importacion_borrador_archivo_updated_at
  BEFORE UPDATE ON public.importacion_borrador_archivo
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime(updated_at);

CREATE TABLE IF NOT EXISTS public.importacion_archivo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  carga_id uuid NOT NULL,
  archivo_nombre text NOT NULL,
  archivo_mime text,
  archivo_bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_importacion_archivo_tenant_carga UNIQUE (tenant_id, carga_id)
);

CREATE INDEX IF NOT EXISTS idx_importacion_archivo_tenant_creado
  ON public.importacion_archivo (tenant_id, created_at DESC);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.importacion_archivo CASCADE;
DROP TABLE IF EXISTS public.importacion_borrador_archivo CASCADE;
DROP TABLE IF EXISTS public.importacion_borrador_chunk CASCADE;
DROP TABLE IF EXISTS public.importacion_borrador CASCADE;
`);
  }
}
