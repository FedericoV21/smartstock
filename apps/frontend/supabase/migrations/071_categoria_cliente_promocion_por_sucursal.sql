-- Aislamiento de datos maestros por sucursal:
-- categoria, cliente y promocion dejan de ser solo-tenant y pasan a scope por sucursal.

ALTER TABLE public.categoria
  ADD COLUMN IF NOT EXISTS sucursal_id UUID;

ALTER TABLE public.cliente
  ADD COLUMN IF NOT EXISTS sucursal_id UUID;

ALTER TABLE public.promocion
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
      UPDATE public.categoria c
      SET sucursal_id = v_sucursal_principal
      WHERE c.tenant_id = t.id
        AND c.sucursal_id IS NULL;

      UPDATE public.cliente c
      SET sucursal_id = v_sucursal_principal
      WHERE c.tenant_id = t.id
        AND c.sucursal_id IS NULL;

      UPDATE public.promocion p
      SET sucursal_id = v_sucursal_principal
      WHERE p.tenant_id = t.id
        AND p.sucursal_id IS NULL;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.categoria
  ALTER COLUMN sucursal_id SET NOT NULL;

ALTER TABLE public.cliente
  ALTER COLUMN sucursal_id SET NOT NULL;

ALTER TABLE public.promocion
  ALTER COLUMN sucursal_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categoria_sucursal_id_fkey'
  ) THEN
    ALTER TABLE public.categoria
      ADD CONSTRAINT categoria_sucursal_id_fkey
      FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cliente_sucursal_id_fkey'
  ) THEN
    ALTER TABLE public.cliente
      ADD CONSTRAINT cliente_sucursal_id_fkey
      FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promocion_sucursal_id_fkey'
  ) THEN
    ALTER TABLE public.promocion
      ADD CONSTRAINT promocion_sucursal_id_fkey
      FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_categoria_tenant_sucursal_lookup
  ON public.categoria (tenant_id, sucursal_id, lower(nombre));

CREATE INDEX IF NOT EXISTS idx_cliente_tenant_sucursal_lookup
  ON public.cliente (tenant_id, sucursal_id, lower(nombre));

CREATE INDEX IF NOT EXISTS idx_promocion_tenant_sucursal_lookup
  ON public.promocion (tenant_id, sucursal_id, updated_at DESC);
