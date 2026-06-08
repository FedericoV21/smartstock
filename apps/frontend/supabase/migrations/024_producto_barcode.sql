-- V60-POS-001: Add barcode columns to producto table
-- codigo_barras (EAN-13/ITF-14), plu (balanza), es_pesable flag

-- New columns
ALTER TABLE producto
  ADD COLUMN IF NOT EXISTS codigo_barras VARCHAR(14),
  ADD COLUMN IF NOT EXISTS plu VARCHAR(5),
  ADD COLUMN IF NOT EXISTS es_pesable BOOLEAN NOT NULL DEFAULT false;

-- UNIQUE partial index: one active barcode per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_producto_barcode_tenant
  ON producto (tenant_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL AND activo = true;

-- UNIQUE partial index: one active PLU per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_producto_plu_tenant
  ON producto (tenant_id, plu)
  WHERE plu IS NOT NULL AND activo = true;

-- PLU only makes sense on pesable products
ALTER TABLE producto
  ADD CONSTRAINT chk_plu_requiere_pesable
  CHECK (plu IS NULL OR es_pesable = true);

-- Pesable products must use kg or gramo
ALTER TABLE producto
  ADD CONSTRAINT chk_pesable_unidad
  CHECK (es_pesable = false OR unidad IN ('kg', 'gramo'));
