import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-baseline: esquema m├¡nimo para Nest + Postgres **sin** Supabase.
 * Cubre entidades TypeORM actuales + `arca_job`/RPC que usa el worker + `importacion_log` / `idempotency_request` usados por servicios.
 *
 * Convenci├│n local: conect├í con rol **superuser** (p. ej. `postgres`) para que RLS de migraciones posteriores no bloquee inserts de la API.
 * Las migraciones NB-BAR-002 y NB-IMP-002 se aplican despu├®s (tipos/tablas extra + pol├¡ticas).
 */
export class NbBaselineCoreSchema1742000000000 implements MigrationInterface {
  name = 'NbBaselineCoreSchema1742000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.moddatetime()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$fn$;
`);

    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $fn$
  SELECT NULL::uuid;
$fn$;
`);

    await queryRunner.query(`
CREATE TYPE public.unidad_medida AS ENUM (
  'unidad', 'kg', 'litro', 'metro', 'caja', 'pack', 'gramo', 'ml'
);

CREATE TYPE public.tipo_comprobante AS ENUM (
  'factura_a', 'factura_b', 'factura_c',
  'nota_credito_a', 'nota_credito_b', 'nota_credito_c',
  'remito', 'presupuesto', 'ticket'
);

CREATE TYPE public.estado_comprobante AS ENUM (
  'borrador', 'emitido', 'pendiente_arca', 'error_arca', 'anulado'
);

CREATE TYPE public.tipo_movimiento AS ENUM ('entrada', 'salida', 'ajuste');

CREATE TYPE public.referencia_tipo AS ENUM (
  'factura', 'pedido', 'importacion', 'manual', 'ajuste_inventario'
);

CREATE TYPE public.arca_ambiente AS ENUM ('homologacion', 'produccion');

CREATE TYPE public.estado_pedido AS ENUM (
  'borrador', 'confirmado', 'entregado', 'cancelado'
);

CREATE TYPE public.origen_precio AS ENUM (
  'manual', 'importacion_excel', 'ia_pdf', 'lista_precios'
);
`);

    await queryRunner.query(`
CREATE TABLE public.tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL DEFAULT 'Tenant',
  razon_social text,
  cuit varchar(13),
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER tenant_set_updated_at
  BEFORE UPDATE ON public.tenant
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();
`);

    await queryRunner.query(`
CREATE TABLE public.comprobante (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  tipo public.tipo_comprobante NOT NULL,
  numero integer NOT NULL,
  fecha date NOT NULL,
  cliente_id uuid,
  subtotal numeric(18,2) NOT NULL,
  iva_monto numeric(18,2) NOT NULL DEFAULT 0,
  iva_porcentaje numeric(8,2) NOT NULL DEFAULT 0,
  total numeric(18,2) NOT NULL,
  estado public.estado_comprobante NOT NULL,
  metodo_pago varchar(20),
  metodo_pago_detalle jsonb,
  caja_id varchar(20),
  cae varchar(64),
  cae_vencimiento date,
  pdf_url text,
  notas text,
  usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_comprobante_tenant_fecha ON public.comprobante (tenant_id, fecha DESC);
`);

    await queryRunner.query(`
CREATE TABLE public.producto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  codigo varchar(64) NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  categoria_id uuid,
  proveedor_id uuid,
  unidad public.unidad_medida NOT NULL,
  precio_costo numeric(14,2) NOT NULL,
  precio_venta numeric(14,2) NOT NULL,
  stock_actual numeric(12,3) NOT NULL DEFAULT 0,
  stock_minimo numeric(12,3) NOT NULL DEFAULT 0,
  codigo_barras varchar(14),
  plu varchar(5),
  es_pesable boolean NOT NULL DEFAULT false,
  fecha_vencimiento date,
  imagen_url text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_producto_tenant_codigo ON public.producto (tenant_id, codigo);

CREATE TRIGGER producto_set_updated_at
  BEFORE UPDATE ON public.producto
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();
`);

    await queryRunner.query(`
CREATE TABLE public.comprobante_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comprobante_id uuid NOT NULL REFERENCES public.comprobante (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.producto (id) ON DELETE RESTRICT,
  cantidad numeric(12,3) NOT NULL,
  precio_unitario numeric(18,2) NOT NULL,
  precio_costo numeric(18,6),
  subtotal numeric(18,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_comprobante_item_comprobante ON public.comprobante_item (comprobante_id);
`);

    await queryRunner.query(`
CREATE TABLE public.movimiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  tipo public.tipo_movimiento NOT NULL,
  cantidad numeric(12,3) NOT NULL,
  stock_anterior numeric(12,3) NOT NULL,
  stock_posterior numeric(12,3) NOT NULL,
  motivo text,
  referencia_tipo public.referencia_tipo,
  referencia_id uuid,
  usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_movimiento_tenant_producto ON public.movimiento (tenant_id, producto_id, created_at DESC);
`);

    await queryRunner.query(`
CREATE TABLE public.pedido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  cliente_id uuid,
  estado public.estado_pedido NOT NULL,
  fecha date NOT NULL,
  total numeric(18,2) NOT NULL,
  notas text,
  comprobante_id uuid REFERENCES public.comprobante (id) ON DELETE SET NULL,
  usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER pedido_set_updated_at
  BEFORE UPDATE ON public.pedido
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();
`);

    await queryRunner.query(`
CREATE TABLE public.pedido_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES public.pedido (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.producto (id) ON DELETE RESTRICT,
  cantidad numeric(12,3) NOT NULL,
  precio_unitario numeric(18,2) NOT NULL,
  subtotal numeric(18,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pedido_item_pedido ON public.pedido_item (pedido_id);
`);

    await queryRunner.query(`
CREATE TABLE public.arca_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  certificado_pem text,
  clave_privada_pem text,
  cuit_emisor varchar(13),
  punto_de_venta integer,
  ambiente public.arca_ambiente NOT NULL DEFAULT 'homologacion',
  ticket_acceso text,
  ticket_sign text,
  ticket_expiracion timestamptz,
  ultimo_comprobante integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_arca_config_tenant UNIQUE (tenant_id)
);

CREATE TRIGGER arca_config_set_updated_at
  BEFORE UPDATE ON public.arca_config
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();
`);

    await queryRunner.query(`
CREATE TABLE public.arca_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  servicio varchar(10) NOT NULL,
  operacion varchar(100) NOT NULL,
  request_xml text,
  response_xml text,
  exitoso boolean NOT NULL DEFAULT false,
  error_codigo varchar(64),
  error_mensaje text,
  comprobante_id uuid REFERENCES public.comprobante (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_arca_log_tenant_created ON public.arca_log (tenant_id, created_at DESC);
`);

    await queryRunner.query(`
CREATE TABLE public.precio_historial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  precio_costo_anterior numeric(18,6),
  precio_costo_nuevo numeric(18,6),
  precio_venta_anterior numeric(18,6),
  precio_venta_nuevo numeric(18,6),
  margen_anterior numeric(12,6),
  margen_nuevo numeric(12,6),
  origen public.origen_precio NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_precio_historial_tenant_producto ON public.precio_historial (tenant_id, producto_id, created_at DESC);
`);

    await queryRunner.query(`
CREATE TABLE public.importacion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  proveedor_id uuid,
  archivo_nombre text NOT NULL,
  origen public.origen_precio NOT NULL,
  total_filas integer NOT NULL DEFAULT 0,
  filas_exitosas integer NOT NULL DEFAULT 0,
  filas_con_error integer NOT NULL DEFAULT 0,
  productos_creados integer NOT NULL DEFAULT 0,
  productos_actualizados integer NOT NULL DEFAULT 0,
  detalle_errores jsonb,
  usuario_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_importacion_log_tenant_created ON public.importacion_log (tenant_id, created_at DESC);
`);

    await queryRunner.query(`
CREATE TABLE public.arca_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  comprobante_id uuid NOT NULL REFERENCES public.comprobante (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arca_job_comprobante_unique UNIQUE (comprobante_id)
);

CREATE INDEX arca_job_queue_poll_idx
  ON public.arca_job (status, next_attempt_at, created_at);

CREATE OR REPLACE FUNCTION public.set_arca_job_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER arca_job_updated_at
  BEFORE UPDATE ON public.arca_job
  FOR EACH ROW
  EXECUTE FUNCTION public.set_arca_job_updated_at();

CREATE OR REPLACE FUNCTION public.claim_arca_jobs(p_limit integer DEFAULT 10)
RETURNS SETOF public.arca_job
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.arca_job j
    WHERE j.status = 'pending'
      AND j.attempts < j.max_attempts
      AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= now())
    ORDER BY j.created_at ASC
    FOR UPDATE OF j SKIP LOCKED
    LIMIT COALESCE(p_limit, 10)
  )
  UPDATE public.arca_job j
  SET
    status = 'processing',
    attempts = j.attempts + 1,
    updated_at = now()
  FROM picked
  WHERE j.id = picked.id
  RETURNING j.*;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reset_stale_arca_jobs(p_stale_minutes integer DEFAULT 15)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n integer;
BEGIN
  WITH u AS (
    UPDATE public.arca_job
    SET
      status = 'pending',
      updated_at = now()
    WHERE status = 'processing'
      AND updated_at < now() - make_interval(mins => GREATEST(COALESCE(p_stale_minutes, 15), 1))
    RETURNING 1
  )
  SELECT count(*)::integer INTO n FROM u;

  RETURN COALESCE(n, 0);
END;
$fn$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP FUNCTION IF EXISTS public.reset_stale_arca_jobs(integer);
DROP FUNCTION IF EXISTS public.claim_arca_jobs(integer);
DROP FUNCTION IF EXISTS public.set_arca_job_updated_at();
DROP TABLE IF EXISTS public.arca_job CASCADE;

DROP TABLE IF EXISTS public.importacion_log CASCADE;
DROP TABLE IF EXISTS public.precio_historial CASCADE;
DROP TABLE IF EXISTS public.arca_log CASCADE;
DROP TABLE IF EXISTS public.arca_config CASCADE;
DROP TABLE IF EXISTS public.pedido_item CASCADE;
DROP TABLE IF EXISTS public.pedido CASCADE;
DROP TABLE IF EXISTS public.movimiento CASCADE;
DROP TABLE IF EXISTS public.comprobante_item CASCADE;
DROP TABLE IF EXISTS public.producto CASCADE;
DROP TABLE IF EXISTS public.comprobante CASCADE;
DROP TABLE IF EXISTS public.tenant CASCADE;

DROP FUNCTION IF EXISTS public.current_tenant_id();
DROP FUNCTION IF EXISTS public.moddatetime();

DROP TYPE IF EXISTS public.origen_precio CASCADE;
DROP TYPE IF EXISTS public.estado_pedido CASCADE;
DROP TYPE IF EXISTS public.arca_ambiente CASCADE;
DROP TYPE IF EXISTS public.referencia_tipo CASCADE;
DROP TYPE IF EXISTS public.tipo_movimiento CASCADE;
DROP TYPE IF EXISTS public.estado_comprobante CASCADE;
DROP TYPE IF EXISTS public.tipo_comprobante CASCADE;
DROP TYPE IF EXISTS public.unidad_medida CASCADE;
`);
  }
}
