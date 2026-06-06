import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-SCH-001 / NB-SCH-003: tenant extendido, modulo_config, categoria, proveedor, cliente.
 * Alineado con docs/base-de-datos.md (bloque core Supabase).
 */
export class NbSch001BusinessCatalogSchema1747000000000 implements MigrationInterface {
  name = 'NbSch001BusinessCatalogSchema1747000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'condicion_iva') THEN
    CREATE TYPE public.condicion_iva AS ENUM (
      'responsable_inscripto',
      'monotributista',
      'exento',
      'consumidor_final'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_tipo') THEN
    CREATE TYPE public.plan_tipo AS ENUM ('plan0', 'base', 'intermedio', 'completo');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rol_usuario') THEN
    CREATE TYPE public.rol_usuario AS ENUM ('admin', 'operador', 'visor');
  END IF;
END;
$mig$;
`);

    await queryRunner.query(`
ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS domicilio text,
  ADD COLUMN IF NOT EXISTS telefono varchar(32),
  ADD COLUMN IF NOT EXISTS email varchar(255),
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS punto_de_venta integer,
  ADD COLUMN IF NOT EXISTS condicion_iva public.condicion_iva,
  ADD COLUMN IF NOT EXISTS plan public.plan_tipo NOT NULL DEFAULT 'base';
`);

    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.modulo_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  stock boolean NOT NULL DEFAULT true,
  importador_excel boolean NOT NULL DEFAULT true,
  facturador_simple boolean NOT NULL DEFAULT false,
  facturador_arca boolean NOT NULL DEFAULT false,
  facturador_pos boolean NOT NULL DEFAULT false,
  pedidos boolean NOT NULL DEFAULT false,
  presupuestos boolean NOT NULL DEFAULT false,
  ia_precios boolean NOT NULL DEFAULT false,
  analizador_rentabilidad boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_modulo_config_tenant UNIQUE (tenant_id),
  CONSTRAINT chk_modulo_config_pos_requiere_facturador
    CHECK (facturador_pos = false OR facturador_simple = true)
);

CREATE TRIGGER modulo_config_set_updated_at
  BEFORE UPDATE ON public.modulo_config
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();
`);

    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.categoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  nombre text NOT NULL,
  descripcion text,
  activa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categoria_tenant_nombre
  ON public.categoria (tenant_id, nombre);
`);

    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.proveedor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  nombre text NOT NULL,
  cuit varchar(13),
  telefono varchar(32),
  email varchar(255),
  direccion text,
  notas text,
  mapeo_excel jsonb,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proveedor_tenant_nombre
  ON public.proveedor (tenant_id, nombre);

CREATE TRIGGER proveedor_set_updated_at
  BEFORE UPDATE ON public.proveedor
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();
`);

    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.cliente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  nombre text NOT NULL,
  razon_social text,
  cuit_dni varchar(20),
  condicion_iva public.condicion_iva,
  direccion text,
  telefono varchar(32),
  email varchar(255),
  notas text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cliente_tenant_nombre
  ON public.cliente (tenant_id, nombre);

CREATE TRIGGER cliente_set_updated_at
  BEFORE UPDATE ON public.cliente
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();
`);

    await queryRunner.query(`
DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_producto_categoria'
  ) THEN
    ALTER TABLE public.producto
      ADD CONSTRAINT fk_producto_categoria
      FOREIGN KEY (categoria_id) REFERENCES public.categoria (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_producto_proveedor'
  ) THEN
    ALTER TABLE public.producto
      ADD CONSTRAINT fk_producto_proveedor
      FOREIGN KEY (proveedor_id) REFERENCES public.proveedor (id) ON DELETE SET NULL;
  END IF;
END;
$fk$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.producto DROP CONSTRAINT IF EXISTS fk_producto_proveedor;
ALTER TABLE public.producto DROP CONSTRAINT IF EXISTS fk_producto_categoria;
DROP TABLE IF EXISTS public.cliente CASCADE;
DROP TABLE IF EXISTS public.proveedor CASCADE;
DROP TABLE IF EXISTS public.categoria CASCADE;
DROP TABLE IF EXISTS public.modulo_config CASCADE;
ALTER TABLE public.tenant
  DROP COLUMN IF EXISTS plan,
  DROP COLUMN IF EXISTS condicion_iva,
  DROP COLUMN IF EXISTS punto_de_venta,
  DROP COLUMN IF EXISTS logo_url,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS telefono,
  DROP COLUMN IF EXISTS domicilio;
DROP TYPE IF EXISTS public.rol_usuario CASCADE;
DROP TYPE IF EXISTS public.plan_tipo CASCADE;
DROP TYPE IF EXISTS public.condicion_iva CASCADE;
`);
  }
}
