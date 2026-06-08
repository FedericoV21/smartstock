-- PLU opcional por sucursal: la balanza de cada depósito puede usar otro número para el mismo producto.
-- Sin fila en plu_sucursal rige producto.plu (default del catálogo).

CREATE TABLE public.plu_sucursal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  plu VARCHAR(5) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_plu_sucursal_producto_sucursal UNIQUE (producto_id, sucursal_id),
  CONSTRAINT chk_plu_sucursal_formato CHECK (plu ~ '^[0-9]{1,5}$')
);

CREATE UNIQUE INDEX idx_plu_sucursal_tenant_sucursal_plu
  ON public.plu_sucursal (tenant_id, sucursal_id, plu);

CREATE INDEX idx_plu_sucursal_tenant ON public.plu_sucursal (tenant_id);
CREATE INDEX idx_plu_sucursal_sucursal ON public.plu_sucursal (sucursal_id);

COMMENT ON TABLE public.plu_sucursal IS
  'Override de PLU por sucursal para balanzas. Si no hay fila, el POS usa producto.plu.';

CREATE TRIGGER set_plu_sucursal_updated_at
  BEFORE UPDATE ON public.plu_sucursal
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.plu_sucursal ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_plu_sucursal
  ON public.plu_sucursal FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_plu_sucursal
  ON public.plu_sucursal FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_plu_sucursal
  ON public.plu_sucursal FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_plu_sucursal
  ON public.plu_sucursal FOR DELETE
  USING (tenant_id = public.current_tenant_id ());
