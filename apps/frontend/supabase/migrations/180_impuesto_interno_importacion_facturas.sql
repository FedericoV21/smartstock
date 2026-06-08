ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS impuesto_interno_monto NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.comprobante
  DROP CONSTRAINT IF EXISTS chk_comprobante_impuesto_interno_nonneg;

ALTER TABLE public.comprobante
  ADD CONSTRAINT chk_comprobante_impuesto_interno_nonneg
  CHECK (impuesto_interno_monto >= 0);

COMMENT ON COLUMN public.comprobante.impuesto_interno_monto IS
  'Impuestos internos informados en facturas de compra importadas o cargadas manualmente.';

ALTER TABLE public.factura_importada_aplicacion
  ADD COLUMN IF NOT EXISTS impuesto_interno_monto NUMERIC(18, 6) NOT NULL DEFAULT 0;

ALTER TABLE public.factura_importada_aplicacion
  DROP CONSTRAINT IF EXISTS chk_factura_importada_aplicacion_montos;

ALTER TABLE public.factura_importada_aplicacion
  ADD CONSTRAINT chk_factura_importada_aplicacion_montos CHECK (
    subtotal >= 0
    AND iva_monto >= 0
    AND percepcion_iibb_monto >= 0
    AND percepcion_iva_monto >= 0
    AND impuesto_interno_monto >= 0
    AND total >= 0
  );

COMMENT ON COLUMN public.factura_importada_aplicacion.impuesto_interno_monto IS
  'Impuestos internos incluidos en el total confirmado de una factura importada.';

NOTIFY pgrst, 'reload schema';
