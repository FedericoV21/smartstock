-- Valor de enum "proveedor" (cuentas a pagar). Debe ser la única sentencia de este archivo
-- para evitar que use del nuevo valor falle en la misma transacción (según versión de PG).
-- Requiere 051. Continúa en 057_tipo_cuenta_proveedor_datos_y_check.sql

ALTER TYPE public.tipo_cuenta_corriente ADD VALUE IF NOT EXISTS 'proveedor';
