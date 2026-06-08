-- Permitir productos de balanza por unidad (PLU + cantidad de unidades).
-- Hasta ahora un producto con PLU/pesable solo podia usar kg o gramo.

ALTER TABLE public.producto
  DROP CONSTRAINT IF EXISTS chk_pesable_unidad;

ALTER TABLE public.producto
  ADD CONSTRAINT chk_pesable_unidad
  CHECK (es_pesable = false OR unidad IN ('unidad', 'kg', 'gramo'));
     