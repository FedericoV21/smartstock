import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-SUC-002: stock_sucursal, producto/movimiento.sucursal_id, registrar_movimiento por dep├│sito.
 * Alineado con Supabase 104ÔÇô106 (sin precio_sucursal ni variantes).
 */
export class NbSuc002StockSucursalSchema1747200000000 implements MigrationInterface {
  name = 'NbSuc002StockSucursalSchema1747200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.stock_sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  stock_actual numeric(12, 3) NOT NULL DEFAULT 0,
  stock_minimo numeric(12, 3) NOT NULL DEFAULT 0,
  ubicacion text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uk_stock_sucursal_producto_sucursal UNIQUE (producto_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_sucursal_tenant
  ON public.stock_sucursal (tenant_id);

CREATE INDEX IF NOT EXISTS idx_stock_sucursal_sucursal
  ON public.stock_sucursal (sucursal_id);

CREATE INDEX IF NOT EXISTS idx_stock_sucursal_tenant_sucursal_producto
  ON public.stock_sucursal (tenant_id, sucursal_id, producto_id);

CREATE INDEX IF NOT EXISTS idx_stock_sucursal_bajo
  ON public.stock_sucursal (tenant_id, sucursal_id)
  WHERE stock_actual <= stock_minimo;

CREATE TRIGGER stock_sucursal_set_updated_at
  BEFORE UPDATE ON public.stock_sucursal
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();
`);

    await queryRunner.query(`
ALTER TABLE public.producto
  ADD COLUMN IF NOT EXISTS sucursal_id uuid REFERENCES public.sucursal (id) ON DELETE SET NULL;

UPDATE public.producto p
SET sucursal_id = sub.id
FROM (
  SELECT DISTINCT ON (s.tenant_id)
    s.tenant_id,
    s.id
  FROM public.sucursal s
  WHERE s.activa = true
  ORDER BY s.tenant_id, s.es_principal DESC, s.created_at ASC
) sub
WHERE p.tenant_id = sub.tenant_id
  AND p.sucursal_id IS NULL;
`);

    await queryRunner.query(`
INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
SELECT p.tenant_id, p.id, p.sucursal_id, p.stock_actual, p.stock_minimo, NULL
FROM public.producto p
WHERE p.sucursal_id IS NOT NULL
ON CONFLICT (producto_id, sucursal_id) DO NOTHING;
`);

    await queryRunner.query(`
ALTER TABLE public.movimiento
  ADD COLUMN IF NOT EXISTS sucursal_id uuid REFERENCES public.sucursal (id);

UPDATE public.movimiento m
SET sucursal_id = p.sucursal_id
FROM public.producto p
WHERE p.id = m.producto_id
  AND m.sucursal_id IS NULL;

UPDATE public.movimiento m
SET sucursal_id = sub.sucursal_id
FROM (
  SELECT DISTINCT ON (tenant_id)
    tenant_id,
    id AS sucursal_id
  FROM public.sucursal
  WHERE activa = true
  ORDER BY tenant_id, es_principal DESC, created_at ASC
) sub
WHERE m.sucursal_id IS NULL
  AND m.tenant_id = sub.tenant_id;

CREATE INDEX IF NOT EXISTS idx_movimiento_sucursal ON public.movimiento (sucursal_id);
`);

    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.trg_producto_after_insert_stock_sucursal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.sucursal_id IS NOT NULL THEN
    INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
    VALUES (NEW.tenant_id, NEW.id, NEW.sucursal_id, NEW.stock_actual, NEW.stock_minimo, NULL)
    ON CONFLICT (producto_id, sucursal_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_producto_after_insert_stock_sucursal ON public.producto;
CREATE TRIGGER trg_producto_after_insert_stock_sucursal
  AFTER INSERT ON public.producto
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_producto_after_insert_stock_sucursal();

CREATE OR REPLACE FUNCTION public.trg_stock_sucursal_after_update_sync_producto()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF COALESCE(current_setting('app.suppress_stock_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('app.suppress_stock_sync', 'on', true);
  UPDATE public.producto p
  SET
    stock_actual = NEW.stock_actual,
    stock_minimo = NEW.stock_minimo,
    updated_at = NOW()
  WHERE p.id = NEW.producto_id
    AND p.sucursal_id = NEW.sucursal_id
    AND p.tenant_id = NEW.tenant_id;
  PERFORM set_config('app.suppress_stock_sync', '', true);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_stock_sucursal_after_update_sync_producto ON public.stock_sucursal;
CREATE TRIGGER trg_stock_sucursal_after_update_sync_producto
  AFTER UPDATE OF stock_actual, stock_minimo ON public.stock_sucursal
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_stock_sucursal_after_update_sync_producto();

CREATE OR REPLACE FUNCTION public.trg_producto_after_update_sync_stock_sucursal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.sucursal_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('app.suppress_stock_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('app.suppress_stock_sync', 'on', true);
  UPDATE public.stock_sucursal ss
  SET
    stock_actual = NEW.stock_actual,
    stock_minimo = NEW.stock_minimo,
    updated_at = NOW()
  WHERE ss.producto_id = NEW.id
    AND ss.sucursal_id = NEW.sucursal_id
    AND ss.tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
    VALUES (NEW.tenant_id, NEW.id, NEW.sucursal_id, NEW.stock_actual, NEW.stock_minimo, NULL)
    ON CONFLICT (producto_id, sucursal_id) DO NOTHING;
  END IF;
  PERFORM set_config('app.suppress_stock_sync', '', true);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_producto_after_update_sync_stock_sucursal ON public.producto;
CREATE TRIGGER trg_producto_after_update_sync_stock_sucursal
  AFTER UPDATE OF stock_actual, stock_minimo ON public.producto
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_producto_after_update_sync_stock_sucursal();
`);

    await queryRunner.query(`
DROP FUNCTION IF EXISTS public.registrar_movimiento(uuid, uuid, public.tipo_movimiento, numeric, text, public.referencia_tipo, uuid, uuid);
DROP FUNCTION IF EXISTS public.registrar_movimiento(uuid, uuid, uuid, public.tipo_movimiento, numeric, text, public.referencia_tipo, uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.registrar_movimiento(
  p_tenant_id                 uuid,
  p_producto_id               uuid,
  p_sucursal_id               uuid,
  p_tipo                      public.tipo_movimiento,
  p_cantidad                  numeric(12, 3),
  p_motivo                    text DEFAULT NULL,
  p_referencia_tipo           public.referencia_tipo DEFAULT NULL,
  p_referencia_id             uuid DEFAULT NULL,
  p_usuario_id                uuid DEFAULT NULL,
  p_permitir_stock_negativo   boolean DEFAULT FALSE
) RETURNS public.movimiento AS $rm$
DECLARE
  v_stock_anterior  numeric(12, 3);
  v_stock_posterior numeric(12, 3);
  v_movimiento      public.movimiento;
BEGIN
  IF p_cantidad IS NULL THEN
    RAISE EXCEPTION 'La cantidad no puede ser nula';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sucursal s
    WHERE s.id = p_sucursal_id
      AND s.tenant_id = p_tenant_id
      AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal inv├ílida o inactiva para este negocio';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.producto p
    WHERE p.id = p_producto_id AND p.tenant_id = p_tenant_id AND p.activo = true
  ) THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  SELECT ss.stock_actual INTO v_stock_anterior
  FROM public.stock_sucursal ss
  WHERE ss.tenant_id = p_tenant_id
    AND ss.producto_id = p_producto_id
    AND ss.sucursal_id = p_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
    VALUES (p_tenant_id, p_producto_id, p_sucursal_id, 0, 0, NULL)
    ON CONFLICT (producto_id, sucursal_id) DO NOTHING;

    SELECT ss.stock_actual INTO v_stock_anterior
    FROM public.stock_sucursal ss
    WHERE ss.tenant_id = p_tenant_id
      AND ss.producto_id = p_producto_id
      AND ss.sucursal_id = p_sucursal_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se pudo inicializar stock_sucursal para el producto % en la sucursal %', p_producto_id, p_sucursal_id;
    END IF;
  END IF;

  CASE p_tipo
    WHEN 'entrada' THEN
      IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad de entrada debe ser mayor a cero';
      END IF;
      v_stock_posterior := v_stock_anterior + p_cantidad;
    WHEN 'salida' THEN
      IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad de salida debe ser mayor a cero';
      END IF;
      v_stock_posterior := v_stock_anterior - p_cantidad;
      IF NOT p_permitir_stock_negativo AND v_stock_posterior < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente. Actual: %, solicitado: %',
          v_stock_anterior, p_cantidad;
      END IF;
    WHEN 'ajuste' THEN
      v_stock_posterior := p_cantidad;
    ELSE
      RAISE EXCEPTION 'Tipo de movimiento no soportado: %', p_tipo;
  END CASE;

  UPDATE public.stock_sucursal ss
  SET stock_actual = v_stock_posterior, updated_at = NOW()
  WHERE ss.tenant_id = p_tenant_id
    AND ss.producto_id = p_producto_id
    AND ss.sucursal_id = p_sucursal_id;

  INSERT INTO public.movimiento (
    tenant_id, sucursal_id, producto_id, tipo, cantidad,
    stock_anterior, stock_posterior, motivo, referencia_tipo, referencia_id, usuario_id
  ) VALUES (
    p_tenant_id, p_sucursal_id, p_producto_id, p_tipo, p_cantidad,
    v_stock_anterior, v_stock_posterior, p_motivo, p_referencia_tipo, p_referencia_id, p_usuario_id
  ) RETURNING * INTO v_movimiento;

  RETURN v_movimiento;
END;
$rm$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.materializar_stock_sucursales_faltantes(p_tenant_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  n bigint;
BEGIN
  INSERT INTO public.stock_sucursal (tenant_id, producto_id, sucursal_id, stock_actual, stock_minimo, ubicacion)
  SELECT p.tenant_id, p.id, s.id, 0::numeric(12, 3), 0::numeric(12, 3), NULL::text
  FROM public.producto p
  INNER JOIN public.sucursal s
    ON s.tenant_id = p.tenant_id
    AND s.activa = true
  WHERE p.tenant_id = p_tenant_id
    AND p.activo = true
    AND p.sucursal_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.stock_sucursal ss
      WHERE ss.tenant_id = p.tenant_id
        AND ss.producto_id = p.id
        AND ss.sucursal_id = s.id
    )
  ON CONFLICT (producto_id, sucursal_id) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP FUNCTION IF EXISTS public.materializar_stock_sucursales_faltantes(uuid);
DROP FUNCTION IF EXISTS public.registrar_movimiento(uuid, uuid, uuid, public.tipo_movimiento, numeric, text, public.referencia_tipo, uuid, uuid, boolean);
DROP TRIGGER IF EXISTS trg_producto_after_update_sync_stock_sucursal ON public.producto;
DROP FUNCTION IF EXISTS public.trg_producto_after_update_sync_stock_sucursal();
DROP TRIGGER IF EXISTS trg_stock_sucursal_after_update_sync_producto ON public.stock_sucursal;
DROP FUNCTION IF EXISTS public.trg_stock_sucursal_after_update_sync_producto();
DROP TRIGGER IF EXISTS trg_producto_after_insert_stock_sucursal ON public.producto;
DROP FUNCTION IF EXISTS public.trg_producto_after_insert_stock_sucursal();
ALTER TABLE public.movimiento DROP COLUMN IF EXISTS sucursal_id;
ALTER TABLE public.producto DROP COLUMN IF EXISTS sucursal_id;
DROP TABLE IF EXISTS public.stock_sucursal CASCADE;
`);
  }
}
