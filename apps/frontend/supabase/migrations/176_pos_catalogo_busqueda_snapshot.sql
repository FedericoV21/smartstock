-- Indices para acelerar la precarga liviana del catalogo POS.
-- La app no depende de una RPC: /api/pos/catalogo-busqueda tiene fallback con queries normales.

CREATE INDEX IF NOT EXISTS idx_producto_pos_catalogo_tenant_nombre_id
  ON public.producto (tenant_id, (lower(nombre)), id)
  WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_producto_pos_catalogo_tenant_id_activo
  ON public.producto (tenant_id, id)
  WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_producto_variante_pos_tenant_producto_orden
  ON public.producto_variante (tenant_id, producto_id, orden, id)
  WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_stock_sucursal_tenant_sucursal_producto
  ON public.stock_sucursal (tenant_id, sucursal_id, producto_id);

CREATE INDEX IF NOT EXISTS idx_precio_sucursal_tenant_sucursal_producto
  ON public.precio_sucursal (tenant_id, sucursal_id, producto_id);
