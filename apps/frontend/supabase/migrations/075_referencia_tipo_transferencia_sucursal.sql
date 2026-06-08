-- Asegura el valor de enum usado por transferir_stock_entre_sucursales y registrar_movimiento.
-- Idempotente: si 073/074 ya corrieron, no falla.

ALTER TYPE public.referencia_tipo ADD VALUE IF NOT EXISTS 'transferencia_sucursal';

NOTIFY pgrst, 'reload schema';
