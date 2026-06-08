-- Permitir el mismo código de barras en varios productos activos de la misma sucursal
-- (con o sin proveedor). El POS ya puede devolver 409 "ambiguous" si hay varios matches.

DROP INDEX IF EXISTS idx_producto_barcode_tenant_sucursal_proveedor;
DROP INDEX IF EXISTS idx_producto_barcode_tenant_sucursal_sin_proveedor;

CREATE INDEX IF NOT EXISTS idx_producto_barcode_tenant_sucursal_lookup
  ON public.producto (tenant_id, sucursal_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL AND activo = true;
