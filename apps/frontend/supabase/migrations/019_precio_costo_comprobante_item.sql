-- V50-ANAL-003: precio_costo en comprobante_item para rentabilidad histórica.

ALTER TABLE public.comprobante_item
  ADD COLUMN precio_costo NUMERIC(18, 6) DEFAULT 0;

-- Backfill: toma el precio_costo actual de cada producto para items existentes.
UPDATE public.comprobante_item ci
SET precio_costo = p.precio_costo
FROM public.producto p
WHERE ci.producto_id = p.id;
