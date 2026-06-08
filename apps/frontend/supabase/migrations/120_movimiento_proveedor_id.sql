-- Trazabilidad por proveedor en movimientos. Cada `entrada` por importación / factura / compra puede dejar
-- explícito qué proveedor la originó, sin tener que pasar por `referencia_id` y `importacion_log`.
-- Compatibilidad: el parámetro `p_proveedor_id` queda al final de `registrar_movimiento` y por defecto NULL,
-- así los callers viejos (POS / facturación / cobranza) siguen funcionando.

ALTER TABLE public.movimiento
  ADD COLUMN IF NOT EXISTS proveedor_id UUID NULL REFERENCES public.proveedor (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_movimiento_proveedor
  ON public.movimiento (tenant_id, proveedor_id)
  WHERE proveedor_id IS NOT NULL;

COMMENT ON COLUMN public.movimiento.proveedor_id IS
  'Proveedor que originó el movimiento (cuando aplica: entrada por importación / factura recibida / compra). NULL en ventas / ajustes / transferencias.';

-- Reescribir registrar_movimiento agregando p_proveedor_id (default NULL, último parámetro)
DROP FUNCTION IF EXISTS public.registrar_movimiento(
  UUID, UUID, UUID, public.tipo_movimiento, NUMERIC, TEXT, public.referencia_tipo, UUID, UUID, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.registrar_movimiento(
  p_tenant_id                 UUID,
  p_producto_id               UUID,
  p_sucursal_id               UUID,
  p_tipo                      public.tipo_movimiento,
  p_cantidad                  NUMERIC(12, 3),
  p_motivo                    TEXT DEFAULT NULL,
  p_referencia_tipo           public.referencia_tipo DEFAULT NULL,
  p_referencia_id             UUID DEFAULT NULL,
  p_usuario_id                UUID DEFAULT NULL,
  p_permitir_stock_negativo   BOOLEAN DEFAULT FALSE,
  p_proveedor_id              UUID DEFAULT NULL
) RETURNS public.movimiento AS $$
DECLARE
  v_suc_producto    UUID;
  v_stock_anterior  NUMERIC(12, 3);
  v_stock_posterior NUMERIC(12, 3);
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
    RAISE EXCEPTION 'Sucursal inválida o inactiva para este negocio';
  END IF;

  SELECT p.sucursal_id INTO v_suc_producto
  FROM public.producto p
  WHERE p.id = p_producto_id AND p.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  IF v_suc_producto IS NULL THEN
    RAISE EXCEPTION 'Producto sin sucursal asignada';
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
    tenant_id,
    sucursal_id,
    producto_id,
    tipo,
    cantidad,
    stock_anterior,
    stock_posterior,
    motivo,
    referencia_tipo,
    referencia_id,
    usuario_id,
    proveedor_id
  ) VALUES (
    p_tenant_id,
    p_sucursal_id,
    p_producto_id,
    p_tipo,
    p_cantidad,
    v_stock_anterior,
    v_stock_posterior,
    p_motivo,
    p_referencia_tipo,
    p_referencia_id,
    p_usuario_id,
    p_proveedor_id
  ) RETURNING * INTO v_movimiento;

  RETURN v_movimiento;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.registrar_movimiento(
  uuid, uuid, uuid, public.tipo_movimiento, numeric, text, public.referencia_tipo, uuid, uuid, boolean, uuid
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
