-- POS: permitir venta "contra stock" cuando no se valida stock en el comprobante.
-- Se agrega un parámetro opcional; las llamadas existentes siguen usando el default (false).

DROP FUNCTION IF EXISTS public.registrar_movimiento(
  UUID,
  UUID,
  tipo_movimiento,
  NUMERIC,
  TEXT,
  referencia_tipo,
  UUID,
  UUID
);

CREATE OR REPLACE FUNCTION public.registrar_movimiento(
  p_tenant_id                 UUID,
  p_producto_id               UUID,
  p_tipo                      tipo_movimiento,
  p_cantidad                  NUMERIC(12,3),
  p_motivo                    TEXT DEFAULT NULL,
  p_referencia_tipo           referencia_tipo DEFAULT NULL,
  p_referencia_id             UUID DEFAULT NULL,
  p_usuario_id                UUID DEFAULT NULL,
  p_permitir_stock_negativo   BOOLEAN DEFAULT FALSE
) RETURNS movimiento AS $$
DECLARE
  v_stock_anterior  NUMERIC(12,3);
  v_stock_posterior NUMERIC(12,3);
  v_movimiento      movimiento;
BEGIN
  SELECT stock_actual INTO v_stock_anterior
  FROM producto
  WHERE id = p_producto_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
  END IF;

  CASE p_tipo
    WHEN 'entrada' THEN
      v_stock_posterior := v_stock_anterior + p_cantidad;
    WHEN 'salida' THEN
      v_stock_posterior := v_stock_anterior - p_cantidad;
      IF NOT p_permitir_stock_negativo AND v_stock_posterior < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente. Actual: %, solicitado: %',
          v_stock_anterior, p_cantidad;
      END IF;
    WHEN 'ajuste' THEN
      v_stock_posterior := p_cantidad;
  END CASE;

  UPDATE producto
  SET stock_actual = v_stock_posterior, updated_at = NOW()
  WHERE id = p_producto_id AND tenant_id = p_tenant_id;

  INSERT INTO movimiento (
    tenant_id, producto_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    motivo, referencia_tipo, referencia_id, usuario_id
  ) VALUES (
    p_tenant_id, p_producto_id, p_tipo, p_cantidad,
    v_stock_anterior, v_stock_posterior,
    p_motivo, p_referencia_tipo, p_referencia_id, p_usuario_id
  ) RETURNING * INTO v_movimiento;

  RETURN v_movimiento;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Exponer la función al API (por si el reemplazo quitó permisos previos).
GRANT EXECUTE ON FUNCTION public.registrar_movimiento(
  uuid, uuid, public.tipo_movimiento, numeric, text, public.referencia_tipo, uuid, uuid, boolean
) TO authenticated, service_role;

-- Refrescar caché de esquema de PostgREST (evita "Could not find the function ... in the schema cache").
NOTIFY pgrst, 'reload schema';
