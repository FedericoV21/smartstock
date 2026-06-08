-- V50-ANAL-012: add 'lista_precios' value to origen_precio enum.
-- Required for precio_historial entries generated when applying a lista.

ALTER TYPE public.origen_precio ADD VALUE IF NOT EXISTS 'lista_precios';
