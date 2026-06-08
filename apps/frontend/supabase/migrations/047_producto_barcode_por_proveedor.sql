-- Permitir el mismo código de barras en productos distintos si difieren en proveedor.
-- Si proveedor_id es NULL, sigue habiendo como máximo un producto activo por (tenant, codigo_barras).

DROP INDEX IF EXISTS idx_producto_barcode_tenant;

CREATE UNIQUE INDEX IF NOT EXISTS idx_producto_barcode_tenant_proveedor
  ON producto (tenant_id, codigo_barras, proveedor_id)
  WHERE codigo_barras IS NOT NULL AND activo = true AND proveedor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_producto_barcode_tenant_sin_proveedor
  ON producto (tenant_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL AND activo = true AND proveedor_id IS NULL;
