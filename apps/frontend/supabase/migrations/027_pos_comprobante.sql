-- V60-POS-015: Add 'ticket' to tipo_comprobante enum,
-- and metodo_pago / metodo_pago_detalle / caja_id columns to comprobante.

-- New enum value
ALTER TYPE tipo_comprobante ADD VALUE IF NOT EXISTS 'ticket';

-- Payment method and POS terminal columns
ALTER TABLE comprobante
  ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(20),
  ADD COLUMN IF NOT EXISTS metodo_pago_detalle JSONB,
  ADD COLUMN IF NOT EXISTS caja_id VARCHAR(20);
