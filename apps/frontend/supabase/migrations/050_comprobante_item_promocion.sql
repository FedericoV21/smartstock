-- v8.0 — Snapshot de promoción en líneas de comprobante y pedido (V80-PROMO-003).

ALTER TABLE public.comprobante_item
  ADD COLUMN IF NOT EXISTS promocion_id UUID REFERENCES public.promocion (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promocion_descripcion TEXT,
  ADD COLUMN IF NOT EXISTS precio_unitario_original NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS descuento_promo_monto NUMERIC(12, 2);

ALTER TABLE public.pedido_item
  ADD COLUMN IF NOT EXISTS promocion_id UUID REFERENCES public.promocion (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promocion_descripcion TEXT,
  ADD COLUMN IF NOT EXISTS precio_unitario_original NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS descuento_promo_monto NUMERIC(12, 2);

COMMENT ON COLUMN public.comprobante_item.precio_unitario_original IS
  'Precio unitario antes de promo; NULL si no hubo promoción en la línea.';

COMMENT ON COLUMN public.comprobante_item.descuento_promo_monto IS
  'Ahorro total de la línea por promoción al momento de emitir.';
