ALTER TABLE public.producto
  ADD COLUMN IF NOT EXISTS es_despiece_padre BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_producto_despiece_padre
  ON public.producto(tenant_id)
  WHERE es_despiece_padre = TRUE;

NOTIFY pgrst, 'reload schema';
