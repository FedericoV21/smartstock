-- v11.0: presentación de compra (caja, pack, etc.) con factor a unidades de stock (unidad base = producto.unidad).
-- stock_actual y movimientos siguen siempre en unidad base.

ALTER TABLE public.producto
  ADD COLUMN IF NOT EXISTS unidad_compra public.unidad_medida,
  ADD COLUMN IF NOT EXISTS contenido_unidad_compra NUMERIC(18, 6);

COMMENT ON COLUMN public.producto.unidad_compra IS
  'Presentación típica de compra (caja, pack, etc.); null si no hay conversión declarada.';
COMMENT ON COLUMN public.producto.contenido_unidad_compra IS
  'Unidades de stock (producto.unidad) que representa 1 unidad_compra; p. ej. 500 clavos por caja.';

ALTER TABLE public.producto
  ADD CONSTRAINT chk_producto_presentacion_compra CHECK (
    (unidad_compra IS NULL AND contenido_unidad_compra IS NULL)
    OR (
      unidad_compra IS NOT NULL
      AND contenido_unidad_compra IS NOT NULL
      AND contenido_unidad_compra > 0
    )
  );

NOTIFY pgrst, 'reload schema';
