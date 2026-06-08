-- Promociones con alcance multi-sucursal.
-- `promocion.sucursal_id` queda como sucursal de origen/administracion.
-- Esta tabla define en que sucursales aplica operativamente la promocion.

CREATE TABLE IF NOT EXISTS public.promocion_sucursal (
  promocion_id UUID NOT NULL,
  sucursal_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT promocion_sucursal_pkey PRIMARY KEY (promocion_id, sucursal_id),
  CONSTRAINT promocion_sucursal_promocion_id_fkey
    FOREIGN KEY (promocion_id) REFERENCES public.promocion(id) ON DELETE CASCADE,
  CONSTRAINT promocion_sucursal_sucursal_id_fkey
    FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE CASCADE,
  CONSTRAINT promocion_sucursal_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE
);

COMMENT ON TABLE public.promocion_sucursal IS
  'Sucursales donde una promocion esta habilitada para aplicar. La columna promocion.sucursal_id se conserva como origen.';

CREATE INDEX IF NOT EXISTS idx_promocion_sucursal_tenant_sucursal
  ON public.promocion_sucursal (tenant_id, sucursal_id, promocion_id);

CREATE INDEX IF NOT EXISTS idx_promocion_sucursal_tenant_promocion
  ON public.promocion_sucursal (tenant_id, promocion_id);

INSERT INTO public.promocion_sucursal (tenant_id, promocion_id, sucursal_id)
SELECT p.tenant_id, p.id, p.sucursal_id
FROM public.promocion p
WHERE p.sucursal_id IS NOT NULL
ON CONFLICT (promocion_id, sucursal_id) DO NOTHING;

ALTER TABLE public.promocion_sucursal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_promocion_sucursal ON public.promocion_sucursal;
CREATE POLICY tenant_select_promocion_sucursal
  ON public.promocion_sucursal
  FOR SELECT
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_promocion_sucursal ON public.promocion_sucursal;
CREATE POLICY tenant_insert_promocion_sucursal
  ON public.promocion_sucursal
  FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_update_promocion_sucursal ON public.promocion_sucursal;
CREATE POLICY tenant_update_promocion_sucursal
  ON public.promocion_sucursal
  FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_promocion_sucursal ON public.promocion_sucursal;
CREATE POLICY tenant_delete_promocion_sucursal
  ON public.promocion_sucursal
  FOR DELETE
  USING (tenant_id = public.current_tenant_id());

GRANT ALL ON TABLE public.promocion_sucursal TO anon;
GRANT ALL ON TABLE public.promocion_sucursal TO authenticated;
GRANT ALL ON TABLE public.promocion_sucursal TO service_role;
