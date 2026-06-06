import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-VAR-001: producto_variante + stock por sucursal + registrar_movimiento_variante.
 */
export class NbVar001ProductoVariantesSchema1747600000000 implements MigrationInterface {
  name = 'NbVar001ProductoVariantesSchema1747600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.producto
  ADD COLUMN IF NOT EXISTS usa_variantes boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.producto.usa_variantes IS
  'Si true, el stock vendible vive en producto_variante_stock_sucursal.';

CREATE TABLE IF NOT EXISTS public.producto_variante (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  codigo text,
  codigo_barras varchar(64),
  atributos jsonb NOT NULL DEFAULT '{}'::jsonb,
  etiqueta text,
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_producto_variante_atributos_obj CHECK (jsonb_typeof(atributos) = 'object'),
  CONSTRAINT chk_producto_variante_codigo_not_blank CHECK (codigo IS NULL OR btrim(codigo) <> ''),
  CONSTRAINT chk_producto_variante_barcode_not_blank CHECK (codigo_barras IS NULL OR btrim(codigo_barras) <> '')
);

CREATE INDEX IF NOT EXISTS idx_producto_variante_tenant_producto
  ON public.producto_variante (tenant_id, producto_id);

CREATE INDEX IF NOT EXISTS idx_producto_variante_tenant_barcode
  ON public.producto_variante (tenant_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL AND activo = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_variante_codigo_activa
  ON public.producto_variante (tenant_id, producto_id, lower(btrim(codigo)))
  WHERE codigo IS NOT NULL AND activo = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_variante_barcode_activa
  ON public.producto_variante (tenant_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL AND activo = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_variante_atributos_activa
  ON public.producto_variante (tenant_id, producto_id, atributos)
  WHERE activo = true;

CREATE TRIGGER producto_variante_set_updated_at
  BEFORE UPDATE ON public.producto_variante
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

CREATE TABLE IF NOT EXISTS public.producto_variante_stock_sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  variante_id uuid NOT NULL REFERENCES public.producto_variante (id) ON DELETE CASCADE,
  sucursal_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  stock_actual numeric(12, 3) NOT NULL DEFAULT 0,
  stock_minimo numeric(12, 3) NOT NULL DEFAULT 0,
  ubicacion text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_producto_variante_stock_sucursal UNIQUE (variante_id, sucursal_id),
  CONSTRAINT chk_producto_variante_stock_nonneg_min CHECK (stock_minimo >= 0)
);

CREATE INDEX IF NOT EXISTS idx_producto_variante_stock_tenant_producto
  ON public.producto_variante_stock_sucursal (tenant_id, producto_id);

CREATE INDEX IF NOT EXISTS idx_producto_variante_stock_sucursal
  ON public.producto_variante_stock_sucursal (tenant_id, sucursal_id, producto_id);

CREATE TRIGGER producto_variante_stock_set_updated_at
  BEFORE UPDATE ON public.producto_variante_stock_sucursal
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

ALTER TABLE public.movimiento
  ADD COLUMN IF NOT EXISTS producto_variante_id uuid REFERENCES public.producto_variante (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS producto_variante_etiqueta text;

CREATE INDEX IF NOT EXISTS idx_movimiento_producto_variante
  ON public.movimiento (tenant_id, producto_variante_id)
  WHERE producto_variante_id IS NOT NULL;

ALTER TABLE public.comprobante_item
  ADD COLUMN IF NOT EXISTS producto_variante_id uuid REFERENCES public.producto_variante (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS producto_variante_etiqueta text;

ALTER TABLE public.pedido_item
  ADD COLUMN IF NOT EXISTS producto_variante_id uuid REFERENCES public.producto_variante (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS producto_variante_etiqueta text;

CREATE OR REPLACE FUNCTION public.producto_variante_etiqueta(
  p_atributos jsonb,
  p_etiqueta text DEFAULT NULL
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(btrim(p_etiqueta), ''),
    NULLIF(
      array_to_string(
        ARRAY[
          NULLIF(btrim(p_atributos->>'talle'), ''),
          NULLIF(btrim(p_atributos->>'color'), ''),
          NULLIF(btrim(p_atributos->>'material'), ''),
          NULLIF(btrim(p_atributos->>'medida'), '')
        ],
        ' / '
      ),
      ''
    ),
    'Variante'
  );
$$;
`);

    await queryRunner.query(`
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
  v_usa_variantes   boolean;
  v_stock_anterior  numeric(12, 3);
  v_stock_posterior numeric(12, 3);
  v_movimiento      public.movimiento;
BEGIN
  IF p_cantidad IS NULL THEN
    RAISE EXCEPTION 'La cantidad no puede ser nula';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sucursal s
    WHERE s.id = p_sucursal_id AND s.tenant_id = p_tenant_id AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal inv├ílida o inactiva para este negocio';
  END IF;

  SELECT p.usa_variantes INTO v_usa_variantes
  FROM public.producto p
  WHERE p.id = p_producto_id AND p.tenant_id = p_tenant_id AND p.activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  IF v_usa_variantes THEN
    RAISE EXCEPTION 'Este producto usa variantes. Selecciona una variante para mover stock.';
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
        RAISE EXCEPTION 'Stock insuficiente. Actual: %, solicitado: %', v_stock_anterior, p_cantidad;
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

CREATE OR REPLACE FUNCTION public.registrar_movimiento_variante(
  p_tenant_id                 uuid,
  p_producto_id               uuid,
  p_producto_variante_id      uuid,
  p_sucursal_id               uuid,
  p_tipo                      public.tipo_movimiento,
  p_cantidad                  numeric(12, 3),
  p_motivo                    text DEFAULT NULL,
  p_referencia_tipo           public.referencia_tipo DEFAULT NULL,
  p_referencia_id             uuid DEFAULT NULL,
  p_usuario_id                uuid DEFAULT NULL,
  p_permitir_stock_negativo   boolean DEFAULT FALSE
) RETURNS public.movimiento AS $rmv$
DECLARE
  v_usa_variantes   boolean;
  v_var_etiqueta    text;
  v_stock_anterior  numeric(12, 3);
  v_stock_posterior numeric(12, 3);
  v_movimiento      public.movimiento;
BEGIN
  IF p_producto_variante_id IS NULL THEN
    RAISE EXCEPTION 'La variante es obligatoria';
  END IF;

  IF p_cantidad IS NULL THEN
    RAISE EXCEPTION 'La cantidad no puede ser nula';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sucursal s
    WHERE s.id = p_sucursal_id AND s.tenant_id = p_tenant_id AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal inv├ílida o inactiva para este negocio';
  END IF;

  SELECT p.usa_variantes INTO v_usa_variantes
  FROM public.producto p
  WHERE p.id = p_producto_id AND p.tenant_id = p_tenant_id AND p.activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  IF NOT v_usa_variantes THEN
    RAISE EXCEPTION 'Este producto no usa variantes';
  END IF;

  SELECT public.producto_variante_etiqueta(v.atributos, v.etiqueta)
    INTO v_var_etiqueta
  FROM public.producto_variante v
  WHERE v.id = p_producto_variante_id
    AND v.producto_id = p_producto_id
    AND v.tenant_id = p_tenant_id
    AND v.activo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variante no encontrada o inactiva: %', p_producto_variante_id;
  END IF;

  SELECT ss.stock_actual INTO v_stock_anterior
  FROM public.producto_variante_stock_sucursal ss
  WHERE ss.tenant_id = p_tenant_id
    AND ss.producto_id = p_producto_id
    AND ss.variante_id = p_producto_variante_id
    AND ss.sucursal_id = p_sucursal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.producto_variante_stock_sucursal (
      tenant_id, producto_id, variante_id, sucursal_id, stock_actual, stock_minimo, ubicacion
    )
    VALUES (p_tenant_id, p_producto_id, p_producto_variante_id, p_sucursal_id, 0, 0, NULL)
    ON CONFLICT (variante_id, sucursal_id) DO NOTHING;

    SELECT ss.stock_actual INTO v_stock_anterior
    FROM public.producto_variante_stock_sucursal ss
    WHERE ss.tenant_id = p_tenant_id
      AND ss.producto_id = p_producto_id
      AND ss.variante_id = p_producto_variante_id
      AND ss.sucursal_id = p_sucursal_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se pudo inicializar stock de la variante % en la sucursal %', p_producto_variante_id, p_sucursal_id;
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
        RAISE EXCEPTION 'Stock insuficiente. Actual: %, solicitado: %', v_stock_anterior, p_cantidad;
      END IF;
    WHEN 'ajuste' THEN
      v_stock_posterior := p_cantidad;
    ELSE
      RAISE EXCEPTION 'Tipo de movimiento no soportado: %', p_tipo;
  END CASE;

  UPDATE public.producto_variante_stock_sucursal ss
  SET stock_actual = v_stock_posterior, updated_at = NOW()
  WHERE ss.tenant_id = p_tenant_id
    AND ss.producto_id = p_producto_id
    AND ss.variante_id = p_producto_variante_id
    AND ss.sucursal_id = p_sucursal_id;

  INSERT INTO public.movimiento (
    tenant_id, sucursal_id, producto_id, producto_variante_id, producto_variante_etiqueta,
    tipo, cantidad, stock_anterior, stock_posterior, motivo, referencia_tipo, referencia_id, usuario_id
  ) VALUES (
    p_tenant_id, p_sucursal_id, p_producto_id, p_producto_variante_id, v_var_etiqueta,
    p_tipo, p_cantidad, v_stock_anterior, v_stock_posterior, p_motivo, p_referencia_tipo,
    p_referencia_id, p_usuario_id
  ) RETURNING * INTO v_movimiento;

  RETURN v_movimiento;
END;
$rmv$ LANGUAGE plpgsql SECURITY DEFINER;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP FUNCTION IF EXISTS public.registrar_movimiento_variante(uuid, uuid, uuid, uuid, public.tipo_movimiento, numeric, text, public.referencia_tipo, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.producto_variante_etiqueta(jsonb, text);
ALTER TABLE public.pedido_item DROP COLUMN IF EXISTS producto_variante_etiqueta;
ALTER TABLE public.pedido_item DROP COLUMN IF EXISTS producto_variante_id;
ALTER TABLE public.comprobante_item DROP COLUMN IF EXISTS producto_variante_etiqueta;
ALTER TABLE public.comprobante_item DROP COLUMN IF EXISTS producto_variante_id;
ALTER TABLE public.movimiento DROP COLUMN IF EXISTS producto_variante_etiqueta;
ALTER TABLE public.movimiento DROP COLUMN IF EXISTS producto_variante_id;
DROP TABLE IF EXISTS public.producto_variante_stock_sucursal;
DROP TABLE IF EXISTS public.producto_variante;
ALTER TABLE public.producto DROP COLUMN IF EXISTS usa_variantes;
`);
  }
}
