-- Aislamiento estricto por sucursal para comprobantes, pedidos y caja.

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS sucursal_id UUID;

ALTER TABLE public.pedido
  ADD COLUMN IF NOT EXISTS sucursal_id UUID;

ALTER TABLE public.caja_apertura
  ADD COLUMN IF NOT EXISTS sucursal_id UUID;

ALTER TABLE public.cierre_z
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
      UPDATE public.comprobante c
      SET sucursal_id = v_sucursal_principal
      WHERE c.tenant_id = t.id
        AND c.sucursal_id IS NULL;

      UPDATE public.pedido p
      SET sucursal_id = v_sucursal_principal
      WHERE p.tenant_id = t.id
        AND p.sucursal_id IS NULL;

      UPDATE public.caja_apertura ca
      SET sucursal_id = v_sucursal_principal
      WHERE ca.tenant_id = t.id
        AND ca.sucursal_id IS NULL;

      UPDATE public.cierre_z cz
      SET sucursal_id = v_sucursal_principal
      WHERE cz.tenant_id = t.id
        AND cz.sucursal_id IS NULL;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.comprobante
  ALTER COLUMN sucursal_id SET NOT NULL;

ALTER TABLE public.pedido
  ALTER COLUMN sucursal_id SET NOT NULL;

ALTER TABLE public.caja_apertura
  ALTER COLUMN sucursal_id SET NOT NULL;

ALTER TABLE public.cierre_z
  ALTER COLUMN sucursal_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comprobante_sucursal_id_fkey') THEN
    ALTER TABLE public.comprobante
      ADD CONSTRAINT comprobante_sucursal_id_fkey
      FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedido_sucursal_id_fkey') THEN
    ALTER TABLE public.pedido
      ADD CONSTRAINT pedido_sucursal_id_fkey
      FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'caja_apertura_sucursal_id_fkey') THEN
    ALTER TABLE public.caja_apertura
      ADD CONSTRAINT caja_apertura_sucursal_id_fkey
      FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cierre_z_sucursal_id_fkey') THEN
    ALTER TABLE public.cierre_z
      ADD CONSTRAINT cierre_z_sucursal_id_fkey
      FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comprobante_tenant_sucursal_fecha
  ON public.comprobante (tenant_id, sucursal_id, fecha DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pedido_tenant_sucursal_fecha
  ON public.pedido (tenant_id, sucursal_id, fecha DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_caja_apertura_tenant_sucursal_fecha
  ON public.caja_apertura (tenant_id, sucursal_id, fecha_operativa DESC, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_cierre_z_tenant_sucursal_fecha
  ON public.cierre_z (tenant_id, sucursal_id, fecha_operativa DESC, created_at DESC);
