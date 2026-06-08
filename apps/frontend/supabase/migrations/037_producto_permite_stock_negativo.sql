-- Venta contra stock (POS con "Bloquear ventas sin stock suficiente" desactivado):
-- registrar_movimiento puede dejar stock_actual < 0; el CHECK de 025 lo impedía a nivel tabla.

ALTER TABLE public.producto DROP CONSTRAINT IF EXISTS chk_stock_positivo;
