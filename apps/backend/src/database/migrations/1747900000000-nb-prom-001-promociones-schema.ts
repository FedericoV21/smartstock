import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-PROM-001: promociones, v├¡nculos producto, combos y alcance por sucursal.
 */
export class NbProm001PromocionesSchema1747900000000 implements MigrationInterface {
  name = 'NbProm001PromocionesSchema1747900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DO $$ BEGIN
  CREATE TYPE public.promocion_tipo AS ENUM (
    'porcentaje_off',
    'n_x_m',
    'porcentaje_unidad_n',
    'descuento_volumen',
    'combo_precio_fijo'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.promocion (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  sucursal_id       UUID NOT NULL REFERENCES public.sucursal(id) ON DELETE RESTRICT,
  nombre            TEXT NOT NULL,
  tipo              public.promocion_tipo NOT NULL,
  cantidad_lleva    INTEGER,
  cantidad_paga     INTEGER,
  unidad_descuento  INTEGER,
  porcentaje        NUMERIC(5, 2),
  cantidad_minima   INTEGER,
  rangos_volumen    JSONB,
  precio_combo      NUMERIC(14, 2),
  vigente_desde     DATE,
  vigente_hasta     DATE,
  dias_semana       INTEGER[],
  activa            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_promo_nxm_valido CHECK (
    tipo <> 'n_x_m'::public.promocion_tipo
    OR (
      cantidad_lleva IS NOT NULL
      AND cantidad_paga IS NOT NULL
      AND cantidad_lleva > cantidad_paga
      AND cantidad_paga > 0
    )
  ),
  CONSTRAINT chk_promo_porcentaje_valido CHECK (
    (
      tipo NOT IN (
        'porcentaje_off'::public.promocion_tipo,
        'porcentaje_unidad_n'::public.promocion_tipo
      )
      OR (
        porcentaje IS NOT NULL
        AND porcentaje > 0
        AND porcentaje <= 100
      )
    )
    AND (
      tipo <> 'descuento_volumen'::public.promocion_tipo
      OR (
        (
          rangos_volumen IS NOT NULL
          AND jsonb_array_length(rangos_volumen) > 0
        )
        OR (
          cantidad_minima IS NOT NULL
          AND cantidad_minima >= 2
          AND porcentaje IS NOT NULL
          AND porcentaje > 0
          AND porcentaje <= 100
        )
      )
    )
    AND (
      tipo <> 'combo_precio_fijo'::public.promocion_tipo
      OR (
        precio_combo IS NOT NULL
        AND precio_combo > 0
      )
    )
  ),
  CONSTRAINT chk_promo_vigencia CHECK (
    vigente_hasta IS NULL
    OR vigente_desde IS NULL
    OR vigente_hasta >= vigente_desde
  ),
  CONSTRAINT chk_promo_unidad_n CHECK (
    tipo <> 'porcentaje_unidad_n'::public.promocion_tipo
    OR (unidad_descuento IS NOT NULL AND unidad_descuento >= 2)
  )
);

CREATE INDEX IF NOT EXISTS idx_promocion_tenant ON public.promocion (tenant_id);
CREATE INDEX IF NOT EXISTS idx_promocion_tenant_sucursal ON public.promocion (tenant_id, sucursal_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_promocion_activa_vigente ON public.promocion (tenant_id) WHERE activa = TRUE;

DROP TRIGGER IF EXISTS promocion_set_updated_at ON public.promocion;
CREATE TRIGGER promocion_set_updated_at
  BEFORE UPDATE ON public.promocion
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.producto_promocion (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promocion_id         UUID NOT NULL REFERENCES public.promocion(id) ON DELETE CASCADE,
  producto_id          UUID NOT NULL REFERENCES public.producto(id) ON DELETE CASCADE,
  producto_variante_id UUID NULL REFERENCES public.producto_variante(id) ON DELETE CASCADE,
  tenant_id            UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_promocion_producto_total
  ON public.producto_promocion (promocion_id, producto_id)
  WHERE producto_variante_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_promocion_variante
  ON public.producto_promocion (promocion_id, producto_id, producto_variante_id)
  WHERE producto_variante_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_producto_promocion_producto ON public.producto_promocion (producto_id);
CREATE INDEX IF NOT EXISTS idx_producto_promocion_tenant ON public.producto_promocion (tenant_id);
CREATE INDEX IF NOT EXISTS idx_producto_promocion_variante
  ON public.producto_promocion (tenant_id, producto_variante_id)
  WHERE producto_variante_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.promocion_combo_item (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promocion_id         UUID NOT NULL REFERENCES public.promocion(id) ON DELETE CASCADE,
  producto_id          UUID NOT NULL REFERENCES public.producto(id) ON DELETE CASCADE,
  producto_variante_id UUID NULL REFERENCES public.producto_variante(id) ON DELETE CASCADE,
  tenant_id            UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  cantidad             NUMERIC(18, 6) NOT NULL CHECK (cantidad > 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_promocion_combo_item_producto_total
  ON public.promocion_combo_item (promocion_id, producto_id)
  WHERE producto_variante_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_promocion_combo_item_variante
  ON public.promocion_combo_item (promocion_id, producto_id, producto_variante_id)
  WHERE producto_variante_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_promocion_combo_item_tenant ON public.promocion_combo_item (tenant_id);
CREATE INDEX IF NOT EXISTS idx_promocion_combo_item_producto ON public.promocion_combo_item (producto_id);

CREATE TABLE IF NOT EXISTS public.promocion_sucursal (
  promocion_id UUID NOT NULL REFERENCES public.promocion(id) ON DELETE CASCADE,
  sucursal_id  UUID NOT NULL REFERENCES public.sucursal(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (promocion_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_promocion_sucursal_tenant_sucursal
  ON public.promocion_sucursal (tenant_id, sucursal_id, promocion_id);
CREATE INDEX IF NOT EXISTS idx_promocion_sucursal_tenant_promocion
  ON public.promocion_sucursal (tenant_id, promocion_id);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.promocion_sucursal CASCADE;
DROP TABLE IF EXISTS public.promocion_combo_item CASCADE;
DROP TABLE IF EXISTS public.producto_promocion CASCADE;
DROP TABLE IF EXISTS public.promocion CASCADE;
DROP TYPE IF EXISTS public.promocion_tipo;
`);
  }
}
