import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-SUC-001: tabla sucursal (multi-sucursal por tenant).
 * Alineado con apps/frontend/supabase/migrations/068 + 079.
 */
export class NbSuc001SucursalSchema1747100000000 implements MigrationInterface {
  name = 'NbSuc001SucursalSchema1747100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  codigo text NOT NULL,
  nombre text NOT NULL,
  direccion text,
  activa boolean NOT NULL DEFAULT true,
  es_principal boolean NOT NULL DEFAULT false,
  hereda_datos_ticket boolean NOT NULL DEFAULT true,
  razon_social text,
  cuit text,
  telefono text,
  horarios_atencion text,
  email text,
  pos_prefs jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_sucursal_codigo_not_blank CHECK (btrim(codigo) <> ''),
  CONSTRAINT chk_sucursal_nombre_not_blank CHECK (btrim(nombre) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sucursal_tenant_codigo_unique
  ON public.sucursal (tenant_id, lower(codigo));

CREATE UNIQUE INDEX IF NOT EXISTS idx_sucursal_tenant_nombre_unique
  ON public.sucursal (tenant_id, lower(nombre));

CREATE INDEX IF NOT EXISTS idx_sucursal_tenant_activa
  ON public.sucursal (tenant_id, activa);

CREATE TRIGGER sucursal_set_updated_at
  BEFORE UPDATE ON public.sucursal
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS public.sucursal CASCADE;`);
  }
}
