-- Separa datos maestros por sucursal (mismo tenant).
-- Producto y proveedor pasan a tener alcance por sucursal.

ALTER TABLE public.producto
  ADD COLUMN IF NOT EXISTS sucursal_id UUID;

ALTER TABLE public.proveedor
  ADD COLUMN IF NOT EXISTS sucursal_id UUID;

DO $$
DECLARE
  t RECORD;
  v_sucursal_principal UUID;
BEGIN
  FOR t IN SELECT id FROM public.tenant LOOP
    SELECT s.id
    INTO v_sucursal_principal
    FROM public.sucursal s
    WHERE s.tenant_id = t.id
    ORDER BY s.es_principal DESC, s.created_at ASC
    LIMIT 1;

    IF v_sucursal_principal IS NOT NULL THEN
      UPDATE public.producto p
      SET sucursal_id = v_sucursal_principal
      WHERE p.tenant_id = t.id
        AND p.sucursal_id IS NULL;

      UPDATE public.proveedor pr
      SET sucursal_id = v_sucursal_principal
      WHERE pr.tenant_id = t.id
        AND pr.sucursal_id IS NULL;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.producto
  ALTER COLUMN sucursal_id SET NOT NULL;

ALTER TABLE public.proveedor
  ALTER COLUMN sucursal_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'producto_sucursal_id_fkey'
  ) THEN
    ALTER TABLE public.producto
      ADD CONSTRAINT producto_sucursal_id_fkey
      FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proveedor_sucursal_id_fkey'
  ) THEN
    ALTER TABLE public.proveedor
      ADD CONSTRAINT proveedor_sucursal_id_fkey
      FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_producto_tenant_sucursal_lookup
  ON public.producto (tenant_id, sucursal_id, lower(nombre))
  WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_proveedor_tenant_sucursal_lookup
  ON public.proveedor (tenant_id, sucursal_id, lower(nombre))
  WHERE activo = true;

DROP INDEX IF EXISTS idx_producto_barcode_tenant_proveedor;
DROP INDEX IF EXISTS idx_producto_barcode_tenant_sin_proveedor;

CREATE UNIQUE INDEX IF NOT EXISTS idx_producto_barcode_tenant_sucursal_proveedor
  ON public.producto (tenant_id, sucursal_id, codigo_barras, proveedor_id)
  WHERE codigo_barras IS NOT NULL AND activo = true AND proveedor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_producto_barcode_tenant_sucursal_sin_proveedor
  ON public.producto (tenant_id, sucursal_id, codigo_barras)
  WHERE codigo_barras IS NOT NULL AND activo = true AND proveedor_id IS NULL;
