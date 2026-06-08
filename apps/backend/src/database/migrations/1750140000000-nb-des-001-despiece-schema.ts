import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-DES-001: despiece carnicería (plantillas, cortes, módulo y producto padre).
 * Paridad Supabase 136, 137, 138, 147, 151, 185.
 */
export class NbDes001DespieceSchema1750140000000 implements MigrationInterface {
  name = 'NbDes001DespieceSchema1750140000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.despiece_plantilla (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  producto_padre_id UUID REFERENCES public.producto(id) ON DELETE RESTRICT,
  peso_total_kg NUMERIC(10,3) NOT NULL CHECK (peso_total_kg > 0),
  rentabilidad_objetivo_pct NUMERIC(6,2),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_despiece_plantilla_tenant
  ON public.despiece_plantilla(tenant_id);

DROP INDEX IF EXISTS public.idx_despiece_plantilla_padre;
CREATE UNIQUE INDEX IF NOT EXISTS idx_despiece_plantilla_tenant_padre_nombre
  ON public.despiece_plantilla(tenant_id, producto_padre_id, nombre)
  WHERE producto_padre_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_despiece_plantilla_tenant_nombre_sin_padre
  ON public.despiece_plantilla(tenant_id, nombre)
  WHERE producto_padre_id IS NULL;

ALTER TABLE public.despiece_plantilla
  ADD COLUMN IF NOT EXISTS unidad_base_tipo TEXT NOT NULL DEFAULT 'kg',
  ADD COLUMN IF NOT EXISTS unidad_base_nombre TEXT,
  ADD COLUMN IF NOT EXISTS unidad_base_cantidad NUMERIC(10,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unidad_contenedor_nombre TEXT,
  ADD COLUMN IF NOT EXISTS unidad_contenedor_cantidad NUMERIC(10,3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_despiece_plantilla_unidad_base_tipo'
      AND conrelid = 'public.despiece_plantilla'::regclass
  ) THEN
    ALTER TABLE public.despiece_plantilla
      ADD CONSTRAINT chk_despiece_plantilla_unidad_base_tipo
      CHECK (unidad_base_tipo IN ('kg', 'unidad'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_despiece_plantilla_unidad_base_cantidad'
      AND conrelid = 'public.despiece_plantilla'::regclass
  ) THEN
    ALTER TABLE public.despiece_plantilla
      ADD CONSTRAINT chk_despiece_plantilla_unidad_base_cantidad
      CHECK (unidad_base_cantidad > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_despiece_plantilla_unidad_contenedor_cantidad'
      AND conrelid = 'public.despiece_plantilla'::regclass
  ) THEN
    ALTER TABLE public.despiece_plantilla
      ADD CONSTRAINT chk_despiece_plantilla_unidad_contenedor_cantidad
      CHECK (unidad_contenedor_cantidad IS NULL OR unidad_contenedor_cantidad > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.despiece_corte (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  plantilla_id UUID NOT NULL REFERENCES public.despiece_plantilla(id) ON DELETE CASCADE,
  producto_hijo_id UUID NOT NULL REFERENCES public.producto(id) ON DELETE RESTRICT,
  kg_rendimiento NUMERIC(10,3) NOT NULL CHECK (kg_rendimiento >= 0),
  factor_ajuste_pct NUMERIC(12,10) NOT NULL DEFAULT 0,
  precio_anclado NUMERIC(12,2),
  peso_promedio_unidad_kg NUMERIC(10,3),
  orden INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_despiece_corte_peso_unidad
    CHECK (peso_promedio_unidad_kg IS NULL OR peso_promedio_unidad_kg > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_despiece_corte_unico
  ON public.despiece_corte(plantilla_id, producto_hijo_id);
CREATE INDEX IF NOT EXISTS idx_despiece_corte_tenant
  ON public.despiece_corte(tenant_id);
CREATE INDEX IF NOT EXISTS idx_despiece_corte_plantilla
  ON public.despiece_corte(plantilla_id, orden);

ALTER TABLE public.despiece_corte
  ADD COLUMN IF NOT EXISTS nombre_en_plantilla TEXT,
  ADD COLUMN IF NOT EXISTS plu_sugerido VARCHAR(5);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_despiece_corte_plu_sugerido'
      AND conrelid = 'public.despiece_corte'::regclass
  ) THEN
    ALTER TABLE public.despiece_corte
      ADD CONSTRAINT chk_despiece_corte_plu_sugerido
      CHECK (plu_sugerido IS NULL OR plu_sugerido ~ '^[0-9]{5}$');
  END IF;
END $$;

ALTER TABLE public.modulo_config
  ADD COLUMN IF NOT EXISTS despiece_carniceria BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.producto
  ADD COLUMN IF NOT EXISTS es_despiece_padre BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_producto_es_despiece_padre
  ON public.producto(tenant_id)
  WHERE es_despiece_padre = TRUE;

ALTER TYPE public.origen_precio ADD VALUE IF NOT EXISTS 'despiece';

DROP TRIGGER IF EXISTS set_despiece_plantilla_updated_at ON public.despiece_plantilla;
CREATE TRIGGER set_despiece_plantilla_updated_at
  BEFORE UPDATE ON public.despiece_plantilla
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime(updated_at);

DROP TRIGGER IF EXISTS set_despiece_corte_updated_at ON public.despiece_corte;
CREATE TRIGGER set_despiece_corte_updated_at
  BEFORE UPDATE ON public.despiece_corte
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime(updated_at);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TRIGGER IF EXISTS set_despiece_corte_updated_at ON public.despiece_corte;
DROP TRIGGER IF EXISTS set_despiece_plantilla_updated_at ON public.despiece_plantilla;
DROP TABLE IF EXISTS public.despiece_corte CASCADE;
DROP TABLE IF EXISTS public.despiece_plantilla CASCADE;
ALTER TABLE public.modulo_config DROP COLUMN IF EXISTS despiece_carniceria;
ALTER TABLE public.producto DROP COLUMN IF EXISTS es_despiece_padre;
`);
  }
}
