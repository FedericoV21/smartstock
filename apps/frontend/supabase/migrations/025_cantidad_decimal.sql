-- V60-POS-002 + V60-POS-004: Migrate cantidad/stock columns to NUMERIC(12,3)
-- and update registrar_movimiento function signature accordingly.

-- ============================================================
-- 1. producto: stock_actual and stock_minimo
-- ============================================================
ALTER TABLE producto
  ALTER COLUMN stock_actual TYPE NUMERIC(12,3) USING stock_actual::NUMERIC(12,3),
  ALTER COLUMN stock_minimo TYPE NUMERIC(12,3) USING stock_minimo::NUMERIC(12,3);

-- Re-check constraint (already accepts decimals, but recreate to be explicit)
ALTER TABLE producto DROP CONSTRAINT IF EXISTS chk_stock_positivo;
ALTER TABLE producto
  ADD CONSTRAINT chk_stock_positivo CHECK (stock_actual >= 0);

-- ============================================================
-- 2. movimiento: cantidad, stock_anterior, stock_posterior
-- ============================================================
ALTER TABLE movimiento
  ALTER COLUMN cantidad TYPE NUMERIC(12,3) USING cantidad::NUMERIC(12,3),
  ALTER COLUMN stock_anterior TYPE NUMERIC(12,3) USING stock_anterior::NUMERIC(12,3),
  ALTER COLUMN stock_posterior TYPE NUMERIC(12,3) USING stock_posterior::NUMERIC(12,3);

ALTER TABLE movimiento DROP CONSTRAINT IF EXISTS chk_cantidad_positiva;
ALTER TABLE movimiento
  ADD CONSTRAINT chk_cantidad_positiva CHECK (cantidad > 0);

-- ============================================================
-- 3. comprobante_item: cantidad
-- ============================================================
ALTER TABLE comprobante_item
  ALTER COLUMN cantidad TYPE NUMERIC(12,3) USING cantidad::NUMERIC(12,3);

ALTER TABLE comprobante_item DROP CONSTRAINT IF EXISTS chk_item_positivo;
ALTER TABLE comprobante_item
  ADD CONSTRAINT chk_item_positivo CHECK (cantidad > 0 AND precio_unitario >= 0 AND subtotal >= 0);

-- ============================================================
-- 4. pedido_item: cantidad
-- ============================================================
ALTER TABLE pedido_item
  ALTER COLUMN cantidad TYPE NUMERIC(12,3) USING cantidad::NUMERIC(12,3);

ALTER TABLE pedido_item DROP CONSTRAINT IF EXISTS chk_pedido_item_positivo;
ALTER TABLE pedido_item
  ADD CONSTRAINT chk_pedido_item_positivo CHECK (cantidad > 0 AND precio_unitario >= 0 AND subtotal >= 0);

-- ============================================================
-- 5. Update registrar_movimiento function (V60-POS-004)
--    Parameters and internal variables change from INTEGER to NUMERIC(12,3).
--    Logic is identical.
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_movimiento(
  p_tenant_id       UUID,
  p_producto_id     UUID,
  p_tipo            tipo_movimiento,
  p_cantidad        NUMERIC(12,3),
  p_motivo          TEXT DEFAULT NULL,
  p_referencia_tipo referencia_tipo DEFAULT NULL,
  p_referencia_id   UUID DEFAULT NULL,
  p_usuario_id      UUID DEFAULT NULL
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
      IF v_stock_posterior < 0 THEN
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
