-- Datos y CHECK tras 056. Requiere 053 (chk recreado) y 056.

UPDATE public.cuenta_corriente
SET tipo_cuenta = 'proveedor'
WHERE proveedor_id IS NOT NULL
  AND tipo_cuenta::text != 'proveedor';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_cuenta_corriente_tipo_segun_parte'
      AND conrelid = 'public.cuenta_corriente'::regclass
  ) THEN
    ALTER TABLE public.cuenta_corriente
      ADD CONSTRAINT chk_cuenta_corriente_tipo_segun_parte CHECK (
        (
          cliente_id IS NOT NULL
          AND proveedor_id IS NULL
          AND tipo_cuenta IN ('cliente', 'empleado')
        )
        OR (
          proveedor_id IS NOT NULL
          AND cliente_id IS NULL
          AND tipo_cuenta = 'proveedor'
        )
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.cuenta_corriente.tipo_cuenta IS
  'Clasificación: cliente o empleado (cuentas a cobrar) o proveedor (cuenta a pagar). Debe alinearse con cliente_id o proveedor_id.';
