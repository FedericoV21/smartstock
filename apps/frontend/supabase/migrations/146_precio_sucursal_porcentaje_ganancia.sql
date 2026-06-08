ALTER TABLE public.precio_sucursal
  ADD COLUMN IF NOT EXISTS porcentaje_ganancia NUMERIC(5, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_precio_sucursal_ganancia_nonneg'
      AND conrelid = 'public.precio_sucursal'::regclass
  ) THEN
    ALTER TABLE public.precio_sucursal
      ADD CONSTRAINT chk_precio_sucursal_ganancia_nonneg
      CHECK (porcentaje_ganancia IS NULL OR porcentaje_ganancia >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.precio_sucursal.porcentaje_ganancia IS
  'Ganancia porcentual propia de la sucursal. Si tiene valor, precio_venta es derivado desde costo + ganancia + IVA.';
