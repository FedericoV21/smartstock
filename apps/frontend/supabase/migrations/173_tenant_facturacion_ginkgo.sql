ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS ginkgo_monto_abonado NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS ginkgo_porcentaje NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS ginkgo_facturacion_actualizada_en TIMESTAMPTZ;

ALTER TABLE public.tenant
  DROP CONSTRAINT IF EXISTS tenant_ginkgo_monto_abonado_check,
  DROP CONSTRAINT IF EXISTS tenant_ginkgo_porcentaje_check;

ALTER TABLE public.tenant
  ADD CONSTRAINT tenant_ginkgo_monto_abonado_check
    CHECK (ginkgo_monto_abonado IS NULL OR ginkgo_monto_abonado >= 0),
  ADD CONSTRAINT tenant_ginkgo_porcentaje_check
    CHECK (ginkgo_porcentaje IS NULL OR (ginkgo_porcentaje >= 0 AND ginkgo_porcentaje <= 100));

COMMENT ON COLUMN public.tenant.ginkgo_monto_abonado IS
  'Monto abonado por el cliente de Nexus para calcular la facturacion que corresponde a Ginkgo Devs.';

COMMENT ON COLUMN public.tenant.ginkgo_porcentaje IS
  'Porcentaje del monto abonado que corresponde facturar a Ginkgo Devs.';

COMMENT ON COLUMN public.tenant.ginkgo_facturacion_actualizada_en IS
  'Fecha de ultima actualizacion de los datos de facturacion Ginkgo del tenant.';

NOTIFY pgrst, 'reload schema';
