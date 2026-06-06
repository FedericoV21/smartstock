import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-ANL-001: cierre mensual cache + radar inflaci├│n cross-tenant.
 */
export class NbAnl001CierreRadarSchema1749100000000 implements MigrationInterface {
  name = 'NbAnl001CierreRadarSchema1749100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.cierre_mensual (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  periodo               TEXT NOT NULL,
  ingresos_brutos       NUMERIC(18, 6) NOT NULL DEFAULT 0,
  costo_mercaderia      NUMERIC(18, 6) NOT NULL DEFAULT 0,
  margen_bruto          NUMERIC(18, 6) NOT NULL DEFAULT 0,
  margen_bruto_pct      NUMERIC(12, 6),
  unidades_vendidas     INTEGER NOT NULL DEFAULT 0,
  comprobantes_emitidos INTEGER NOT NULL DEFAULT 0,
  ticket_promedio       NUMERIC(18, 6),
  top_productos         JSONB,
  por_categoria         JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_cierre_mensual_tenant_periodo UNIQUE (tenant_id, periodo)
);

CREATE INDEX IF NOT EXISTS idx_cierre_mensual_tenant
  ON public.cierre_mensual (tenant_id, periodo DESC);

CREATE TABLE IF NOT EXISTS public.radar_inflacion (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rubro                   TEXT NOT NULL,
  proveedor_nombre        TEXT NOT NULL,
  periodo                 TEXT NOT NULL,
  variacion_promedio_pct  NUMERIC(12, 6) NOT NULL DEFAULT 0,
  cantidad_listas         INTEGER NOT NULL DEFAULT 1,
  cantidad_items          INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_radar_rubro_proveedor_periodo UNIQUE (rubro, proveedor_nombre, periodo)
);

CREATE INDEX IF NOT EXISTS idx_radar_inflacion_periodo
  ON public.radar_inflacion (periodo DESC);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.radar_inflacion CASCADE;
DROP TABLE IF EXISTS public.cierre_mensual CASCADE;
`);
  }
}
