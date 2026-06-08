-- Trazabilidad para revertir pagos a proveedores desde la cuenta corriente.
-- La reversion se ejecuta desde la API; la migracion solo agrega el vinculo
-- entre el movimiento de pago de factura y el pago de cuenta corriente.

ALTER TABLE public.pago_proveedor_movimiento
  ADD COLUMN IF NOT EXISTS pago_cuenta_corriente_id UUID
    REFERENCES public.pago (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pago_proveedor_mov_pago_cc
  ON public.pago_proveedor_movimiento (tenant_id, pago_cuenta_corriente_id)
  WHERE pago_cuenta_corriente_id IS NOT NULL;

WITH candidatos AS (
  SELECT
    ppm.id AS movimiento_id,
    p.id AS pago_id
  FROM public.pago_proveedor_movimiento ppm
  JOIN public.pago_proveedor_factura ppf
    ON ppf.id = ppm.pago_proveedor_factura_id
   AND ppf.tenant_id = ppm.tenant_id
  JOIN public.pago p
    ON p.tenant_id = ppm.tenant_id
   AND p.proveedor_id = ppf.proveedor_id
   AND p.comprobante_id IS NOT DISTINCT FROM ppf.comprobante_id
   AND p.monto = ppm.monto
   AND p.tipo_pago = ppm.tipo_pago
   AND p.fecha = ppm.fecha
   AND p.usuario_id IS NOT DISTINCT FROM ppm.usuario_id
   AND p.notas IS NOT DISTINCT FROM ppm.notas
  WHERE ppm.pago_cuenta_corriente_id IS NULL
),
unicos AS (
  SELECT movimiento_id, pago_id
  FROM (
    SELECT
      movimiento_id,
      pago_id,
      COUNT(*) OVER (PARTITION BY movimiento_id) AS pagos_por_movimiento,
      COUNT(*) OVER (PARTITION BY pago_id) AS movimientos_por_pago
    FROM candidatos
  ) s
  WHERE pagos_por_movimiento = 1
    AND movimientos_por_pago = 1
)
UPDATE public.pago_proveedor_movimiento ppm
SET pago_cuenta_corriente_id = unicos.pago_id
FROM unicos
WHERE ppm.id = unicos.movimiento_id;

COMMENT ON COLUMN public.pago_proveedor_movimiento.pago_cuenta_corriente_id IS
  'Pago de cuenta corriente generado al registrar este pago de proveedor. Se usa para revertir pagos con trazabilidad.';

NOTIFY pgrst, 'reload schema';
