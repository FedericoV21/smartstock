ALTER TABLE public.producto
ADD COLUMN IF NOT EXISTS descuento_costo_pct numeric(5,2);

ALTER TABLE public.producto
DROP CONSTRAINT IF EXISTS chk_producto_descuento_costo_pct_rango;

ALTER TABLE public.producto
ADD CONSTRAINT chk_producto_descuento_costo_pct_rango
CHECK (
  descuento_costo_pct IS NULL
  OR (descuento_costo_pct >= 0 AND descuento_costo_pct <= 100)
) NOT VALID;

COMMENT ON COLUMN public.producto.descuento_costo_pct IS
  'Descuento porcentual opcional sobre el costo bruto, usado solo como base para calcular precio_venta. No modifica precio_costo.';
