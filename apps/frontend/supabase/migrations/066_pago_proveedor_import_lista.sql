-- Obligaciones de pago a proveedor originadas en importación de listas (sin comprobante asociado).

ALTER TABLE public.pago_proveedor_factura
  DROP CONSTRAINT IF EXISTS uq_pago_proveedor_fact_comprobante;

ALTER TABLE public.pago_proveedor_factura
  ALTER COLUMN comprobante_id DROP NOT NULL;

CREATE UNIQUE INDEX uq_pago_proveedor_fact_tenant_comprobante
  ON public.pago_proveedor_factura (tenant_id, comprobante_id)
  WHERE comprobante_id IS NOT NULL;

ALTER TABLE public.pago_proveedor_factura
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'comprobante'
    CONSTRAINT chk_ppf_origen_066 CHECK (origen IN ('comprobante', 'import_lista'));

ALTER TABLE public.pago_proveedor_factura
  ADD COLUMN IF NOT EXISTS referencia text NULL;

UPDATE public.pago_proveedor_factura
SET origen = 'comprobante'
WHERE comprobante_id IS NOT NULL;

ALTER TABLE public.pago_proveedor_factura
  ADD CONSTRAINT chk_ppf_comprobante_o_import_066 CHECK (
    (origen = 'comprobante' AND comprobante_id IS NOT NULL) OR
    (origen = 'import_lista' AND comprobante_id IS NULL)
  );

COMMENT ON COLUMN public.pago_proveedor_factura.origen IS
  'comprobante: deuda vinculada a un comprobante. import_lista: obligación creada al importar lista (CC ya impactada con el mismo monto).';
COMMENT ON COLUMN public.pago_proveedor_factura.referencia IS
  'Texto descriptivo (p. ej. nombre de archivo) cuando origen = import_lista.';
