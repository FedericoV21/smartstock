-- Drop the old INTEGER overload of registrar_movimiento.
-- Migration 025 used CREATE OR REPLACE to change p_cantidad from INTEGER
-- to NUMERIC(12,3), but PostgreSQL treats different parameter types as
-- separate overloads instead of replacing. This left two functions with
-- the same name, causing "could not choose the best candidate function".

DROP FUNCTION IF EXISTS public.registrar_movimiento(
  UUID, UUID, tipo_movimiento, INTEGER, TEXT, referencia_tipo, UUID, UUID
);
